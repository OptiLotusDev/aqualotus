import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { CommandId, CommandSummary } from "../lib/optilotus";
import { edgeEnds, edgePath, type BlockSide } from "../lib/graph";
import type { LayoutMap, Pos } from "../lib/layout";
import VisualBlock from "./VisualBlock";

interface VisualEditorProps {
  readonly functionName: string;
  readonly isMain: boolean;
  readonly blockCount: number;
  readonly commands: readonly CommandSummary[];
  readonly positions: LayoutMap;
  readonly selectedId: CommandId | null;
  readonly errorId: CommandId | null;
  readonly busy: boolean;
  readonly onSelect: (id: CommandId | null) => void;
  readonly onReconnect: (
    sourceId: CommandId,
    targetId: CommandId | null,
    where: "after" | "before" | "end",
  ) => boolean;
  readonly onMoveBlock: (id: CommandId, pos: Pos) => void;
  readonly onDropBlock: (kind: string, pos: Pos) => void;
  readonly onRequestLibrary: () => void;
  readonly onRegisterDrop: (
    handler: ((kind: string, clientX: number, clientY: number) => void) | null,
  ) => void;
  readonly onRegisterZoom: (
    ctl: { getZoom: () => number; setZoom: (z: number) => void } | null,
  ) => void;
  readonly onZoomSettled?: (before: number, after: number) => void;
  /** Compact-only extra toolbar controls (desktop keeps them in the appbar). */
  readonly toolbarExtra?: ReactNode;
}

interface Size {
  readonly w: number;
  readonly h: number;
}

const FALLBACK_SIZE: Size = { w: 216, h: 104 };
const WORLD_PAD = 280;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function toCanvas(
  board: HTMLDivElement,
  clientX: number,
  clientY: number,
  zoom: number,
): Pos {
  const rect = board.getBoundingClientRect();
  return {
    x: (clientX - rect.left + board.scrollLeft) / zoom,
    y: (clientY - rect.top + board.scrollTop) / zoom,
  };
}

/**
 * Visual canvas. Blocks are absolutely positioned in canvas coordinates;
 * the SVG layer draws semantic edges (`next` pointers) as Bézier paths.
 * Dragging, zoom, pan (native scroll), and connection previews are local
 * visual state only — Optilotus is contacted solely through the
 * `on*` callbacks for semantic mutations.
 */
