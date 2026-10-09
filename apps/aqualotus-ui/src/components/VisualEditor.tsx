import {
  useCallback,
  useEffect,
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
  anchorScroll,
  clampZoom,
  filterVisibleBlocks,
  isZoomWheel,
  pinchFactor,
  screenToWorld,
  visibleWorldRect,
  wheelDeltaPx,
  zoomFactorForWheel,
  ZOOM_STEP,
  type ViewRect,
} from "../lib/history";
import {
  breadcrumbPath,
  PACKAGE_NAME,
  PRESENTATION_STRUCT_NAME,
} from "../lib/workspace";
import { isTauriShell } from "../lib/env";
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

/** Overscan (world units) around the viewport for smooth panning. */
const VIEW_OVERSCAN = 800;

/** Program-model geometry (world coordinates, before zoom). Titles sit
 *  on the top border, so heads consume no layout space. The package
 *  starts at the world center so panning is unbounded in all four
 *  directions (Excalidraw-style); only `chromeLeft`/`pkgOff` shift it.
 *
 *  The canvas stays unlimited (a 40000-unit scroll space): WebKit
 *  cost comes from mounted DOM/SVG surfaces, not from scrollable
 *  emptiness, so the fix is viewport culling of blocks + a
 *  viewport-sized edges overlay — never a finite canvas. */
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

