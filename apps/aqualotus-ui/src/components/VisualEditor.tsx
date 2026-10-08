import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  CommandId,
  CommandSummary,
  FunctionId,
  FunctionSummary,
} from "../lib/optilotus";
import { edgeEnds, edgePath, type BlockSide } from "../lib/graph";
import type { LayoutMap, Pos } from "../lib/layout";
import {
  LAYOUT_ROW_Y,
  LAYOUT_START_X,
  LAYOUT_STEP_X,
} from "../lib/layout";
import {
  breadcrumbPath,
  PACKAGE_NAME,
  PRESENTATION_STRUCT_NAME,
} from "../lib/workspace";
import VisualBlock from "./VisualBlock";
import PackageContainer from "./PackageContainer";
import StructContainer from "./StructContainer";
import FunctionContainer from "./FunctionContainer";

interface VisualEditorProps {
  readonly functions: readonly FunctionSummary[];
  readonly commandsByFunction: Readonly<
    Record<number, readonly CommandSummary[]>
  >;
  readonly layoutStore: Readonly<Record<number, LayoutMap>>;
  /** Extra world-x shift so content clears the open left panel. */
  readonly chromeLeft: number;
  readonly selectedFunctionId: FunctionId | null;
  readonly selectedCommandId: CommandId | null;
  readonly errorId: CommandId | null;
  readonly errorFunctionId: FunctionId | null;
  readonly busy: boolean;
  readonly onSelectFunction: (id: FunctionId) => void;
  readonly onSelectCommand: (id: CommandId | null) => void;
  readonly onReconnect: (
    fid: FunctionId,
    sourceId: CommandId,
    targetId: CommandId | null,
    where: "after" | "before" | "end",
  ) => boolean;
  readonly onMoveBlock: (
    fid: FunctionId,
    id: CommandId,
    pos: Pos,
  ) => void;
  readonly onDropBlock: (
    fid: FunctionId,
    kind: string,
    pos: Pos,
  ) => void;
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
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;

/** Program-model geometry (world coordinates, before zoom). Titles sit
 *  on the top border, so heads consume no layout space. The package
 *  starts at the world center so panning is unbounded in all four
 *  directions (Excalidraw-style); only `chromeLeft`/`pkgOff` shift it. */
const WORLD_SIZE = 40000;
const WORLD_CENTER = WORLD_SIZE / 2;
/** Package drag clamp keeps the package inside the world. */
const DRAG_LIMIT = WORLD_SIZE / 2 - 4000;

function clampDrag(v: number): number {
  return Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, v));
}
const PKG_HEAD = 0;
const PKG_PAD = 40;
const STRUCT_HEAD = 0;
const STRUCT_PAD = 30;
const FUNC_MIN_WIDTH = 600;
const FUNC_MIN_HEIGHT = 200;
const FUNC_GAP = 28;
const BLOCK_MIN_Y = 36;

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

function fallbackPos(index: number): Pos {
  return { x: LAYOUT_START_X + index * LAYOUT_STEP_X, y: LAYOUT_ROW_Y };
}

/**
 * Hierarchical program-model canvas: Package → Struct → Function →
 * Blocks. The nesting is presentation architecture (the runtime owns
 * one package + functions); blocks stay interactive only in the
 * selected function. SVG draws semantic `next` edges per function
 * only — calls execute in the engine but draw no arrows. Dragging,
 * zoom, pan, and connection previews are local visual state —
 * Optilotus is contacted solely through the `on*` callbacks.
 */