export default function VisualEditor(props: VisualEditorProps): ReactElement {
  const {
    functionName,
    isMain,
    blockCount,
    commands,
    positions,
    selectedId,
    errorId,
    busy,
    onSelect,
    onReconnect,
    onMoveBlock,
    onDropBlock,
    onRequestLibrary,
    onRegisterDrop,
    onRegisterZoom,
    onZoomSettled,
    toolbarExtra,
  } = props;

  const boardRef = useRef<HTMLDivElement | null>(null);
  const blockEls = useRef(new Map<number, HTMLDivElement>());
  const [sizes, setSizes] = useState<ReadonlyMap<number, Size>>(new Map());
  const [zoom, setZoom] = useState<number>(1);
  const zoomRef = useRef<number>(1);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Zoom control registration for view-undo (AppShell reads current
  // zoom when recording entries, and restores it on undo/redo).
  useEffect(() => {
    onRegisterZoom({
      getZoom: () => zoomRef.current,
      setZoom: (z: number) => setZoom(clampZoom(z)),
    });
    return () => onRegisterZoom(null);
  }, [onRegisterZoom]);

  // Discrete zoom commits (buttons, Fit) notify immediately; wheel
  // bursts commit once the gesture settles.
  const wheelBurstRef = useRef<{ start: number; timer: number | null }>({
    start: 1,
    timer: null,
  });

  const commitZoom = useCallback(
    (before: number, after: number): void => {
      if (Math.abs(before - after) < 1e-9) return;
      onZoomSettled?.(before, after);
    },
    [onZoomSettled],
  );

  function zoomBy(factor: number): void {
    const before = zoomRef.current;
    const after = clampZoom(before * factor);
    setZoom(after);
    commitZoom(before, after);
  }

  // Library ghost drops land here: convert viewport coordinates into
  // canvas space with the live zoom. Registration is explicit so the
  // shell never reaches into canvas internals.
  useEffect(() => {
    onRegisterDrop((kind: string, clientX: number, clientY: number) => {
      const board = boardRef.current;
      if (board === null) return;
      const rect = board.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return;
      }
      const p = toCanvas(board, clientX, clientY, zoomRef.current);
      onDropBlock(kind, {
        x: Math.max(8, p.x - 100),
        y: Math.max(8, p.y - 40),
      });
    });
    return () => onRegisterDrop(null);
  }, [onRegisterDrop, onDropBlock]);
  const [dragPos, setDragPos] = useState<{ id: number; pos: Pos } | null>(null);
  const dragPosRef = useRef<{ id: number; pos: Pos } | null>(null);
  const [preview, setPreview] = useState<{
    sourceId: number;
    side: BlockSide;
    x: number;
    y: number;
  } | null>(null);
  const [hint, setHint] = useState<string>("");
  const gestureRef = useRef<
    | { kind: "block"; id: number; startX: number; startY: number; orig: Pos }
    | { kind: "connect"; sourceId: number; side: BlockSide }
    | { kind: "pan"; startX: number; startY: number; left: number; top: number }
    | null
  >(null);
  const movedRef = useRef<boolean>(false);
  const hintTimer = useRef<number | null>(null);
  const selectStampRef = useRef<number>(0);

  // Measure block geometry after layout; positions are canvas-space
  // offsets, independent of the zoom transform.
  useLayoutEffect(() => {
    const next = new Map<number, Size>();
    for (const cmd of commands) {
      const el = blockEls.current.get(cmd.id);
      if (el === undefined || el.offsetWidth <= 0) continue;
      next.set(cmd.id, { w: el.offsetWidth, h: el.offsetHeight });
    }
    setSizes((prev) => {
      if (
        prev.size === next.size &&
        [...next.entries()].every(
          ([id, s]) =>
            prev.get(id)?.w === s.w && prev.get(id)?.h === s.h,
        )
      ) {
        return prev;
      }
      return next;
    });
  }, [commands, positions, dragPos, zoom]);

  // Ctrl/Cmd + wheel zooms; plain wheel and touch scroll natively (pan).
  useEffect(() => {
    const found = boardRef.current;
    if (found === null) return;
    const board: HTMLDivElement = found;
    function onWheel(e: WheelEvent): void {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const burst = wheelBurstRef.current;
      if (burst.timer === null) {
        burst.start = zoomRef.current;
      } else {
        window.clearTimeout(burst.timer);
      }
      setZoom((z) => {
        const next = clampZoom(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        const rect = board.getBoundingClientRect();
        const cx = board.scrollLeft + rect.width / 2;
        const cy = board.scrollTop + rect.height / 2;
        const ratio = next / z;
        requestAnimationFrame(() => {
          board.scrollLeft = cx * ratio - rect.width / 2;
          board.scrollTop = cy * ratio - rect.height / 2;
        });
        return next;
      });
      burst.timer = window.setTimeout(() => {
        burst.timer = null;
        commitZoom(burst.start, zoomRef.current);
      }, 600);
    }
    board.addEventListener("wheel", onWheel, { passive: false });
    const burst = wheelBurstRef.current;
    return () => {
      board.removeEventListener("wheel", onWheel);
      if (burst.timer !== null) {
        window.clearTimeout(burst.timer);
        burst.timer = null;
      }
    };
  }, [commitZoom]);

  useEffect(() => {
    return () => {
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    };
  }, []);

  function flashHint(text: string): void {
    setHint(text);
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(""), 2600);
  }

  function effectivePos(id: number): Pos {
    if (dragPos !== null && dragPos.id === id) return dragPos.pos;
    return positions[id] ?? { x: 180, y: 72 };
  }

  function sizeOf(id: number): Size {
    return sizes.get(id) ?? FALLBACK_SIZE;
  }

  // Semantic edges from `next` pointers (generic: any number of edges).
  // Exit/entry sides face each other, so stacked blocks link vertically
  // and side-by-side blocks link horizontally.
  const edges: { from: number; d: string }[] = [];
  for (const cmd of commands) {
    if (cmd.next === null || cmd.next === undefined) continue;
    const target = commands.find((c) => c.id === cmd.next);
    if (target === undefined) continue;
    const a = effectivePos(cmd.id);
    const b = effectivePos(target.id);
    const sa = sizeOf(cmd.id);
    const sb = sizeOf(target.id);
    const ends = edgeEnds(
      { x: a.x, y: a.y, w: sa.w, h: sa.h },
      { x: b.x, y: b.y, w: sb.w, h: sb.h },
    );
    edges.push({
      from: cmd.id,
      d: edgePath(ends.x1, ends.y1, ends.x2, ends.y2, ends.horizontal),
    });
  }

  // World extent covers all blocks plus padding.
  let worldW = 640;
  let worldH = 480;
  for (const cmd of commands) {
    const p = effectivePos(cmd.id);
    const s = sizeOf(cmd.id);
    worldW = Math.max(worldW, p.x + s.w + WORLD_PAD);
    worldH = Math.max(worldH, p.y + s.h + WORLD_PAD);
  }

  function fitView(): void {
    const board = boardRef.current;
    if (board === null) return;
    if (commands.length === 0) {
      const beforeEmpty = zoomRef.current;
      setZoom(1);
      commitZoom(beforeEmpty, 1);
      board.scrollTo({ left: 0, top: 0 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;
    for (const cmd of commands) {
      const p = effectivePos(cmd.id);
      const s = sizeOf(cmd.id);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w);
      maxY = Math.max(maxY, p.y + s.h);
    }
    const vw = board.clientWidth;
    const vh = board.clientHeight;
    const next = clampZoom(
      Math.min(vw / (maxX - minX + 160), vh / (maxY - minY + 160)),
    );
    const beforeFit = zoomRef.current;
    setZoom(next);
    commitZoom(beforeFit, next);
    const target = board;
    requestAnimationFrame(() => {
      target.scrollLeft = ((minX + maxX) / 2) * next - vw / 2;
      target.scrollTop = ((minY + maxY) / 2) * next - vh / 2;
    });
  }

  function onBoardPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (busy) return;
    const board = boardRef.current;
    if (board === null) return;
    const target = e.target as Element;
    const port = target.closest('[data-port="out"]');
    if (port instanceof HTMLElement) {
      const id = Number(port.dataset.blockId);
      const side =
        port.dataset.side === "right" ? "right" : ("bottom" as BlockSide);
      if (Number.isFinite(id)) {
        gestureRef.current = { kind: "connect", sourceId: id, side };
        movedRef.current = false;
        try {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        } catch {
          // Synthetic or already-released pointers: gesture still works.
        }
      }
      return;
    }
    const block = target.closest("[data-block-id]");
    if (block instanceof HTMLElement && block.classList.contains("vblock")) {
      const id = Number(block.dataset.blockId);
      if (Number.isFinite(id)) {
        gestureRef.current = {
          kind: "block",
          id,
          startX: e.clientX,
          startY: e.clientY,
          orig: effectivePos(id),
        };
        movedRef.current = false;
      }
      return;
    }
    gestureRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      left: board.scrollLeft,
      top: board.scrollTop,
    };
    movedRef.current = false;
  }

  function onBoardPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const gesture = gestureRef.current;
    const board = boardRef.current;
    if (gesture === null || board === null) return;
    if (gesture.kind === "block") {
      const dx = (e.clientX - gesture.startX) / zoom;
      const dy = (e.clientY - gesture.startY) / zoom;
      if (!movedRef.current && Math.hypot(dx, dy) * zoom < 4) return;
      movedRef.current = true;
      const next = {
        id: gesture.id,
        pos: {
          x: Math.max(8, gesture.orig.x + dx),
          y: Math.max(8, gesture.orig.y + dy),
        },
      };
      dragPosRef.current = next;
      setDragPos(next);
    } else if (gesture.kind === "connect") {
      movedRef.current = true;
      const p = toCanvas(board, e.clientX, e.clientY, zoom);
      setPreview({
        sourceId: gesture.sourceId,
        side: gesture.side,
        x: p.x,
        y: p.y,
      });
    } else {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (!movedRef.current && Math.hypot(dx, dy) < 4) return;
      movedRef.current = true;
      board.scrollLeft = gesture.left - dx;
      board.scrollTop = gesture.top - dy;
    }
  }

  function endGesture(e: React.PointerEvent<HTMLDivElement>): void {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture === null) return;
    if (gesture.kind === "block") {
      const live =
        dragPosRef.current !== null && dragPosRef.current.id === gesture.id
          ? dragPosRef.current.pos
          : null;
      const final =
        live ??
        (dragPos !== null && dragPos.id === gesture.id ? dragPos.pos : null);
      dragPosRef.current = null;
      setDragPos(null);
      if (movedRef.current) {
        if (final !== null) onMoveBlock(gesture.id, final);
      } else {
        onSelect(selectedId === gesture.id ? null : gesture.id);
      }
    } else if (gesture.kind === "connect") {
      setPreview(null);
      // elementsFromPoint (plural) sees past floating overlays like the
      // canvas toolbar: the first block under the cursor wins.
      const stack =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(e.clientX, e.clientY)
          : [];
      const block = stack.find(
        (el) => el instanceof HTMLElement && el.classList.contains("vblock"),
      );
      if (!(block instanceof HTMLElement)) {
        if (movedRef.current) {
          const applied = onReconnect(gesture.sourceId, null, "end");
          if (!applied) flashHint("That block is already last.");
        }
      } else {
        // Input port (top/left) → run before; block body or output
        // port → run after. Every position stays reachable.
        const inPort = stack.find(
          (el) =>
            el instanceof HTMLElement &&
            el.dataset.port === "in" &&
            block.contains(el),
        );
        const targetId = Number(block.dataset.blockId);
        if (Number.isFinite(targetId)) {
          const applied = onReconnect(
            gesture.sourceId,
            targetId,
            inPort !== undefined ? "before" : "after",
          );
          if (!applied) flashHint("Those blocks are already connected.");
        }
      }
    } else {
      if (!movedRef.current) onSelect(null);
    }
    movedRef.current = false;
    selectStampRef.current = Date.now();
  }

  // Fallback for synthetic clicks (no pointer gesture): real pointer
  // interactions set a stamp in endGesture, so this never double-fires.
  function onBoardClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (Date.now() - selectStampRef.current < 500) return;
    const target = e.target as Element;
    if (target.closest("button, input, select, summary, a")) return;
    const block = target.closest("[data-block-id]");
    if (block instanceof HTMLElement && block.classList.contains("vblock")) {
      const id = Number(block.dataset.blockId);
      if (Number.isFinite(id)) onSelect(selectedId === id ? null : id);
    } else {
      onSelect(null);
    }
  }

  function onBoardKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as Element;
    const block = target.closest?.("[data-block-id]");
    if (block instanceof HTMLElement && block.classList.contains("vblock")) {
      const id = Number(block.dataset.blockId);
      if (Number.isFinite(id)) {
        e.preventDefault();
        onSelect(selectedId === id ? null : id);
      }
    }
  }

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar" role="toolbar" aria-label="Canvas view">
        <span className="canvas-title">
          {functionName}()
          {isMain ? <span className="main-badge">MAIN</span> : null}
          <span className="cmd-count">
            {blockCount} {blockCount === 1 ? "block" : "blocks"}
          </span>
        </span>
        <span className="canvas-tools">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.2)}
          >
            −
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Reset zoom to 100 percent"
            onClick={() => {
              const before = zoomRef.current;
              setZoom(1);
              commitZoom(before, 1);
            }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.2)}
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={fitView}
          >
            Fit
          </button>
        </span>
        {toolbarExtra !== undefined ? (
          <span className="toolbar-extra">{toolbarExtra}</span>
        ) : null}
        {hint !== "" ? (
          <span className="canvas-hint" role="status">
            {hint}
          </span>
        ) : null}
      </div>
      <div
        id="board"
        ref={boardRef}
        className="board"
        onPointerDown={onBoardPointerDown}
        onPointerMove={onBoardPointerMove}
        onPointerUp={endGesture}
        onClick={onBoardClick}
        onPointerCancel={() => {
          gestureRef.current = null;
          setDragPos(null);
          setPreview(null);
        }}
        onKeyDown={onBoardKeyDown}
      >
        <div
          className="board-scaler"
          style={{ width: worldW * zoom, height: worldH * zoom }}
        >
          <div
            className="board-world"
            style={{
              width: worldW,
              height: worldH,
              transform: `scale(${zoom})`,
            }}
          >
            <svg
              id="links"
              className="links"
              width={worldW}
              height={worldH}
              aria-hidden="true"
            >
              {edges.map((edge) => (
                <path
                  key={`${edge.from}`}
                  d={edge.d}
                  className={
                    edge.from === selectedId
                      ? "edge edge-selected"
                      : "edge"
                  }
                />
              ))}
              {preview !== null
                ? (() => {
                    const origin = effectivePos(preview.sourceId);
                    const size = sizeOf(preview.sourceId);
                    const horizontal = preview.side === "right";
                    const ox =
                      preview.side === "right"
                        ? origin.x + size.w
                        : origin.x + size.w / 2;
                    const oy =
                      preview.side === "right"
                        ? origin.y + size.h / 2
                        : origin.y + size.h;
                    return (
                      <path
                        d={edgePath(ox, oy, preview.x, preview.y, horizontal)}
                        className="edge edge-preview"
                      />
                    );
                  })()
                : null}
            </svg>
            {commands.map((cmd, index) => (
                <div
                  key={cmd.id}
                  ref={(el) => {
                    if (el !== null) {
                      const inner = el.querySelector(".vblock");
                      if (inner instanceof HTMLDivElement) {
                        blockEls.current.set(cmd.id, inner);
                      }
                    } else {
                      blockEls.current.delete(cmd.id);
                    }
                  }}
                >
                  <VisualBlock
                    command={cmd}
                    index={index}
                    position={effectivePos(cmd.id)}
                    selected={cmd.id === selectedId}
                    failed={cmd.id === errorId}
                    connectFrom={preview?.sourceId === cmd.id}
                  />
                </div>
              ))}
          </div>
        </div>
        {commands.length === 0 ? (
          <div className="canvas-empty">
            <strong>No blocks yet</strong>
            <span>
              Drag a block from the library to start building this function.
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onRequestLibrary}
            >
              Open block library
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