function toCanvas(
  board: HTMLDivElement,
  clientX: number,
  clientY: number,
  zoom: number,
): Pos {
  const rect = board.getBoundingClientRect();
  return screenToWorld(
    clientX,
    clientY,
    rect.left,
    rect.top,
    board.scrollLeft,
    board.scrollTop,
    zoom,
  );
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
    zoomTo(zoomRef.current * factor, pkgCenter());
  }

  function pkgCenter(): Pos {
    return {
      x: layout.pkgPos.x + pkgW / 2,
      y: layout.pkgPos.y + pkgH / 2,
    };
  }

  /**
   * Zoom to an absolute level keeping `anchor` (a world point, already
   * on screen) fixed on screen. Used by incremental zoom — buttons,
   * reset, wheel, pinch — so zooming never flings the canvas into an
   * empty region. NOT for Fit: fitting centers instead (see `fitView`).
   */
  function zoomTo(afterRaw: number, anchor: Pos, record = true): void {
    const board = boardRef.current;
    const before = zoomRef.current;
    const after = clampZoom(afterRaw);
    if (board === null) {
      setZoom(after);
      if (record) commitZoom(before, after);
      return;
    }
    if (Math.abs(before - after) < 1e-9) {
      if (record) commitZoom(before, after);
      return;
    }
    setZoom(after);
    if (record) commitZoom(before, after);
    const left = Math.max(
      0,
      anchorScroll(board.scrollLeft, anchor.x, before, after),
    );
    const top = Math.max(
      0,
      anchorScroll(board.scrollTop, anchor.y, before, after),
    );
    // Sync first (covers already-laid-out boards), then once more on
    // the next frame (covers boards mid-layout, e.g. Tauri startup).
    board.scrollLeft = left;
    board.scrollTop = top;
    requestAnimationFrame(() => {
      board.scrollLeft = left;
      board.scrollTop = top;
    });
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
      // Unlimited scroll space: a large spacer is nearly free (no DOM
      // or SVG lives in the emptiness). Rendering cost is bounded by
      // viewport culling of blocks + the viewport-sized edges overlay
      // below, so the canvas never becomes finite to save memory.
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

  // Viewport tracking for block culling + startup fit: the scrollable
  // board reports its scroll + client size. `null` means unmeasured —
  // callers that need geometry must treat it as "not ready, retry
  // later", never as an empty rect.
  const [viewport, setViewport] = useState<ViewRect | null>(null);

  // Default view: Tauri startup fits the package like the Fit button
  // (centered, no view-undo step — there is no user action to undo);
  // web startup keeps the classic 100% park below the toolbar. The
  // one-shot guard is consumed ONLY by a real settle: if the board has
  // no size yet (WebView still setting up its window — the Tauri
  // cold-start case) a rAF poll retries until the board is measurable,
  // plus a resize listener catches late window changes. Without the
  // retry, nothing ever re-runs this effect (no data or layout change
  // follows), stranding the program off-screen at 100%.
  // Later panel toggles or selections never move the canvas.
  const scrolledInitRef = useRef<boolean>(false);
  useEffect(() => {
    if (scrolledInitRef.current) return;
    let cancelled = false;
    let attempts = 0;
    function settle(board: HTMLDivElement): void {
      scrolledInitRef.current = true;
      const vw = board.clientWidth;
      const vh = board.clientHeight;
      const px = layout.pkgPos.x;
      const py = layout.pkgPos.y;
      if (functions.length === 0 || vw <= 0 || vh <= 0) {
        board.scrollLeft = Math.max(0, px - 80);
        board.scrollTop = Math.max(0, py - 170);
        return;
      }
      if (!isTauriShell()) {
        // Web startup keeps the classic behavior: park at 100% below
        // the floating toolbar. No zoom change, no centering.
        board.scrollLeft = Math.max(0, px - 80);
        board.scrollTop = Math.max(0, py - 170);
        return;
      }
      // Tauri startup fits the package like the Fit button (centered).
      // At cold start the package is by definition not on screen yet, so
      // this centers rather than anchor-preserves.
      const next = clampZoom(
        Math.min(vw / (layout.pkgW + 160), vh / (layout.pkgH + 160)),
      );
      setZoom(next);
      const cx = layout.pkgPos.x + layout.pkgW / 2;
      const cy = layout.pkgPos.y + layout.pkgH / 2;
      const left = Math.max(0, cx * next - vw / 2);
      const top = Math.max(0, cy * next - vh / 2);
      board.scrollLeft = left;
      board.scrollTop = top;
      requestAnimationFrame(() => {
        if (!cancelled) {
          board.scrollLeft = left;
          board.scrollTop = top;
        }
      });
    }
    function attempt(): void {
      if (cancelled || scrolledInitRef.current) return;
      const board = boardRef.current;
      if (board === null) return;
      if (
        (board.clientWidth <= 0 || board.clientHeight <= 0) &&
        attempts < 600
      ) {
        // Board not laid out yet — poll, don't consume the one-shot.
        attempts += 1;
        requestAnimationFrame(attempt);
        return;
      }
      settle(board);
    }
    function onResize(): void {
      if (!scrolledInitRef.current) attempt();
    }
    attempt();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [layout.pkgPos, layout.pkgW, layout.pkgH, viewport, functions.length]);

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

  // The scroll/size subscription feeding the viewport state above.
  // Edges outside the overscanned viewport are not turned into SVG
  // paths. Presentation only — the program graph is untouched and every
  // block stays mounted (hit testing, selection, keyboard access
  // preserved).
  useEffect(() => {
    const found = boardRef.current;
    if (found === null) return;
    const board: HTMLDivElement = found;
    let raf = 0;
    function read(): void {
      // No layout yet (hidden board, jsdom): keep `null` so every edge
      // renders rather than culling the whole graph against a zero rect.
      if (board.clientWidth === 0 && board.clientHeight === 0) return;
      setViewport((prev) => {
        const next = visibleWorldRect(
          board.scrollLeft,
          board.scrollTop,
          board.clientWidth === 0 ? 1200 : board.clientWidth,
          board.clientHeight === 0 ? 800 : board.clientHeight,
          zoomRef.current,
        );
        if (
          prev !== null &&
          Math.abs(prev.x - next.x) < 1 &&
          Math.abs(prev.y - next.y) < 1 &&
          Math.abs(prev.w - next.w) < 1 &&
          Math.abs(prev.h - next.h) < 1
        ) {
          return prev;
        }
        return next;
      });
    }
    function onScroll(): void {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        read();
      });
    }
    read();
    board.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      board.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, []);
  // Zoom changes the world mapping without scrolling: refresh culling.
  useEffect(() => {
    const board = boardRef.current;
    if (board === null) return;
    if (board.clientWidth === 0 && board.clientHeight === 0) return;
    setViewport(
      visibleWorldRect(
        board.scrollLeft,
        board.scrollTop,
        board.clientWidth === 0 ? 1200 : board.clientWidth,
        board.clientHeight === 0 ? 800 : board.clientHeight,
        zoom,
      ),
    );
  }, [zoom]);

  // Semantic edges from `next` pointers, in world coordinates,
  // memoized so unrelated state (selection, drag preview, scrolling)
  // never rebuilds the path list (Issue 9). Paint cost is bounded by
  // the viewport-sized SVG overlay below (which clips), not by skipping
  // paths here: the graph itself is never altered, and path building
  // runs once per program edit — never per scroll frame.
  const edges: { key: string; from: number; fid: number; d: string }[] =
    useMemo(() => {
      const out: { key: string; from: number; fid: number; d: string }[] = [];
      for (const fn of functions) {
        const cmds = commandsByFunction[fn.id] ?? [];
        const byId = new Map<number, number>();
        cmds.forEach((c, i) => byId.set(c.id, i));
        for (const cmd of cmds) {
          if (cmd.next === null || cmd.next === undefined) continue;
          const targetIndex = byId.get(cmd.next);
          if (targetIndex === undefined) continue;
          const target = cmds[targetIndex];
          if (target === undefined) continue;
          const sourceIndex = byId.get(cmd.id) ?? 0;
          const a = blockWorld(fn.id, cmd, sourceIndex);
          const b = blockWorld(fn.id, target, targetIndex);
          const sa = sizes.get(`${fn.id}:${cmd.id}`) ?? FALLBACK_SIZE;
          const sb = sizes.get(`${fn.id}:${target.id}`) ?? FALLBACK_SIZE;
          const ends = edgeEnds(
            { x: a.x, y: a.y, w: sa.w, h: sa.h },
            { x: b.x, y: b.y, w: sb.w, h: sb.h },
          );
          out.push({
            key: `${fn.id}:${cmd.id}`,
            from: cmd.id,
            fid: fn.id,
            d: edgePath(ends.x1, ends.y1, ends.x2, ends.y2, ends.horizontal),
          });
        }
      }
      return out;
      // blockWorld/layout intentionally read via layout.* (stable memo).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [functions, commandsByFunction, sizes, layoutStore, layout]);

  const selectedFunc =
    functions.find((f) => f.id === selectedFunctionId) ?? null;
  const selectedCount =
    selectedFunctionId === null
      ? 0
      : (commandsByFunction[selectedFunctionId]?.length ?? 0);

  // Block geometry via ResizeObserver subscription (Issue 12): sizes
  // update on observed resize events, never as a set-state-in-layout
  // sweep over the whole tree each render. Falls back to one rAF
  // measurement when ResizeObserver is unavailable (jsdom/tests).
  useEffect(() => {
    const els = [...blockEls.current.values()];
    if (typeof ResizeObserver === "undefined") {
      if (els.length === 0) return;
      const frame = requestAnimationFrame(() => {
        setSizes((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const [key, el] of blockEls.current) {
            if (el.offsetWidth <= 0) continue;
            const cur = next.get(key);
            if (
              cur?.w !== el.offsetWidth ||
              cur?.h !== el.offsetHeight
            ) {
              next.set(key, {
                w: el.offsetWidth,
                h: el.offsetHeight,
              });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver((entries) => {
      setSizes((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const key = target.dataset.sizeKey;
          if (key === undefined || key === "") continue;
          const w = entry.contentRect.width;
          const h = entry.contentRect.height;
          if (w <= 0 || h <= 0) continue;
          const cur = next.get(key);
          if (cur?.w !== w || cur?.h !== h) {
            next.set(key, { w, h });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    for (const [key, el] of blockEls.current) {
      el.dataset.sizeKey = key;
      observer.observe(el);
    }
    return () => observer.disconnect();
  });

  // Cursor-anchored canvas zoom at a client point (Issue 10 + canvas-only
  // zoom): the world point under the pointer stays under it, so pinch
  // zoom focuses where the user points instead of sliding away. Held in
  // a ref so window-level capture listeners always call the fresh
  // closure without re-subscribing.
  const zoomAtCursorRef = useRef<
    ((clientX: number, clientY: number, deltaY: number) => void) | null
  >(null);
  const zoomByRef = useRef((factor: number): void => {
    void factor;
  });
  useEffect(() => {
    zoomByRef.current = zoomBy;
    zoomAtCursorRef.current = (
      clientX: number,
      clientY: number,
      deltaY: number,
    ): void => {
      const board = boardRef.current;
      if (board === null) return;
      const burst = wheelBurstRef.current;
      if (burst.timer === null) {
        burst.start = zoomRef.current;
      } else {
        window.clearTimeout(burst.timer);
      }
      const rect = board.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      setZoom((z) => {
        const next = clampZoom(z * zoomFactorForWheel(deltaY, true));
        if (Math.abs(next - z) < 1e-9) return z;
        const wx = (board.scrollLeft + mx) / z;
        const wy = (board.scrollTop + my) / z;
        const left = anchorScroll(board.scrollLeft, wx, z, next);
        const top = anchorScroll(board.scrollTop, wy, z, next);
        requestAnimationFrame(() => {
          board.scrollLeft = Math.max(0, left);
          board.scrollTop = Math.max(0, top);
        });
        return next;
      });
      burst.timer = window.setTimeout(() => {
        burst.timer = null;
        commitZoom(burst.start, zoomRef.current);
      }, 600);
    };
  });

  // App-wide zoom-gesture routing: a zoom gesture must NEVER scale the
  // page — it drives the canvas when the pointer is over it and is
  // swallowed everywhere else (panels, toolbar, dialogs). Board-level
  // listeners alone leak: floating overlays sit above #board, so
  // gestures starting on them bubble past the board straight to the
  // browser's page zoom. Capture-phase window listeners see every
  // gesture first on all engines (Chromium, WebKit, WebKitGTK, Tauri).
  //
  // Plain wheel / two-finger scroll (no modifier) is untouched and pans
  // natively, so trackpad scrolling stays smooth and never zooms.
  useEffect(() => {
    function overBoard(target: EventTarget | null): boolean {
      const board = boardRef.current;
      return (
        board !== null &&
        target instanceof Element &&
        board.contains(target)
      );
    }
    function onWheelCapture(e: WheelEvent): void {
      if (!isZoomWheel(e)) return;
      // Always prevent: no gesture may page-zoom the app.
      e.preventDefault();
      if (!overBoard(e.target)) return;
      zoomAtCursorRef.current?.(
        e.clientX,
        e.clientY,
        wheelDeltaPx(e.deltaY, e.deltaMode),
      );
    }
    // Legacy WebKit gesture events (Safari/WKWebView page pinch-zoom):
    // swallowed app-wide; the canvas path above owns pinch instead.
    function onGesture(e: Event): void {
      e.preventDefault();
    }
    // Browser zoom hotkeys with canvas focus drive canvas zoom instead
    // of the page (typing in inputs is never hijacked).
    function onKeyZoom(e: KeyboardEvent): void {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key !== "+" && e.key !== "=" && e.key !== "-" && e.key !== "_" && e.key !== "0") {
        return;
      }
      const target = e.target as Element | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (!overBoard(e.target)) return;
      e.preventDefault();
      if (e.key === "0") {
        const before = zoomRef.current;
        setZoom(1);
        commitZoom(before, 1);
      } else if (e.key === "+" || e.key === "=") {
        zoomByRef.current(ZOOM_STEP);
      } else {
        zoomByRef.current(1 / ZOOM_STEP);
      }
    }
    window.addEventListener("wheel", onWheelCapture, {
      passive: false,
      capture: true,
    });
    window.addEventListener("gesturestart", onGesture, { capture: true });
    window.addEventListener("gesturechange", onGesture, { capture: true });
    window.addEventListener("gestureend", onGesture, { capture: true });
    window.addEventListener("keydown", onKeyZoom, { capture: true });
    const burst = wheelBurstRef.current;
    return () => {
      window.removeEventListener("wheel", onWheelCapture, { capture: true });
      window.removeEventListener("gesturestart", onGesture, { capture: true });
      window.removeEventListener("gesturechange", onGesture, { capture: true });
      window.removeEventListener("gestureend", onGesture, { capture: true });
      window.removeEventListener("keydown", onKeyZoom, { capture: true });
      if (burst.timer !== null) {
        window.clearTimeout(burst.timer);
        burst.timer = null;
      }
    };
    // zoomBy/commitZoom intentionally read via refs / stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    | { kind: "pinch"; startZoom: number; lastDist: number }
    | null
  >(null);
  // Live touch/mouse points by pointerId. A second concurrent pointer
  // turns any in-progress gesture into a canvas-only pinch zoom.
  const pointersRef = useRef(new Map<number, Pos>());
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
    if (vw <= 0 || vh <= 0) return;
    // Fit the package (not the infinite world) into view, centered.
    // Centering (not anchor-preserving): Fit is the recovery action for
    // a lost canvas, so it must move the package on screen even when
    // the current view shows only emptiness.
    const next = clampZoom(
      Math.min(vw / (pkgW + 160), vh / (pkgH + 160)),
    );
    const before = zoomRef.current;
    setZoom(next);
    commitZoom(before, next);
    const c = pkgCenter();
    const left = Math.max(0, c.x * next - vw / 2);
    const top = Math.max(0, c.y * next - vh / 2);
    board.scrollLeft = left;
    board.scrollTop = top;
    requestAnimationFrame(() => {
      board.scrollLeft = left;
      board.scrollTop = top;
    });
  }

  function onBoardPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (busy) return;
    const board = boardRef.current;
    if (board === null) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      // Second finger down: whatever was in flight becomes a pinch.
      // Canvas-only by construction (this handler lives on the board).
      const pts = [...pointersRef.current.values()];
      const first = pts[0] ?? { x: 0, y: 0 };
      const second = pts[1] ?? { x: 0, y: 0 };
      gestureRef.current = {
        kind: "pinch",
        startZoom: zoomRef.current,
        lastDist: Math.hypot(second.x - first.x, second.y - first.y),
      };
      movedRef.current = true;
      dragPosRef.current = null;
      setDragPos(null);
      setPreview(null);
      return;
    }
    if (pointersRef.current.size > 2) return;
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

  // Coalesced pointer handling (Issue 9): pointermove fires far more
  // often than frames. The latest event per gesture is applied once per
  // rAF, so dragging stays at most one render per frame and no bridge
  // call happens mid-drag (commits fire on pointer-up only).
  const pendingMoveRef = useRef<React.PointerEvent<HTMLDivElement> | null>(
    null,
  );
  const moveRafRef = useRef<number>(0);

  function applyPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const gesture = gestureRef.current;
    const board = boardRef.current;
    if (gesture === null || board === null) return;
    if (gesture.kind === "pinch") {
      // Two-finger touch pinch: 1:1 finger tracking anchored at the
      // midpoint, so the canvas zooms under the fingers and the rest
      // of the app never moves.
      const pts = [...pointersRef.current.values()];
      if (pts.length < 2) return;
      const first = pts[0] ?? { x: 0, y: 0 };
      const second = pts[1] ?? { x: 0, y: 0 };
      const dist = Math.hypot(second.x - first.x, second.y - first.y);
      const factor = pinchFactor(gesture.lastDist, dist);
      gesture.lastDist = dist;
      const z = zoomRef.current;
      const next = clampZoom(z * factor);
      if (Math.abs(next - z) < 1e-9) return;
      const rect = board.getBoundingClientRect();
      const mx = (first.x + second.x) / 2 - rect.left;
      const my = (first.y + second.y) / 2 - rect.top;
      const wx = (board.scrollLeft + mx) / z;
      const wy = (board.scrollTop + my) / z;
      setZoom(next);
      const left = anchorScroll(board.scrollLeft, wx, z, next);
      const top = anchorScroll(board.scrollTop, wy, z, next);
      requestAnimationFrame(() => {
        board.scrollLeft = Math.max(0, left);
        board.scrollTop = Math.max(0, top);
      });
      return;
    }
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

  function onBoardPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (gestureRef.current === null) return;
    if (gestureRef.current.kind === "pinch") {
      // Pinch applies synchronously: touch input is already frame-paced
      // by the OS (and independent of rAF delivery), and the branch
      // reads positions from the pointer map, not the event.
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      applyPointerMove(e);
      return;
    }
    pendingMoveRef.current = e;
    if (moveRafRef.current !== 0) return;
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = 0;
      const latest = pendingMoveRef.current;
      pendingMoveRef.current = null;
      if (latest !== null) applyPointerMove(latest);
    });
  }

  useEffect(() => {
    return () => {
      if (moveRafRef.current !== 0) cancelAnimationFrame(moveRafRef.current);
    };
  }, []);

  function endGesture(e: React.PointerEvent<HTMLDivElement>): void {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    pointersRef.current.delete(e.pointerId);
    if (gesture?.kind === "pinch") {
      // Pinch ends: record one view-undo step, change nothing else —
      // no selection, no deselect, no bridge calls.
      if (moveRafRef.current !== 0) {
        cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = 0;
      }
      pendingMoveRef.current = null;
      commitZoom(gesture.startZoom, zoomRef.current);
      movedRef.current = false;
      selectStampRef.current = Date.now();
      return;
    }
    // Flush a coalesced move waiting on rAF so pointer-up commits the
    // final position even when the frame has not run yet (and in test
    // environments without frame delivery).
    if (moveRafRef.current !== 0) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = 0;
      const latest = pendingMoveRef.current;
      pendingMoveRef.current = null;
      if (latest !== null && gesture !== null) {
        // Re-arm the gesture transiently: applyPointerMove reads the ref.
        gestureRef.current = gesture;
        applyPointerMove(latest);
        gestureRef.current = null;
      }
    } else {
      pendingMoveRef.current = null;
    }
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

  // Viewport culling of blocks (WebKit fix): only blocks intersecting
  // the overscanned viewport are mounted — plus pinned ids that must
  // stay interactive regardless of position (selection, error highlight,
  // connection source, block being dragged). Containers, counts, edges
  // (data), and the program graph are unaffected; a `null` viewport
  // (no layout yet) mounts everything. Filtering a few thousand rects
  // per render is sub-millisecond; `VisualBlock` memo keeps the mounted
  // set from re-rendering on scroll.
  const pinnedBlocks = useMemo(() => {
    const pinned = new Set<number>();
    if (selectedCommandId !== null) pinned.add(selectedCommandId);
    if (errorId !== null) pinned.add(errorId);
    if (preview !== null) pinned.add(preview.sourceId);
    if (dragPos !== null) pinned.add(dragPos.id);
    return pinned;
  }, [selectedCommandId, errorId, preview, dragPos]);
  function visibleCmds(
    fid: number,
    cmds: readonly CommandSummary[],
  ): { cmd: CommandSummary; index: number }[] {
    const items = cmds.map((cmd, index) => {
      const origin = blockWorld(fid, cmd, index);
      const size = sizes.get(`${fid}:${cmd.id}`) ?? FALLBACK_SIZE;
      return {
        cmd,
        index,
        id: cmd.id,
        rect: { x: origin.x, y: origin.y, w: size.w, h: size.h },
      };
    });
    return filterVisibleBlocks(items, viewport, VIEW_OVERSCAN, pinnedBlocks)
      .visible;
  }
  let culledBlocks = 0;
  if (viewport !== null) {
    for (const fn of functions) {
      const cmds = commandsByFunction[fn.id] ?? [];
      const items = cmds.map((cmd, index) => {
        const origin = blockWorld(fn.id, cmd, index);
        const size = sizes.get(`${fn.id}:${cmd.id}`) ?? FALLBACK_SIZE;
        return {
          id: cmd.id,
          rect: { x: origin.x, y: origin.y, w: size.w, h: size.h },
        };
      });
      culledBlocks += filterVisibleBlocks(
        items,
        viewport,
        VIEW_OVERSCAN,
        pinnedBlocks,
      ).culled;
    }
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
          {culledBlocks > 0 ? (
            <span
              className="cull-count"
              title="Off-screen blocks are unmounted to keep WebKit compositing cheap; the program graph is unaffected"
            >
              {culledBlocks} culled
            </span>
          ) : null}
        </span>
        <span className="canvas-tools">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            −
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Zoom level ${Math.round(zoom * 100)} percent. Activate to reset zoom to 100 percent.`}
            onClick={() => zoomTo(1, pkgCenter())}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Zoom in"
            onClick={() => zoomBy(ZOOM_STEP)}
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
          pointersRef.current.clear();
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
            {/* Viewport-sized edges overlay (WebKit fix): the SVG surface
              covers the visible window only and clips the world-space
              paths — never a 40000-unit layer. Paths stay mounted (cheap
              SVG, no DOM per node); only their paint is clipped. Before
              layout is measured (`viewport === null`) the full-world SVG
              renders so nothing is missing in tests / first paint. */}
            {viewport === null ? (
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
            ) : (
              <svg
                id="links"
                className="links"
                style={{ left: viewport.x, top: viewport.y }}
                width={viewport.w}
                height={viewport.h}
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
                <g transform={`translate(${-viewport.x} ${-viewport.y})`}>
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
                </g>
              </svg>
            )}
            {/* Sketch wobble is CSS-only (Issue 8): the old
              `feTurbulence` displacement filter rasterized every
              container border on the GPU — prohibitive on HiDPI/HDR
              multi-display — so hand-drawn character now comes from
              asymmetric border radii alone. */}
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
                          {visibleCmds(fn.id, cmds).map(({ cmd, index }) => (
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