export default function VisualEditor(props: VisualEditorProps): ReactElement {
  const {
    functions,
    commandsByFunction,
    layoutStore,
    chromeLeft,
    selectedFunctionId,
    selectedCommandId,
    errorId,
    errorFunctionId,
    busy,
    onSelectFunction,
    onSelectCommand,
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
  const blockEls = useRef(new Map<string, HTMLDivElement>());
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  const [zoom, setZoom] = useState<number>(1);
  const zoomRef = useRef<number>(1);
  // Package offset (UI-only): dragging the package background shifts
  // the whole subtree — struct, functions, blocks — together.
  const [pkgOff, setPkgOff] = useState<Pos>({ x: 0, y: 0 });

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    onRegisterZoom({
      getZoom: () => zoomRef.current,
      setZoom: (z: number) => setZoom(clampZoom(z)),
    });
    return () => onRegisterZoom(null);
  }, [onRegisterZoom]);

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

  // World geometry of the Package → Struct → Function nesting, in
  // canvas coordinates (before zoom). Function containers auto-size
  // from their blocks and stack vertically; memoized so effects can
  // depend on it without re-running every render.
  const layout = useMemo(() => {
    function posOf(fid: number, cmd: CommandSummary, index: number): Pos {
      const stored = layoutStore[fid]?.[cmd.id];
      if (stored !== undefined) return stored;
      return fallbackPos(index);
    }
    function size(fid: number, id: number): Size {
      return sizes.get(`${fid}:${id}`) ?? FALLBACK_SIZE;
    }
    const heights = new Map<number, number>();
    const widths = new Map<number, number>();
    for (const fn of functions) {
      const cmds = commandsByFunction[fn.id] ?? [];
      let bottom = 0;
      let right = 0;
      cmds.forEach((cmd, index) => {
        const p = posOf(fn.id, cmd, index);
        bottom = Math.max(bottom, p.y + size(fn.id, cmd.id).h);
        right = Math.max(right, p.x + size(fn.id, cmd.id).w);
      });
      heights.set(
        fn.id,
        Math.max(FUNC_MIN_HEIGHT, bottom === 0 ? 0 : bottom + 36),
      );
      widths.set(
        fn.id,
        Math.max(FUNC_MIN_WIDTH, right === 0 ? 0 : right + 56),
      );
    }
    const ys = new Map<number, number>();
    let cursor = STRUCT_PAD;
    for (const fn of functions) {
      ys.set(fn.id, cursor);
      cursor += (heights.get(fn.id) ?? FUNC_MIN_HEIGHT) + FUNC_GAP;
    }
    const lastId = functions[functions.length - 1]?.id ?? -1;
    const contentH =
      functions.length === 0
        ? STRUCT_PAD * 2 + 120
        : (ys.get(lastId) ?? 0) +
          (heights.get(lastId) ?? FUNC_MIN_HEIGHT) +
          STRUCT_PAD;
    let contentW = FUNC_MIN_WIDTH;
    for (const fn of functions) {
      contentW = Math.max(contentW, widths.get(fn.id) ?? FUNC_MIN_WIDTH);
    }
    const structW = contentW + STRUCT_PAD * 2;
    const structH = STRUCT_HEAD + contentH;
    const pkgW = structW + PKG_PAD * 2;
    const pkgH = PKG_HEAD + PKG_PAD + structH + PKG_PAD;
    // Package/struct/function offsets shift whole subtrees together.
    const pkgPos: Pos = {
      x: WORLD_CENTER + chromeLeft + pkgOff.x,
      y: WORLD_CENTER + pkgOff.y,
    };
    const structOrigin: Pos = {
      x: pkgPos.x + PKG_PAD,
      y: pkgPos.y + PKG_HEAD + PKG_PAD,
    };
    function funcOrigin(fid: number): Pos {
      return {
        x: structOrigin.x + STRUCT_PAD,
        y: structOrigin.y + STRUCT_HEAD + (ys.get(fid) ?? STRUCT_PAD),
      };
    }
    return {
      posOf,
      heights,
      widths,
      ys,
      structW,
      structH,
      pkgW,
      pkgH,
      worldW: Math.max(WORLD_SIZE, pkgPos.x + pkgW + WORLD_SIZE),
      worldH: Math.max(WORLD_SIZE, pkgPos.y + pkgH + WORLD_SIZE),
      pkgPos,
      structOrigin,
      funcOrigin,
    };
  }, [
    functions,
    commandsByFunction,
    layoutStore,
    sizes,
    chromeLeft,
    pkgOff,
  ]);

  // Default view: park the package in the viewport on mount, sitting
  // below the floating canvas toolbar so the two never intersect.
  // Later panel toggles or selections never move the canvas.
  const scrolledInitRef = useRef<boolean>(false);
  useEffect(() => {
    if (scrolledInitRef.current) return;
    scrolledInitRef.current = true;
    const board = boardRef.current;
    if (board === null) return;
    const px = layout.pkgPos.x;
    const py = layout.pkgPos.y;
    requestAnimationFrame(() => {
      board.scrollLeft = Math.max(0, px - 80);
      board.scrollTop = Math.max(0, py - 170);
    });
  }, [layout.pkgPos]);

  function effectivePos(fid: number, cmd: CommandSummary, index: number): Pos {
    return layout.posOf(fid, cmd, index);
  }

  function sizeOf(fid: number, id: number): Size {
    return sizes.get(`${fid}:${id}`) ?? FALLBACK_SIZE;
  }

  const { worldW, worldH, pkgW, pkgH, structW, structH } = layout;
  function blockWorld(fid: number, cmd: CommandSummary, index: number): Pos {
    const f = layout.funcOrigin(fid);
    const p = layout.posOf(fid, cmd, index);
    return { x: f.x + p.x, y: f.y + p.y };
  }
  const funcHeights = layout.heights;
  const funcY = layout.ys;

  // Semantic edges from `next` pointers, in world coordinates.
  const edges: { key: string; from: number; fid: number; d: string }[] = [];
  for (const fn of functions) {
    const cmds = commandsByFunction[fn.id] ?? [];
    for (const cmd of cmds) {
      if (cmd.next === null || cmd.next === undefined) continue;
      const targetIndex = cmds.findIndex((c) => c.id === cmd.next);
      if (targetIndex < 0) continue;
      const target = cmds[targetIndex];
      if (target === undefined) continue;
      const sourceIndex = cmds.findIndex((c) => c.id === cmd.id);
      const a = blockWorld(fn.id, cmd, sourceIndex);
      const b = blockWorld(fn.id, target, targetIndex);
      const sa = sizeOf(fn.id, cmd.id);
      const sb = sizeOf(fn.id, target.id);
      const ends = edgeEnds(
        { x: a.x, y: a.y, w: sa.w, h: sa.h },
        { x: b.x, y: b.y, w: sb.w, h: sb.h },
      );
      edges.push({
        key: `${fn.id}:${cmd.id}`,
        from: cmd.id,
        fid: fn.id,
        d: edgePath(ends.x1, ends.y1, ends.x2, ends.y2, ends.horizontal),
      });
    }
  }

  const selectedFunc =
    functions.find((f) => f.id === selectedFunctionId) ?? null;
  const selectedCount =
    selectedFunctionId === null
      ? 0
      : (commandsByFunction[selectedFunctionId]?.length ?? 0);

  // Measure block geometry after layout.
  useLayoutEffect(() => {
    const next = new Map<string, Size>();
    for (const fn of functions) {
      const cmds = commandsByFunction[fn.id] ?? [];
      for (const cmd of cmds) {
        const el = blockEls.current.get(`${fn.id}:${cmd.id}`);
        if (el === undefined || el.offsetWidth <= 0) continue;
        next.set(`${fn.id}:${cmd.id}`, {
          w: el.offsetWidth,
          h: el.offsetHeight,
        });
      }
    }
    setSizes((prev) => {
      if (
        prev.size === next.size &&
        [...next.entries()].every(
          ([id, s]) => prev.get(id)?.w === s.w && prev.get(id)?.h === s.h,
        )
      ) {
        return prev;
      }
      return next;
    });
  }, [functions, commandsByFunction, layoutStore, zoom]);

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

  // Library ghost drops: convert to world coords, route to the function
  // container under the cursor (or the selected one as fallback).
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
      let targetFid = selectedFunctionId;
      for (const fn of functions) {
        const f = layout.funcOrigin(fn.id);
        const h = layout.heights.get(fn.id) ?? FUNC_MIN_HEIGHT;
        const w = layout.widths.get(fn.id) ?? FUNC_MIN_WIDTH;
        if (
          p.x >= f.x &&
          p.x <= f.x + w &&
          p.y >= f.y &&
          p.y <= f.y + h
        ) {
          targetFid = fn.id;
          break;
        }
      }
      if (targetFid === null) return;
      const f = layout.funcOrigin(targetFid);
      onDropBlock(targetFid, kind, {
        x: Math.max(8, p.x - f.x - 100),
        y: Math.max(BLOCK_MIN_Y, p.y - f.y - 40),
      });
    });
    return () => onRegisterDrop(null);
  }, [onRegisterDrop, onDropBlock, functions, selectedFunctionId, layout]);

  const [dragPos, setDragPos] = useState<{
    fid: number;
    id: number;
    pos: Pos;
  } | null>(null);
  const dragPosRef = useRef<{ fid: number; id: number; pos: Pos } | null>(null);
  const [preview, setPreview] = useState<{
    fid: number;
    sourceId: number;
    side: BlockSide;
    x: number;
    y: number;
  } | null>(null);
  const [hint, setHint] = useState<string>("");
  const gestureRef = useRef<
    | { kind: "block"; fid: number; id: number; startX: number; startY: number; orig: Pos }
    | { kind: "connect"; fid: number; sourceId: number; side: BlockSide }
    | { kind: "pkg"; startX: number; startY: number; orig: Pos }
    | { kind: "pan"; startX: number; startY: number; left: number; top: number }
    | null
  >(null);
  const movedRef = useRef<boolean>(false);
  const hintTimer = useRef<number | null>(null);
  const selectStampRef = useRef<number>(0);

  function flashHint(text: string): void {
    setHint(text);
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(""), 2600);
  }

  useEffect(() => {
    return () => {
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    };
  }, []);

  function fitView(): void {
    const board = boardRef.current;
    if (board === null) return;
    const vw = board.clientWidth;
    const vh = board.clientHeight;
    // Fit the package (not the infinite world) into view.
    const px = layout.pkgPos.x;
    const py = layout.pkgPos.y;
    const next = clampZoom(
      Math.min(vw / (pkgW + 160), vh / (pkgH + 160)),
    );
    const beforeFit = zoomRef.current;
    setZoom(next);
    commitZoom(beforeFit, next);
    const target = board;
    requestAnimationFrame(() => {
      target.scrollLeft = (px + pkgW / 2) * next - vw / 2;
      target.scrollTop = (py + pkgH / 2) * next - vh / 2;
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
      const fid = Number(port.dataset.fid);
      if (!Number.isFinite(id) || !Number.isFinite(fid)) return;
      if (fid !== selectedFunctionId) {
        onSelectFunction(fid);
        flashHint("Selected its function — drag again to connect.");
        return;
      }
      // Two ports only: the single right out-port starts a connection.
      gestureRef.current = { kind: "connect", fid, sourceId: id, side: "right" };
      movedRef.current = false;
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // Synthetic pointers: gesture still works.
      }
      return;
    }
    const block = target.closest("[data-block-id]");
    if (block instanceof HTMLElement && block.classList.contains("vblock")) {
      const id = Number(block.dataset.blockId);
      const fid = Number(
        (block as HTMLElement).dataset.fid ?? selectedFunctionId ?? NaN,
      );
      if (!Number.isFinite(id) || !Number.isFinite(fid)) return;
      if (fid !== selectedFunctionId) {
        onSelectFunction(fid);
        return;
      }
      const cmds = commandsByFunction[fid] ?? [];
      const index = cmds.findIndex((c) => c.id === id);
      if (index < 0) return;
      const origin = cmds[index] as CommandSummary;
      gestureRef.current = {
        kind: "block",
        fid,
        id,
        startX: e.clientX,
        startY: e.clientY,
        orig: effectivePos(fid, origin, index),
      };
      movedRef.current = false;
      return;
    }
    const func = target.closest(".funcc");
    if (func instanceof HTMLElement) {
      const match = func.id.match(/^func-(\d+)$/);
      if (match !== null) {
        const fid = Number(match[1]);
        if (Number.isFinite(fid) && fid !== selectedFunctionId) {
          onSelectFunction(fid);
          return;
        }
      }
    }
    // Package background drag moves the whole subtree together.
    // Struct/function containers stay fixed; only blocks move inside.
    const pkg = target.closest(".pkg");
    if (pkg instanceof HTMLElement) {
      gestureRef.current = {
        kind: "pkg",
        startX: e.clientX,
        startY: e.clientY,
        orig: { ...pkgOff },
      };
      movedRef.current = false;
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
        fid: gesture.fid,
        id: gesture.id,
        pos: {
          x: Math.max(8, gesture.orig.x + dx),
          y: Math.max(BLOCK_MIN_Y, gesture.orig.y + dy),
        },
      };
      dragPosRef.current = next;
      setDragPos(next);
    } else if (gesture.kind === "connect") {
      movedRef.current = true;
      const p = toCanvas(board, e.clientX, e.clientY, zoom);
      setPreview({
        fid: gesture.fid,
        sourceId: gesture.sourceId,
        side: gesture.side,
        x: p.x,
        y: p.y,
      });
    } else if (gesture.kind === "pkg") {
      const dx = (e.clientX - gesture.startX) / zoom;
      const dy = (e.clientY - gesture.startY) / zoom;
      if (!movedRef.current && Math.hypot(dx, dy) * zoom < 4) return;
      movedRef.current = true;
      setPkgOff({
        x: clampDrag(gesture.orig.x + dx),
        y: clampDrag(gesture.orig.y + dy),
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
        dragPosRef.current !== null &&
        dragPosRef.current.id === gesture.id &&
        dragPosRef.current.fid === gesture.fid
          ? dragPosRef.current.pos
          : null;
      const final =
        live ??
        (dragPos !== null && dragPos.id === gesture.id ? dragPos.pos : null);
      dragPosRef.current = null;
      setDragPos(null);
      if (movedRef.current) {
        if (final !== null) onMoveBlock(gesture.fid, gesture.id, final);
      } else {
        onSelectCommand(
          selectedCommandId === gesture.id ? null : gesture.id,
        );
      }
    } else if (gesture.kind === "connect") {
      setPreview(null);
      // elementsFromPoint (plural) sees past floating overlays like the
      // canvas toolbar: the first block under the cursor wins. The
      // in-port sticks out of its block's box, so a precise port drop
      // may list the port without the block — resolve through the port
      // first, otherwise port-to-port drops would misfire as empty
      // canvas and detach the dragged block.
      const stack =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(e.clientX, e.clientY)
          : [];
      const inPortHit = stack.find(
        (el) => el instanceof HTMLElement && el.dataset.port === "in",
      );
      const portBlock =
        inPortHit instanceof HTMLElement
          ? inPortHit.closest("[data-block-id]")
          : null;
      const bodyBlock = stack.find(
        (el) => el instanceof HTMLElement && el.classList.contains("vblock"),
      );
      const block =
        bodyBlock instanceof HTMLElement
          ? bodyBlock
          : portBlock instanceof HTMLElement &&
              portBlock.classList.contains("vblock")
            ? portBlock
            : null;
      if (block === null) {
        if (movedRef.current) {
          const applied = onReconnect(gesture.fid, gesture.sourceId, null, "end");
          if (!applied) flashHint("That block is already last.");
        }
      } else {
        const targetFid = Number(block.dataset.fid ?? NaN);
        if (!Number.isFinite(targetFid) || targetFid !== gesture.fid) {
          if (movedRef.current) {
            flashHint("Connections stay inside one function.");
          }
        } else {
          // Left in-port → forward port-to-port wiring (a detached
          // source slots in before the target; a chained source pulls
          // the target after itself). Block body → the target moves to
          // run right after the dragged block.
          const inPort =
            inPortHit !== undefined && block.contains(inPortHit)
              ? inPortHit
              : undefined;
          const targetId = Number(block.dataset.blockId);
          if (Number.isFinite(targetId)) {
            const applied = onReconnect(
              gesture.fid,
              gesture.sourceId,
              targetId,
              inPort !== undefined ? "before" : "after",
            );
            if (!applied) flashHint("Those blocks are already connected.");
          }
        }
      }
    } else {
      if (!movedRef.current) onSelectCommand(null);
    }
    movedRef.current = false;
    selectStampRef.current = Date.now();
  }

  function onBoardClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (Date.now() - selectStampRef.current < 500) return;
    const target = e.target as Element;
    if (target.closest("button, input, select, summary, a")) return;
    const block = target.closest("[data-block-id]");
    if (block instanceof HTMLElement && block.classList.contains("vblock")) {
      const id = Number(block.dataset.blockId);
      const fid = Number(block.dataset.fid ?? NaN);
      if (!Number.isFinite(id)) return;
      // Preview blocks in other functions select their function first;
      // command selection stays scoped to the selected function so a
      // foreign id can never highlight the wrong block.
      if (!Number.isFinite(fid) || fid !== selectedFunctionId) {
        if (Number.isFinite(fid)) onSelectFunction(fid);
        return;
      }
      onSelectCommand(selectedCommandId === id ? null : id);
    } else {
      const func = target.closest(".funcc");
      if (func instanceof HTMLElement) {
        const match = func.id.match(/^func-(\d+)$/);
        if (match !== null) {
          const fid = Number(match[1]);
          if (Number.isFinite(fid) && fid !== selectedFunctionId) {
            onSelectFunction(fid);
            return;
          }
        }
      }
      onSelectCommand(null);
    }
  }

  function onBoardKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as Element;
    const block = target.closest?.("[data-block-id]");
    if (block instanceof HTMLElement && block.classList.contains("vblock")) {
      const id = Number(block.dataset.blockId);
      const fid = Number(block.dataset.fid ?? NaN);
      if (!Number.isFinite(id)) return;
      if (!Number.isFinite(fid) || fid !== selectedFunctionId) {
        if (Number.isFinite(fid)) onSelectFunction(fid);
        return;
      }
      e.preventDefault();
      onSelectCommand(selectedCommandId === id ? null : id);
    }
  }

  function dragEffectivePos(fid: number, cmd: CommandSummary, index: number): Pos {
    if (dragPos !== null && dragPos.fid === fid && dragPos.id === cmd.id) {
      return dragPos.pos;
    }
    return effectivePos(fid, cmd, index);
  }

  const emptyWorkspace = functions.length === 0;

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar" role="toolbar" aria-label="Canvas view">
        <span className="canvas-title" title="Package / Struct / Function">
          <span className="crumb">{PACKAGE_NAME}</span>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span className="crumb">{PRESENTATION_STRUCT_NAME}</span>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span className="crumb crumb-strong">
            {selectedFunc !== null ? `${selectedFunc.name}()` : "—"}
          </span>
          {selectedFunc?.isMain ? <span className="main-badge">MAIN</span> : null}
          <span className="cmd-count">
            {selectedCount} {selectedCount === 1 ? "block" : "blocks"}
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
              <defs>
                <marker
                  id="arrow-flow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 9 5 L 0 9 z" className="marker-flow" />
                </marker>
              </defs>
              {edges.map((edge) => (
                <path
                  key={edge.key}
                  d={edge.d}
                  data-fid={edge.fid}
                  markerEnd="url(#arrow-flow)"
                  className={
                    edge.from === selectedCommandId && edge.fid === selectedFunctionId
                      ? "edge edge-selected"
                      : "edge"
                  }
                />
              ))}
              {preview !== null
                ? (() => {
                    const sourceCmds = commandsByFunction[preview.fid] ?? [];
                    const sourceIndex = sourceCmds.findIndex(
                      (c) => c.id === preview.sourceId,
                    );
                    const source =
                      sourceIndex >= 0 ? sourceCmds[sourceIndex] : undefined;
                    if (source === undefined) return null;
                    const origin = blockWorld(
                      preview.fid,
                      source,
                      Math.max(0, sourceIndex),
                    );
                    const size = sizeOf(preview.fid, preview.sourceId);
                    const ox = origin.x + size.w;
                    const oy = origin.y + size.h / 2;
                    return (
                      <path
                        d={edgePath(ox, oy, preview.x, preview.y, true)}
                        className="edge edge-preview"
                      />
                    );
                  })()
                : null}
            </svg>
            {/* Hand-drawn wobble for the sketch containers. */}
            <svg width="0" height="0" aria-hidden="true" focusable="false">
              <defs>
                <filter id="sketch" x="-5%" y="-5%" width="110%" height="110%">
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency="0.015"
                    numOctaves="2"
                    seed="7"
                    result="noise"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="noise"
                    scale="2.2"
                  />
                </filter>
              </defs>
            </svg>
            <div
              className="pkg-pos"
              style={{ left: layout.pkgPos.x, top: layout.pkgPos.y }}
            >
              <PackageContainer
                functionCount={functions.length}
                width={pkgW}
                height={pkgH}
              >
                <div
                  className="struct-pos"
                  style={{ left: PKG_PAD, top: PKG_PAD }}
                >
                  <StructContainer width={structW} height={structH}>
                    {functions.map((fn) => {
                      const cmds = commandsByFunction[fn.id] ?? [];
                      const fHeight = funcHeights.get(fn.id) ?? FUNC_MIN_HEIGHT;
                      const fWidth =
                        layout.widths.get(fn.id) ?? FUNC_MIN_WIDTH;
                      return (
                        <FunctionContainer
                          key={fn.id}
                          func={fn}
                          selected={fn.id === selectedFunctionId}
                          blockCount={cmds.length}
                          width={fWidth}
                          height={fHeight}
                          position={{
                            x: STRUCT_PAD,
                            y: funcY.get(fn.id) ?? STRUCT_PAD,
                          }}
                          onSelect={() => onSelectFunction(fn.id)}
                        >
                          {cmds.map((cmd, index) => (
                            <div
                              key={cmd.id}
                              ref={(el) => {
                                const key = `${fn.id}:${cmd.id}`;
                                if (el !== null) {
                                  const inner = el.querySelector(".vblock");
                                  if (inner instanceof HTMLDivElement) {
                                    blockEls.current.set(key, inner);
                                  }
                                } else {
                                  blockEls.current.delete(key);
                                }
                              }}
                            >
                              <VisualBlock
                                command={cmd}
                                fid={fn.id}
                                functionName={fn.name}
                                index={index}
                                position={dragEffectivePos(fn.id, cmd, index)}
                                selected={
                                  cmd.id === selectedCommandId &&
                                  fn.id === selectedFunctionId
                                }
                                failed={
                                  cmd.id === errorId &&
                                  (errorFunctionId === null ||
                                    fn.id === errorFunctionId)
                                }
                                connectFrom={
                                  preview?.sourceId === cmd.id &&
                                  preview?.fid === fn.id
                                }
                                interactive={fn.id === selectedFunctionId}
                              />
                            </div>
                          ))}
                          {cmds.length === 0 ? (
                            <div className="funcc-empty">
                              <strong>No blocks yet</strong>
                              <span>
                                {fn.id === selectedFunctionId
                                  ? "Drag a block from the library to start building this function."
                                  : "Select this function, then add blocks."}
                              </span>
                              {fn.id === selectedFunctionId ? (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={onRequestLibrary}
                                >
                                  Open block library
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </FunctionContainer>
                      );
                    })}
                  </StructContainer>
                </div>
              </PackageContainer>
            </div>
          </div>
        </div>
        {emptyWorkspace ? (
          <div className="canvas-empty">
            <strong>No blocks yet</strong>
            <span>
              Drag a block from the library to start building{" "}
              {breadcrumbPath(selectedFunc?.name ?? null)}.
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
