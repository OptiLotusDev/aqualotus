import {
  Fragment,
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
import {
  branchEdgeEnds,
  columnEdgeEnds,
  edgeEnds,
  edgePath,
  edgesOf,
  joinDefaultPos,
  JOIN_FALLBACK_SIZE,
  mergeEdgesOf,
  mergeJoinRailsOf,
  portEdgeEnds,
  verticalEdgePath,
  branchOwnerOf,
  buildIfShapes,
  BRANCH_PORT_FRACTION,
  type BlockRect,
  type BlockSide,
  type BranchSide,
  type IfShape,
  type MergeJoin,
  type PortRole,
} from "../lib/graph";
import { resolveBranchConnect } from "../lib/branching";
import type { UiCommand } from "../lib/program";
import type { FlowState } from "../lib/flow";
import type { LayoutMap, Pos } from "../lib/layout";
import {
  branchDropPos,
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
  rectsIntersect,
  screenToWorld,
  visibleWorldRect,
  wheelDeltaPx,
  withOverscan,
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
import { useExitItems } from "../hooks/useExitItems";
import { useReducedMotion } from "../hooks/useReducedMotion";
import FlowTravel from "./FlowTravel";
import VisualBlock from "./VisualBlock";
import PackageContainer from "./PackageContainer";
import RevealText from "./RevealText";
import StructContainer from "./StructContainer";
import FunctionContainer from "./FunctionContainer";

interface VisualEditorProps {
  readonly functions: readonly FunctionSummary[];
  readonly commandsByFunction: Readonly<
    Record<number, readonly CommandSummary[]>
  >;
  readonly layoutStore: Readonly<Record<number, LayoutMap>>;
  readonly selectedFunctionId: FunctionId | null;
  readonly selectedCommandId: CommandId | null;
  /**
   * The **visible** block the current failure points at, or `null` when
   * the failure cannot be attributed to a block the canvas knows.
   *
   * The engine's own id names an internal node; the projection resolves
   * it to a visible block before it reaches the canvas, so no block is
   * ever highlighted for a failure that has no visible owner.
   */
  readonly errorId: CommandId | null;
  /** The function that owns {@link VisualEditorProps.errorId}. */
  readonly errorFunctionId: FunctionId | null;
  readonly busy: boolean;
  readonly onSelectFunction: (id: FunctionId) => void;
  readonly onSelectCommand: (id: CommandId | null) => void;
  readonly onReconnect: (
    fid: FunctionId,
    sourceId: CommandId,
    targetId: CommandId | null,
    where: "after" | "before" | "end",
    side?: BlockSide,
  ) => boolean;
  readonly onMoveBlock: (
    fid: FunctionId,
    id: CommandId,
    pos: Pos,
  ) => void;
  /**
   * The manual merge-join state per `if` id ("End of If Block").
   * `on` switches the join circle on; `pos` is the user-dragged spot in
   * function-container coordinates (`null` = auto-placed below the
   * branch frames). Absent/`off` entries draw the classic direct
   * tail→continuation rails. Presentation state only — UI-owned.
   */
  readonly mergeJoins?: Readonly<Record<number, MergeJoin>>;
  /** Commit the dragged join circle's new spot (same state as mergeJoins). */
  readonly onMoveJoin?: (ifId: CommandId, pos: Pos) => void;
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
  /**
   * The condition expression the engine reports for an `if`
   * (`if_condition`), or null when the bridge cannot recover it. The
   * summary's own `condition` field is a hidden value id, so the card
   * only shows the user's text through this probe — nothing guessed.
   */
  readonly conditionTextFor?: (fid: FunctionId, ifId: CommandId) => string | null;
  /** Running execution-flow visualisation (presentation only). */
  readonly flow?: FlowState | null;
}

interface Size {
  readonly w: number;
  readonly h: number;
}

/** One connection as the edges layer draws it (from the planners +
 * branch/merge derivation). */
interface DrawnEdge {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly fid: number;
  readonly d: string;
  /** The engine cannot report this edge (the planned `into an if` gap). */
  readonly planned: boolean;
  /** A merge wire or the `if`'s own post-body continuation rail. */
  readonly merge: boolean;
  /**
   * Manual-merge mode: this rail ends at the branch's join circle
   * ("End of If Block") instead of running straight to the continuation;
   * `joinIfId` names the `if` whose `jo:` continuation wire carries the
   * flow onward (the execution-path expansion goes through both).
   */
  readonly joinTail?: boolean;
  readonly joinIfId?: number;
}

const FALLBACK_SIZE: Size = { w: 216, h: 104 };

/** Overscan (world units) around the viewport for smooth panning. */
const VIEW_OVERSCAN = 800;

/** Program-model geometry (world coordinates, before zoom). Titles sit
 *  on the top border, so heads consume no layout space. The package
 *  starts at the world center so panning is unbounded in all four
 *  directions (Excalidraw-style); only `pkgOff` shifts it. The panels
 *  float above the canvas and never move the content.
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

/** Stretch animation of a freshly created connection, in milliseconds. */
const EDGE_DRAW_MS = 110;

/** Shared empty set for the "currently drawing" edges. */
const EMPTY_EDGE_KEYS: ReadonlySet<string> = new Set<string>();

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
    conditionTextFor,
    mergeJoins,
    onMoveJoin,
    flow = null,
  } = props;

  const boardRef = useRef<HTMLDivElement | null>(null);
  const blockEls = useRef(new Map<string, HTMLDivElement>());
  // The rendered connection paths: the travelling indicator rides them.
  const edgeEls = useRef(new Map<string, SVGPathElement>());
  // Reduced motion: the design guide drops the travel, not the fades.
  const reducedMotion = useReducedMotion();
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

  // Vertical If/Else shapes: one derived record per `if` — branch
  // membership, container frames, and merge target — rebuilt from the
  // engine summaries + the UI's own relative layout whenever either
  // changes. Rects stay *relative* to their function container (the
  // same coordinates `layoutStore` stores); the edges below convert to
  // world space per function. Memoized like `edges` so selection,
  // dragging, and scrolling never rebuild it.
  const ifShapesByFunction = useMemo(() => {
    const out = new Map<number, readonly IfShape[]>();
    for (const fn of functions) {
      const cmds = commandsByFunction[fn.id] ?? [];
      const byIndex = new Map<number, number>();
      cmds.forEach((cmd, i) => byIndex.set(cmd.id, i));
      const store = layoutStore[fn.id];
      const rectOf = (id: number): BlockRect | undefined => {
        const cmd = cmds[byIndex.get(id) ?? -1];
        if (cmd === undefined) return undefined;
        const p = store?.[cmd.id] ?? fallbackPos(byIndex.get(id) ?? 0);
        const s = sizes.get(`${fn.id}:${id}`) ?? FALLBACK_SIZE;
        return { x: p.x, y: p.y, w: s.w, h: s.h };
      };
      out.set(fn.id, buildIfShapes(cmds, rectOf, rectOf));
    }
    return out;
    // `blockWorld`/layout read via layoutStore/sizes directly; `pkgOff`
    // must not re-derive shapes (only `layout` below shifts the world).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [functions, commandsByFunction, layoutStore, sizes]);

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
      // The vertical If/Else body frames hang below their `if` card: the
      // function container must span them too (they are presentation,
      // but a frame poking out of its function border reads broken).
      for (const shape of ifShapesByFunction.get(fn.id) ?? []) {
        for (const frame of shape.frames) {
          bottom = Math.max(bottom, frame.rect.y + frame.rect.h);
          right = Math.max(right, frame.rect.x + frame.rect.w);
        }
      }
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
    // The world origin never depends on the open panels: a floating
    // panel overlays the canvas, it never reflows it, so opening one
    // cannot move a single block.
    const pkgPos: Pos = {
      x: WORLD_CENTER + pkgOff.x,
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
    pkgOff,
    ifShapesByFunction,
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
  const edges: DrawnEdge[] = useMemo(() => {
    const out: DrawnEdge[] = [];
    for (const fn of functions) {
      const cmds = commandsByFunction[fn.id] ?? [];
      const byId = new Map<number, number>();
      cmds.forEach((c, i) => byId.set(c.id, i));
      // Which branch a chain edge runs *inside* of: two members of the
      // same body run top → bottom, so their link is drawn as a
      // vertical column edge instead of the classic left → right one.
      const owners = branchOwnerOf(cmds);
      const worldRect = (c: CommandSummary, i: number): BlockRect => {
        const p = blockWorld(fn.id, c, i);
        const s = sizes.get(`${fn.id}:${c.id}`) ?? FALLBACK_SIZE;
        return { x: p.x, y: p.y, w: s.w, h: s.h };
      };
      // The manual merge join state of this function's `if`s — keyed by
      // the (globally unique) `if` id. Presentation only, UI-owned.
      const joinOn = (ifId: number): boolean =>
        mergeJoins?.[ifId]?.on === true;
      // One planner for the whole canvas: the chain edges (the
      // engine's own `next` pointers plus the connections the engine
      // accepted but cannot report) and the branch wires (the `if`'s
      // bottom port to the head of a branch). The planner only ever
      // names visible blocks, so a wire never starts or ends at a
      // hidden raw node (the `if`'s condition compute, a print's
      // tail).
      for (const edge of edgesOf(cmds)) {
        const fromIndex = byId.get(edge.from);
        const toIndex = byId.get(edge.to);
        if (fromIndex === undefined || toIndex === undefined) continue;
        const from = cmds[fromIndex];
        const to = cmds[toIndex];
        if (from === undefined || to === undefined) continue;
        const a = worldRect(from, fromIndex);
        const b = worldRect(to, toIndex);
        if (edge.branch !== null) {
          // Branch wire: the `if`'s bottom TRUE/FALSE port down into
          // the head of the branch (the body's first *visible*
          // member). The head is entered through its top edge — a
          // branch body reads top → bottom.
          const ends = branchEdgeEnds(a, b, edge.branch);
          out.push({
            key: `${fn.id}:branch:${edge.branch}:${edge.from}:head`,
            from: edge.from,
            to: edge.to,
            fid: fn.id,
            d: verticalEdgePath(ends.x1, ends.y1, ends.x2, ends.y2),
            planned: false,
            merge: false,
          });
          continue;
        }
        // The `if` card carries no right out-port: its continuation
        // never leaves the card directly. Join off — the branch tails'
        // merge rails carry the flow onward (below); join on — the
        // manual join circle's own wire does (also below). One drawn
        // truth per connection, never two.
        if (from.kind === "if") continue;
        const ownerFrom = owners.get(edge.from);
        const ownerTo = owners.get(edge.to);
        if (
          ownerFrom !== undefined &&
          ownerTo !== undefined &&
          ownerFrom.ifId === ownerTo.ifId &&
          ownerFrom.branch === ownerTo.branch
        ) {
          // Column link: member → next member of the same body.
          const ends = columnEdgeEnds(a, b);
          out.push({
            key: `${fn.id}:${edge.from}`,
            from: edge.from,
            to: edge.to,
            fid: fn.id,
            d: verticalEdgePath(ends.x1, ends.y1, ends.x2, ends.y2),
            planned: edge.planned,
            merge: false,
          });
          continue;
        }
        // Every chain edge reads left → right through the side ports —
        // the `if` card's input is its left in-port (its TRUE/FALSE
        // pair enters the branch bodies, never the card's top).
        const ends = edgeEnds(a, b);
        out.push({
          key: `${fn.id}:${edge.from}`,
          from: edge.from,
          to: edge.to,
          fid: fn.id,
          d: ends.horizontal
            ? edgePath(ends.x1, ends.y1, ends.x2, ends.y2, true)
            : verticalEdgePath(ends.x1, ends.y1, ends.x2, ends.y2),
          planned: edge.planned,
          // No chain edge leaves the `if` card any more (no right
          // port): only ordinary blocks chain side to side here.
          merge: false,
        });
      }
      // Merge rails (join off): each populated branch's tail runs back
      // into the block after the `if` (the engine's documented join —
      // the body walk stops at the tail and flow continues at the
      // `if`'s own `next`). Engine truth, never a reported pointer.
      // With the join on, the circular join of the same fact is drawn
      // from `mergeJoinRailsOf` below instead.
      for (const merge of mergeEdgesOf(cmds)) {
        if (joinWorldRect(fn.id, merge.ifId) !== null) continue;
        const fromIndex = byId.get(merge.from);
        const toIndex = byId.get(merge.to);
        if (fromIndex === undefined || toIndex === undefined) continue;
        const from = cmds[fromIndex];
        const to = cmds[toIndex];
        if (from === undefined || to === undefined) continue;
        const ends = edgeEnds(worldRect(from, fromIndex), worldRect(to, toIndex));
        out.push({
          key: `${fn.id}:merge:${merge.from}`,
          from: merge.from,
          to: merge.to,
          fid: fn.id,
          d: edgePath(ends.x1, ends.y1, ends.x2, ends.y2, ends.horizontal),
          planned: false,
          merge: true,
        });
      }
      // Manual-merge mode (the join circle shown): one incoming rail per
      // TRUE/FALSE branch — a populated branch through its tail's
      // bottom port, an **empty** branch through the `if` card's own
      // TRUE/FALSE port — so both arrows address the circle even when
      // the `if` has no continuation block at all (the circle is the
      // branch flows' destination; `next` is not read here). One
      // circle→continuation wire carries the flow onward, once per `if`
      // (the else branch below).
      for (const rail of mergeJoinRailsOf(cmds)) {
        if (!joinOn(rail.ifId)) continue;
        const join = joinWorldRect(fn.id, rail.ifId);
        if (join === null) continue;
        const fromIndex = byId.get(rail.from);
        const from = fromIndex === undefined ? undefined : cmds[fromIndex];
        if (from === undefined || fromIndex === undefined) continue;
        // A tail's rail leaves the body's bottom port; an empty
        // branch's rail leaves the `if` card's own TRUE/FALSE port.
        const fromRole: PortRole = rail.emptyBranch ? rail.branch : "outBottom";
        const ends = portEdgeEnds(worldRect(from, fromIndex), join, fromRole, "joinIn");
        out.push({
          key: rail.emptyBranch
            ? `${fn.id}:merge:${rail.ifId}:${rail.branch}`
            : `${fn.id}:merge:${rail.from}`,
          from: rail.from,
          // `to` names the join circle's host card: the rail's drawn
          // end is the circle itself (keyed by its `if`), and the
          // `jo:` wire below carries the flow past it.
          to: rail.ifId,
          fid: fn.id,
          d: verticalEdgePath(ends.x1, ends.y1, ends.x2, ends.y2),
          planned: false,
          merge: true,
          joinTail: true,
          joinIfId: rail.ifId,
        });
      }
      // The join circle's continuation wire, once per `if` (every tail
      // rail shares it — the travelled path expands through both
      // without drawing it twice).
      const joinOutSeen = new Set<number>();
      for (const shape of ifShapesByFunction.get(fn.id) ?? []) {
        if (!joinOn(shape.ifId)) continue;
        if (joinOutSeen.has(shape.ifId)) continue;
        joinOutSeen.add(shape.ifId);
        const join = joinWorldRect(fn.id, shape.ifId);
        const contId = shape.join;
        if (join === null || contId === null) continue;
        const contIndex = byId.get(contId);
        const cont = contIndex === undefined ? undefined : cmds[contIndex];
        if (cont === undefined || contIndex === undefined) continue;
        const ends = portEdgeEnds(join, worldRect(cont, contIndex), "joinOut", "inLeft");
        out.push({
          key: `${fn.id}:jo:${shape.ifId}`,
          from: shape.ifId,
          to: contId,
          fid: fn.id,
          d: edgePath(ends.x1, ends.y1, ends.x2, ends.y2, ends.horizontal),
          planned: false,
          merge: true,
          joinIfId: shape.ifId,
        });
      }
    }
    return out;
    // blockWorld/layout intentionally read via layout.* (stable memo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [functions, commandsByFunction, sizes, layoutStore, layout, ifShapesByFunction, mergeJoins]);

  const selectedFunc =
    functions.find((f) => f.id === selectedFunctionId) ?? null;
  const selectedCount =
    selectedFunctionId === null
      ? 0
      : (commandsByFunction[selectedFunctionId]?.length ?? 0);

  // New connections stretch into place (a fast 110ms draw). The map
  // holds the target of every connection that was on screen before, so
  // the animation runs once per created or rewired connection and never
  // on load. A block that merely moves keeps its target: its wire
  // follows it live instead of redrawing.
  const [drawing, setDrawing] = useState<ReadonlySet<string>>(EMPTY_EDGE_KEYS);
  const knownEdges = useRef<ReadonlyMap<string, number> | null>(null);
  const drawTimer = useRef<number | null>(null);
  useEffect(() => {
    const next = new Map(edges.map((edge) => [edge.key, edge.to]));
    const known = knownEdges.current;
    knownEdges.current = next;
    if (known === null) return;
    const touched: string[] = [];
    for (const [key, to] of next) {
      const before = known.get(key);
      // Created (no target yet) or rewired (a new destination): the wire
      // stretches from its source to where it now ends.
      if (before === undefined || before !== to) touched.push(key);
    }
    if (touched.length === 0) return;
    setDrawing(new Set(touched));
    if (drawTimer.current !== null) window.clearTimeout(drawTimer.current);
    drawTimer.current = window.setTimeout(() => {
      drawTimer.current = null;
      setDrawing(EMPTY_EDGE_KEYS);
    }, EDGE_DRAW_MS + 80);
  }, [edges]);
  useEffect(
    () => () => {
      if (drawTimer.current !== null) window.clearTimeout(drawTimer.current);
    },
    [],
  );

  // The connections the running flow travels, matched to the edges on
  // screen. A connection that no longer exists (edited mid-run) simply
  // has no indicator: the visualisation never invents geometry.
  const travelEdges = useMemo(() => {
    if (flow === null || flow === undefined) return [];
    // Match by drawn edges themselves: `"chain"` edges travel the
    // connection that starts at the flow edge's source; a decided
    // branch's wire at exactly its (if → head) endpoints.
    const byEnds = new Map(edges.map((e) => [`${e.fid}:${e.from}:${e.to}`, e]));
    // Manual-merge mode: a `merge` flow edge (decided tail → block after
    // the `if`) travels the tail's join rail **and** the join circle's
    // continuation wire — each exactly once, however many tails feed it.
    const joinOutAfter = new Map<number, string>();
    for (const e of edges) {
      if (e.joinTail === true && e.joinIfId !== undefined) {
        joinOutAfter.set(e.from, `${e.fid}:jo:${e.joinIfId}`);
      }
    }
    const travelSeen = new Set<string>();
    const out: { key: string; selected: boolean }[] = [];
    const push = (key: string, selected: boolean): void => {
      if (travelSeen.has(key)) return;
      travelSeen.add(key);
      out.push({ key, selected });
    };
    flow.edges.forEach((edge) => {
      const selected =
        edge.from === selectedCommandId && edge.fid === selectedFunctionId;
      if (edge.kind === "merge") {
        push(`${edge.fid}:merge:${edge.from}`, selected);
        const joinOut = joinOutAfter.get(edge.from);
        if (joinOut !== undefined) push(joinOut, selected);
        return;
      }
      const drawn = byEnds.get(`${edge.fid}:${edge.from}:${edge.to}`);
      if (drawn === undefined) return;
      push(drawn.key, selected);
    });
    return out;
  }, [edges, flow, selectedCommandId, selectedFunctionId]);

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
          // Border box, not `contentRect`: the port-anchored edge
          // geometry and the container auto-sizing both treat these as
          // the painted `.vblock` box, whose right edge and vertical
          // centre carry the ports. A content rect (padding excluded)
          // placed every arrow short by the block's horizontal padding
          // and off-centre vertically by half its vertical padding.
          const w = entry.borderBoxSize?.[0]?.inlineSize ?? target.offsetWidth;
          const h = entry.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight;
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
  /**
   * Live offset of a dragged TRUE/FALSE branch container: every member
   * of that one branch shifts by `dx`/`dy` while the gesture runs, and
   * the per-member commit lands on pointer-up. Presentation only.
   */
  const [branchDrag, setBranchDrag] = useState<{
    fid: number;
    ifId: number;
    branch: BranchSide;
    dx: number;
    dy: number;
  } | null>(null);
  const branchDragRef = useRef<{
    fid: number;
    ifId: number;
    branch: BranchSide;
    dx: number;
    dy: number;
  } | null>(null);
  /** Live offset of a dragged merge-join circle ("End of If Block"). */
  const [joinDrag, setJoinDrag] = useState<{
    ifId: number;
    dx: number;
    dy: number;
  } | null>(null);
  const joinDragRef = useRef<{ ifId: number; dx: number; dy: number } | null>(
    null,
  );
  /** Where a dragged whole-branch drag started (per member, live base). */
  interface BranchDragMember {
    readonly id: number;
    readonly orig: Pos;
  }
  const branchMembersRef = useRef<readonly BranchDragMember[]>([]);
  /** Live base spot of a dragged merge-join circle (function-relative). */
  const joinBaseRef = useRef<Pos | null>(null);
  const [hint, setHint] = useState<string>("");
  const gestureRef = useRef<
    | { kind: "block"; fid: number; id: number; startX: number; startY: number; orig: Pos }
    | { kind: "connect"; fid: number; sourceId: number; side: BlockSide }
    | {
        kind: "branch";
        fid: number;
        ifId: number;
        branch: BranchSide;
        startX: number;
        startY: number;
      }
    | { kind: "join"; fid: number; ifId: number; startX: number; startY: number }
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

  /**
   * Where the join circle of one `if` sits right now (function-relative
   * coordinates): the stored drag position, else the auto spot below
   * the branch frames. `null` when there is no shape to host it.
   */
  function joinBasePos(fid: number, ifId: number): Pos | null {
    const state = mergeJoins?.[ifId];
    if (state === undefined || !state.on) return null;
    const shape = (ifShapesByFunction.get(fid) ?? []).find(
      (s) => s.ifId === ifId,
    );
    const pos = state.pos ?? joinDefaultPos(shape?.frames ?? []);
    if (pos === null) return null;
    return { x: pos.x, y: pos.y };
  }

  /**
   * The join circle of one `if` in **world** coordinates (its stored
   * or auto position plus the function origin): every anchor drawn at
   * the circle — the join rails into it, its own continuation wire
   * out, and a connection preview sourced from it — reads the same
   * rect, so the wires and the pill can never drift apart. (A live
   * join drag moves the pill only until drop: the committed spot is
   * when every wire re-anchors together, never mid-gesture.)
   */
  function joinWorldRect(fid: number, ifId: number): BlockRect | null {
    const base = joinBasePos(fid, ifId);
    if (base === null) return null;
    const s = sizes.get(`${fid}:join:${ifId}`) ?? JOIN_FALLBACK_SIZE;
    const f = layout.funcOrigin(fid);
    return { x: f.x + base.x, y: f.y + base.y, w: s.w, h: s.h };
  }

  /** Live join position, including an in-flight drag offset. */
  function joinLivePos(fid: number, ifId: number): Pos | null {
    const base = joinBasePos(fid, ifId);
    if (base === null) return null;
    const drag = joinDrag !== null && joinDrag.ifId === ifId ? joinDrag : null;
    if (drag === null) return base;
    return {
      x: base.x + drag.dx,
      y: base.y + drag.dy,
    };
  }

  /** Which branch of which `if` a block belongs to (presentation read
   * of the engine's branch lists), for the member port pair. */
  function memberSideOf(
    fid: number,
    id: CommandId,
  ): "then" | "else" | undefined {
    for (const shape of ifShapesByFunction.get(fid) ?? []) {
      const side = shape.branchOf.get(id);
      if (side !== undefined) return side;
    }
    return undefined;
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
      const side = (port.dataset.side ?? "right") as BlockSide;
      // The ordinary block's right out-port, an `if` card's bottom
      // TRUE/FALSE ports, a branch member's bottom column port, and the
      // join circle's right port (naming its `if`) all start a wire.
      gestureRef.current = { kind: "connect", fid, sourceId: id, side };
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
    // The merge-join circle ("End of If Block"): draggable when merge is
    // on. Its right out-port was handled above (it starts a connection
    // sourced by the `if` itself), the rest of the pill drags it.
    const join = target.closest(".vjoin");
    if (join instanceof HTMLElement) {
      const fid = Number((join as HTMLElement).dataset.fid ?? NaN);
      const ifId = Number((join as HTMLElement).dataset.joinOf ?? NaN);
      if (!Number.isFinite(fid) || !Number.isFinite(ifId)) return;
      if (fid !== selectedFunctionId) {
        onSelectFunction(fid);
        return;
      }
      const base = joinBasePos(fid, ifId);
      if (base === null) return;
      joinBaseRef.current = base;
      gestureRef.current = {
        kind: "join",
        fid,
        ifId,
        startX: e.clientX,
        startY: e.clientY,
      };
      movedRef.current = false;
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // Synthetic pointers: gesture still works.
      }
      return;
    }
    // A TRUE/FALSE body frame carries its whole branch: dragging the
    // container moves every member with it (live), and commits each
    // member's position on pointer-up. Blocks inside keep their own
    // gestures — the frame's blank area is the handle.
    const frame = target.closest(".vbranch");
    if (frame instanceof HTMLElement) {
      const fid = Number(frame.dataset.fid ?? NaN);
      const ifId = Number(frame.dataset.ifId ?? NaN);
      const branch = frame.dataset.ifBranch;
      if (!Number.isFinite(fid) || !Number.isFinite(ifId)) return;
      if (branch !== "then" && branch !== "else") return;
      if (fid !== selectedFunctionId) {
        onSelectFunction(fid);
        return;
      }
      const shape = (ifShapesByFunction.get(fid) ?? []).find(
        (s) => s.ifId === ifId,
      );
      const ids = shape === undefined ? [] : branch === "then" ? shape.then : shape.else;
      const cmds = commandsByFunction[fid] ?? [];
      const byIndex = new Map<number, number>(cmds.map((c, i) => [c.id, i]));
      const store = layoutStore[fid];
      const members: { id: number; orig: Pos }[] = [];
      for (const id of ids) {
        const index = byIndex.get(id);
        if (index === undefined) continue;
        members.push({
          id,
          orig: store?.[id] ?? fallbackPos(index),
        });
      }
      if (members.length === 0) return;
      branchMembersRef.current = members;
      gestureRef.current = {
        kind: "branch",
        fid,
        ifId,
        branch,
        startX: e.clientX,
        startY: e.clientY,
      };
      movedRef.current = false;
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // Synthetic pointers: gesture still works.
      }
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
    } else if (gesture.kind === "branch") {
      // Whole-branch container drag: every member shifts by the same
      // delta (live via `branchDragOffsets`); the commit lands per
      // member on pointer-up.
      const dx = (e.clientX - gesture.startX) / zoom;
      const dy = (e.clientY - gesture.startY) / zoom;
      if (!movedRef.current && Math.hypot(dx, dy) * zoom < 4) return;
      movedRef.current = true;
      const next = { fid: gesture.fid, ifId: gesture.ifId, branch: gesture.branch, dx, dy };
      branchDragRef.current = next;
      setBranchDrag(next);
    } else if (gesture.kind === "join") {
      // Merge-join circle drag: live offset, committed on pointer-up.
      const dx = (e.clientX - gesture.startX) / zoom;
      const dy = (e.clientY - gesture.startY) / zoom;
      if (!movedRef.current && Math.hypot(dx, dy) * zoom < 4) return;
      movedRef.current = true;
      const next = { ifId: gesture.ifId, dx, dy };
      joinDragRef.current = next;
      setJoinDrag(next);
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
        // Vertical If/Else body frames are drop targets too: a wire
        // released inside a frame's blank area offers the dragged block
        // to that branch. The engine remains authoritative — it rejects
        // what it cannot hold (an `if`/`return` in a branch, a member of
        // another `if`), and the rejection surfaces honestly.
        const cmdsHere = commandsByFunction[gesture.fid] ?? [];
        // The manual join circle ("End of If Block") is itself a drop
        // target: a wire released on it resolves to the `if` it belongs
        // to (the drop point of the branch's tails).
        const joinHit = stack.find(
          (el) =>
            el instanceof HTMLElement && (el as HTMLElement).dataset.joinOf !== undefined,
        );
        if (joinHit instanceof HTMLElement && movedRef.current) {
          const joinFid = Number(joinHit.dataset.fid ?? NaN);
          const joinIfId = Number(joinHit.dataset.joinOf ?? NaN);
          if (
            Number.isFinite(joinFid) &&
            joinFid === gesture.fid &&
            Number.isFinite(joinIfId)
          ) {
            const resolved = resolveBranchConnect(
              cmdsHere,
              gesture.sourceId,
              joinIfId,
            );
            if (resolved.kind === "reject") {
              flashHint(resolved.reason);
              return;
            }
            const applied = onReconnect(
              gesture.fid,
              gesture.sourceId,
              joinIfId,
              "after",
              gesture.side,
            );
            if (!applied) {
              flashHint("Those blocks are already connected.");
            } else if (resolved.kind === "append") {
              placeBranchMember(
                gesture.fid,
                resolved.ifId,
                resolved.branch,
                gesture.sourceId,
              );
            }
          }
          return;
        }
        const containerHit = stack.find(
          (el) =>
            el instanceof HTMLElement && el.dataset.ifBranch !== undefined,
        );
        const container =
          containerHit instanceof HTMLElement ? containerHit : null;
        if (!movedRef.current) return;
        if (container === null) {
          // A branch member's wire has nowhere to go on empty canvas:
          // the resolver refuses a drop that would sever the body chain
          // before the planner can sever nothing.
          const resolved = resolveBranchConnect(
            cmdsHere,
            gesture.sourceId,
            null,
          );
          if (resolved.kind === "reject") {
            flashHint(resolved.reason);
            return;
          }
          const applied = onReconnect(gesture.fid, gesture.sourceId, null, "end", gesture.side);
          if (!applied) flashHint("That block is already last.");
          return;
        }
        const side = container.dataset.ifBranch;
        const ifId = Number(container.dataset.ifId);
        const containerFid = Number(container.dataset.fid);
        if (
          (side !== "then" && side !== "else") ||
          !Number.isFinite(ifId) ||
          !Number.isFinite(containerFid)
        ) {
          return;
        }
        if (containerFid !== gesture.fid) {
          flashHint("Connections stay inside one function.");
          return;
        }
        const applied = onReconnect(
          gesture.fid,
          gesture.sourceId,
          ifId,
          "after",
          side,
        );
        if (!applied) {
          flashHint("The engine could not wire that connection.");
          return;
        }
        // The engine wired the block into the branch: give it its body
        // column spot (presentation only — membership stays the engine's).
        placeBranchMember(gesture.fid, ifId, side, gesture.sourceId);
      } else {
        const targetFid = Number(block.dataset.fid ?? NaN);
        if (!Number.isFinite(targetFid) || targetFid !== gesture.fid) {
          if (movedRef.current) {
            flashHint("Connections stay inside one function.");
          }
        } else {
          // Branch resolution first: a wire whose source or target runs
          // inside a branch never re-splices the chain (the resolver
          // answers before any planner — see `lib/branching.ts`).
          const cmdsHere = commandsByFunction[gesture.fid] ?? [];
          const targetId = Number(block.dataset.blockId);
          if (!Number.isFinite(targetId)) return;
          const resolved = resolveBranchConnect(
            cmdsHere,
            gesture.sourceId,
            targetId,
          );
          if (resolved.kind === "reject") {
            if (movedRef.current) flashHint(resolved.reason);
            return;
          }
          // Left in-port → forward port-to-port wiring (a detached
          // source slots in before the target; a chained source pulls
          // the target after itself). Block body → the target moves to
          // run right after the dragged block.
          const inPort =
            inPortHit !== undefined && block.contains(inPortHit)
              ? inPortHit
              : undefined;
          const where = inPort !== undefined ? "before" : "after";
          const applied = onReconnect(
            gesture.fid,
            gesture.sourceId,
            targetId,
            resolved.kind === "append" ? "after" : where,
            gesture.side,
          );
          if (!applied) {
            flashHint("Those blocks are already connected.");
          } else if (resolved.kind === "append") {
            // The dropped block joined the source branch (the engine
            // moved it there): give it its body column spot.
            placeBranchMember(
              gesture.fid,
              resolved.ifId,
              resolved.branch,
              targetId,
            );
          } else if (
            gesture.side === "then" ||
            gesture.side === "else"
          ) {
            // A wire dragged from an `if`'s bottom branch port wires the
            // drop target into that branch of the `if`: the target
            // takes its column spot below the branch's existing body.
            placeBranchMember(
              gesture.fid,
              gesture.sourceId,
              gesture.side,
              targetId,
            );
          }
        }
      }
    } else if (gesture.kind === "branch") {
      // Whole-branch commit: every member adopted the dragged offset.
      const drag =
        branchDragRef.current !== null &&
        branchDragRef.current.ifId === gesture.ifId
          ? branchDragRef.current
          : null;
      branchDragRef.current = null;
      setBranchDrag(null);
      if (movedRef.current && drag !== null) {
        for (const member of branchMembersRef.current) {
          onMoveBlock(
            gesture.fid,
            member.id,
            {
              x: Math.max(8, member.orig.x + drag.dx),
              y: Math.max(BLOCK_MIN_Y, member.orig.y + drag.dy),
            },
          );
        }
      }
      branchMembersRef.current = [];
    } else if (gesture.kind === "join") {
      // Join circle commit: one position, one UI-state write.
      const drag =
        joinDragRef.current !== null && joinDragRef.current.ifId === gesture.ifId
          ? joinDragRef.current
          : null;
      joinDragRef.current = null;
      setJoinDrag(null);
      const base = joinBaseRef.current;
      joinBaseRef.current = null;
      if (movedRef.current && drag !== null && base !== null) {
        onMoveJoin?.(gesture.ifId, {
          x: Math.max(8, base.x + drag.dx),
          y: Math.max(BLOCK_MIN_Y, base.y + drag.dy),
        });
      }
    } else {
      // pan / pkg: a click without movement deselects, like any other
      // empty-canvas click.
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

  /**
   * Auto-place a freshly wired branch member under its body column.
   *
   * The layout store owns positions; this only writes the newcomer's
   * spot (below the branch's last member as the engine listed it
   * *before* the wire, or at the empty body's placeholder when the
   * branch had none). Membership itself is never touched: the engine
   * wired the member, the canvas merely reads the pre-wire shape from
   * the memo. A stored position the user may have set is only moved for
   * the block that was just wired — drags replay through `onMoveBlock`
   * like any other.
   *
   * The block being placed is excluded from the anchor list: the
   * canvas-gesture path reads it before the props list the new member,
   * and the membership-diff effect (`branchMembersSeenRef`) runs after
   * the props already carry it — anchoring below *itself* (its stale
   * stored spot) would push later members ever further down the canvas.
   */
  function placeBranchMember(
    fid: number,
    ifId: number,
    branch: BlockSide,
    blockId: number,
  ): void {
    if (branch !== "then" && branch !== "else") return;
    const cmds = commandsByFunction[fid] ?? [];
    const byIndex = new Map<number, number>(
      cmds.map((c, i) => [c.id, i] as const),
    );
    const ifIndex = byIndex.get(ifId);
    const ifCmd = ifIndex === undefined ? undefined : cmds[ifIndex];
    if (ifCmd === undefined || ifIndex === undefined) return;
    const store = layoutStore[fid];
    const ifPos = store?.[ifId] ?? fallbackPos(ifIndex);
    const ifSize = sizes.get(`${fid}:${ifId}`) ?? FALLBACK_SIZE;
    const shape = (ifShapesByFunction.get(fid) ?? []).find(
      (s) => s.ifId === ifId,
    );
    const memberIds =
      branch === "then"
        ? (shape?.then ?? [])
        : (shape?.else ?? []);
    const memberRects: (readonly [number, number])[] = [];
    for (const id of memberIds) {
      // The block being placed anchors below the members the engine
      // listed *before* it — its own stale spot is not an anchor.
      if (id === blockId) continue;
      const index = byIndex.get(id) ?? -1;
      const cmd = cmds[index];
      if (cmd === undefined) continue;
      const p = store?.[cmd.id] ?? fallbackPos(index);
      const s = sizes.get(`${fid}:${cmd.id}`) ?? FALLBACK_SIZE;
      memberRects.push([p.y, s.h] as const);
    }
    onMoveBlock(
      fid,
      blockId,
      branchDropPos({
        branch,
        ifRect: { x: ifPos.x, y: ifPos.y, w: ifSize.w, h: ifSize.h },
        memberRects,
      }),
    );
  }

  // Which ids a whole-branch drag currently offsets, and by how much:
  // re-derived from the engine's branch lists so a live container drag
  // can never shift a non-member. Presentation only.
  const branchDragOffsets = useMemo((): {
    readonly fid: number;
    readonly map: ReadonlyMap<number, Pos>;
  } | null => {
    const drag = branchDrag;
    if (drag === null) return null;
    const map = new Map<number, Pos>();
    for (const shape of ifShapesByFunction.get(drag.fid) ?? []) {
      if (shape.ifId !== drag.ifId) continue;
      const ids = drag.branch === "then" ? shape.then : shape.else;
      for (const id of ids) map.set(id, { x: drag.dx, y: drag.dy });
    }
    return { fid: drag.fid, map };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchDrag, ifShapesByFunction]);

  // Auto-place newcomers that joined a branch outside a live canvas
  // gesture. A wire released on a frame's blank area or an `if` port
  // already places its block in `endGesture`; this effect covers the
  // membership changes that did not pass through one — the engine
  // replayed `if_append` (undo/redo of an intersecting wire plan) or an
  // append resolved from a state the gesture could not see. Diffing the
  // derived branch lists (never engine state) and only moving a block
  // that is not already inside its body frame keeps this from ever
  // fighting a user's placement.
  const branchMembersSeenRef = useRef<ReadonlyMap<string, readonly number[]>>(
    new Map(),
  );
  useEffect(() => {
    const next = new Map<string, readonly number[]>();
    const gains: {
      fid: number;
      ifId: number;
      branch: BranchSide;
      id: number;
      /** The branch's members before this gain (the diff's "before"). */
      prev: readonly number[];
    }[] = [];
    for (const fn of functions) {
      for (const shape of ifShapesByFunction.get(fn.id) ?? []) {
        for (const branch of ["then", "else"] as const) {
          const ids = branch === "then" ? shape.then : shape.else;
          const key = `${fn.id}:${shape.ifId}:${branch}`;
          next.set(key, ids);
          const prev = branchMembersSeenRef.current.get(key);
          if (prev === undefined) continue;
          for (const id of ids) {
            if (!prev.includes(id)) {
              gains.push({ fid: fn.id, ifId: shape.ifId, branch, id, prev });
            }
          }
        }
      }
    }
    branchMembersSeenRef.current = next;
    if (gains.length === 0 || busy) return;
    for (const gain of gains) {
      const cmds = commandsByFunction[gain.fid] ?? [];
      const byIndex = new Map(cmds.map((c, i) => [c.id, i] as const));
      const rectOf = (id: number): BlockRect | undefined => {
        const index = byIndex.get(id);
        const cmd = index === undefined ? undefined : cmds[index];
        if (cmd === undefined || index === undefined) return undefined;
        const p = layoutStore[gain.fid]?.[id] ?? fallbackPos(index);
        const s = sizes.get(`${gain.fid}:${id}`) ?? FALLBACK_SIZE;
        return { x: p.x, y: p.y, w: s.w, h: s.h };
      };
      // The frame as it stood *before* the gain, built from the previous
      // member list through the same frame math the canvas draws: the
      // newcomer's own stale spot is inside the *current* frame (which
      // grew around it), so deciding "already placed" on that would
      // swallow every off-gesture gain. Rewinding the branch list to
      // the pre-gain state restores the honest bounds.
      const preCmds: readonly UiCommand[] = cmds.map((c) => {
        if (!(c.id === gain.ifId && c.kind === "if")) return c;
        if (gain.branch === "then") {
          return { ...c, then_body: [...gain.prev] };
        }
        return { ...c, else_body: [...gain.prev] };
      });
      const preFrame = buildIfShapes(preCmds, rectOf, rectOf)
        .find((s) => s.ifId === gain.ifId)
        ?.frames.find((f) => f.branch === gain.branch)?.rect;
      const p =
        layoutStore[gain.fid]?.[gain.id] ?? fallbackPos(byIndex.get(gain.id) ?? -1);
      if (
        preFrame !== undefined &&
        p.x >= preFrame.x &&
        p.x <= preFrame.x + preFrame.w &&
        p.y >= preFrame.y &&
        p.y <= preFrame.y + preFrame.h
      ) {
        // Already inside its body frame before the gain: a user parked
        // it there — do not fight the placement.
        continue;
      }
      placeBranchMember(gain.fid, gain.ifId, gain.branch, gain.id);
    }
    // The gain-diffing contract is the gate: this effect must decide from
    // the settled command list, not re-fire when inline `sizes` or the
    // guarded `placeBranchMember` closures turn over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [functions, commandsByFunction, ifShapesByFunction, layoutStore, busy]);

  function dragEffectivePos(fid: number, cmd: CommandSummary, index: number): Pos {
    if (dragPos !== null && dragPos.fid === fid && dragPos.id === cmd.id) {
      return dragPos.pos;
    }
    const base = effectivePos(fid, cmd, index);
    const drag =
      branchDragOffsets !== null &&
      branchDragOffsets.fid === fid
        ? branchDragOffsets.map.get(cmd.id)
        : undefined;
    if (drag === undefined) return base;
    return {
      x: Math.max(8, base.x + drag.x),
      y: Math.max(BLOCK_MIN_Y, base.y + drag.y),
    };
  }

  // One renderer for both connection layers (the full-world fallback and
  // the viewport-clipped overlay): identical classes and attributes, so
  // a viewer can never be shown two truths about the same wire.
  function edgeNode(edge: DrawnEdge): ReactElement {
    const isSelected =
      edge.from === selectedCommandId && edge.fid === selectedFunctionId;
    const isDrawing = drawing.has(edge.key);
    // Planned: a connection the engine accepted but cannot report (the
    // edge into an `if`). Merge: a branch body's tail running back into
    // the block after the `if`, or the `if`'s own post-body continuation.
    const edgeClass = [
      "edge",
      isSelected ? "edge-selected" : "",
      edge.planned ? "edge-planned" : "",
      edge.merge ? "edge-merge" : "",
      isDrawing ? "edge-draw" : "",
    ]
      .filter((part) => part !== "")
      .join(" ");
    return (
      <Fragment key={edge.key}>
        <path
          d={edge.d}
          data-fid={edge.fid}
          data-from={edge.from}
          data-to={edge.to}
          pathLength={1}
          markerEnd={isDrawing ? undefined : "url(#arrow-flow)"}
          className={edgeClass}
          ref={(el) => {
            if (el !== null) {
              edgeEls.current.set(edge.key, el);
            } else {
              edgeEls.current.delete(edge.key);
            }
          }}
        />
        {isDrawing ? (
          <path
            d={edge.d}
            pathLength={1}
            markerEnd="url(#arrow-flow)"
            className="edge-draw-head"
          />
        ) : null}
      </Fragment>
    );
  }

  // The dragged wire's ghost. It leaves the same anchor the real edges
  // use: the dragged block's right out-port — the `if` card's bottom
  // TRUE/FALSE ports for branch wires, the bottom-centre port of a
  // branch member for its vertical column flow — and, for a wire
  // dragged from the manual join circle, the circle's own right port.
  // The join's out-port names the `if` (the planners need it), but the
  // card itself carries no right port: the wire leaves the circle.
  function previewNode(): ReactElement | null {
    if (preview === null) return null;
    const sourceCmds = commandsByFunction[preview.fid] ?? [];
    const sourceIndex = sourceCmds.findIndex((c) => c.id === preview.sourceId);
    const source = sourceIndex >= 0 ? sourceCmds[sourceIndex] : undefined;
    if (source === undefined) return null;
    const origin = blockWorld(preview.fid, source, Math.max(0, sourceIndex));
    const size = sizeOf(preview.fid, preview.sourceId);
    // Join-circle source: the ghost leaves the circle's right out port
    // — exactly where the persisted continuation wire leaves (the card
    // itself carries no right port, the pill's port merely names the
    // `if` for the planners).
    const join =
      source.kind === "if" && preview.side === "right"
        ? joinWorldRect(preview.fid, preview.sourceId)
        : null;
    if (join !== null) {
      return (
        <path
          d={edgePath(join.x + join.w, join.y + join.h / 2, preview.x, preview.y, true)}
          markerEnd="url(#arrow-flow)"
          className="edge edge-preview"
        />
      );
    }
    const fraction =
      preview.side === "then"
        ? BRANCH_PORT_FRACTION.then
        : preview.side === "else"
          ? BRANCH_PORT_FRACTION.else
          : null;
    const centerBottom = fraction !== null || preview.side === "bottom";
    const ox = fraction === null
      ? preview.side === "bottom"
        ? origin.x + size.w / 2
        : origin.x + size.w
      : origin.x + size.w * fraction;
    const oy = centerBottom ? origin.y + size.h : origin.y + size.h / 2;
    return (
      <path
        d={edgePath(ox, oy, preview.x, preview.y, true)}
        markerEnd="url(#arrow-flow)"
        className="edge edge-preview"
      />
    );
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

  /**
   * The vertical If/Else body frames of one function, in world-relative
   * (function-container) coordinates — culled like the blocks when the
   * viewport is measured, so off-screen frames cost nothing to paint.
   * Deriving, not storing: the frames chase branch membership and block
   * drags with no state of their own (and a live whole-branch drag
   * drags its frame with the member offsets).
   */
  function branchFrames(
    fid: number,
  ): { ifId: number; branch: BranchSide; rect: BlockRect; empty: boolean }[] {
    const f = layout.funcOrigin(fid);
    const overscan =
      viewport === null ? null : withOverscan(viewport, VIEW_OVERSCAN);
    const frames: {
      ifId: number;
      branch: BranchSide;
      rect: BlockRect;
      empty: boolean;
    }[] = [];
    for (const shape of ifShapesByFunction.get(fid) ?? []) {
      for (const frame of shape.frames) {
        let rect = frame.rect;
        const drag =
          branchDrag !== null &&
          branchDrag.fid === fid &&
          branchDrag.ifId === shape.ifId &&
          branchDrag.branch === frame.branch
            ? branchDrag
            : null;
        if (drag !== null) {
          rect = {
            x: rect.x + drag.dx,
            y: rect.y + drag.dy,
            w: rect.w,
            h: rect.h,
          };
        }
        if (overscan !== null) {
          const world = {
            x: f.x + rect.x,
            y: f.y + rect.y,
            w: rect.w,
            h: rect.h,
          };
          if (!rectsIntersect(overscan, world)) continue;
        }
        frames.push({ ...frame, rect, ifId: shape.ifId });
      }
    }
    return frames;
  }

  // Blocks that just left the model fade out where they stood instead of
  // blinking out of existence. The application state already dropped
  // them; this only keeps their picture for one exit animation.
  const liveBlocks = useMemo(
    () =>
      functions.flatMap((fn) =>
        (commandsByFunction[fn.id] ?? []).map((cmd, index) => ({
          fid: fn.id,
          cmd,
          index,
        })),
      ),
    [functions, commandsByFunction],
  );

  // Where every block stands while it is alive: the layout drops the
  // positions of deleted commands, so the exit animation needs the last
  // known spot.
  const blockPos = useRef(new Map<string, Pos>());
  for (const block of liveBlocks) {
    blockPos.current.set(
      `${block.fid}:${block.cmd.id}`,
      dragEffectivePos(block.fid, block.cmd, block.index),
    );
  }

  const exitingBlocks = useExitItems(
    liveBlocks,
    (block) => `${block.fid}:${block.cmd.id}`,
  );

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
      <div
        className="canvas-toolbar enter-down enter-delay-heading"
        role="toolbar"
        aria-label="Canvas view"
      >
        <span className="canvas-title" title="Package / Struct / Function">
          <span className="crumb">{PACKAGE_NAME}</span>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span className="crumb">{PRESENTATION_STRUCT_NAME}</span>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span className="crumb crumb-strong">
            {selectedFunc !== null ? `${selectedFunc.name}()` : "—"}
          </span>
          {selectedFunc?.isMain ? <span className="main-badge">MAIN</span> : null}
          <span className="cmd-count enter-up enter-delay-meta">
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
          dragPosRef.current = null;
          branchDragRef.current = null;
          branchMembersRef.current = [];
          setBranchDrag(null);
          joinDragRef.current = null;
          joinBaseRef.current = null;
          setJoinDrag(null);
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
                          {/* Vertical If/Else body frames: derived from the
                            * engine's branch lists + the layout store; they
                            * sit BEHIND the branch's blocks (drawn first) and
                            * stay decorative — the blocks themselves remain
                            * the interactive/selectable elements. The empty
                            * placeholder keeps the branch's drop target
                            * somewhere visible until a member arrives. */}
                          {branchFrames(fn.id).map((frame) => (
                            <div
                              key={`ifbody-${frame.ifId}-${frame.branch}`}
                              className={`vbranch${
                                frame.empty ? " vbranch-empty" : ""
                              }`}
                              data-if-id={frame.ifId}
                              data-fid={fn.id}
                              data-if-branch={frame.branch}
                              data-empty={frame.empty}
                              aria-hidden="true"
                              style={{
                                left: frame.rect.x,
                                top: frame.rect.y,
                                width: frame.rect.w,
                                height: frame.rect.h,
                              }}
                            >
                              <span className="vbranch-tag">
                                {frame.branch === "then" ? "true" : "false"}
                                {frame.empty ? " · empty" : ""}
                              </span>
                            </div>
                          ))}
                          {/* Manual merge join points ("End of If
                            * Block"): one per `if` with the merge on.
                            * Draggable; the tails address its top port
                            * and the continuation leaves its right
                            * port (which sources the `if` itself, so
                            * wiring from it continues the branch flow
                            * with the ordinary planners). A wire
                            * dragged from it previews a ghost that
                            * leaves the circle's right port, too. */}
                          {(ifShapesByFunction.get(fn.id) ?? []).map(
                            (shape) => {
                              const state = mergeJoins?.[shape.ifId];
                              if (state === undefined || !state.on) {
                                return null;
                              }
                              const pos = joinLivePos(fn.id, shape.ifId);
                              if (pos === null) return null;
                              const dragging =
                                joinDrag !== null && joinDrag.ifId === shape.ifId;
                              return (
                                <div
                                  key={`vjoin-${shape.ifId}`}
                                  id={`vjoin-${fn.id}-${shape.ifId}`}
                                  className="vjoin"
                                  data-join-of={shape.ifId}
                                  data-fid={fn.id}
                                  data-dragging={dragging ? "true" : undefined}
                                  data-connect-from={
                                    preview !== null &&
                                    preview.sourceId === shape.ifId &&
                                    preview.fid === fn.id
                                      ? "true"
                                      : undefined
                                  }
                                  ref={(el) => {
                                    const key = `${fn.id}:join:${shape.ifId}`;
                                    if (el !== null) {
                                      blockEls.current.set(key, el);
                                    } else {
                                      blockEls.current.delete(key);
                                    }
                                  }}
                                  style={{ left: pos.x, top: pos.y }}
                                >
                                  <span
                                    className="vport vport-top"
                                    data-port="in"
                                    aria-hidden="true"
                                  />
                                  <span className="vjoin-tag">
                                    End of If Block
                                  </span>
                                  <span
                                    className="vport vport-right"
                                    data-port="out"
                                    data-side="right"
                                    data-block-id={shape.ifId}
                                    data-fid={fn.id}
                                    aria-hidden="true"
                                  />
                                </div>
                              );
                            },
                          )}
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
                                conditionText={
                                  cmd.kind === "if" && conditionTextFor !== undefined
                                    ? conditionTextFor(fn.id, cmd.id)
                                    : undefined
                                }
                                branchMember={memberSideOf(fn.id, cmd.id)}
                                interactive={fn.id === selectedFunctionId}
                              />
                            </div>
                          ))}
                          {exitingBlocks
                            .filter((ghost) => ghost.item.fid === fn.id)
                            .map((ghost) => {
                              const cmd = ghost.item.cmd;
                              const key = `${ghost.item.fid}:${cmd.id}`;
                              return (
                                <div key={`exit-${key}`}>
                                  <VisualBlock
                                    command={cmd}
                                    fid={ghost.item.fid}
                                    functionName={fn.name}
                                    index={ghost.item.index}
                                    position={
                                      blockPos.current.get(key) ??
                                      fallbackPos(ghost.item.index)
                                    }
                                    selected={false}
                                    failed={false}
                                    connectFrom={false}
                                    conditionText={
                                      cmd.kind === "if" &&
                                      conditionTextFor !== undefined
                                        ? conditionTextFor(
                                            ghost.item.fid,
                                            cmd.id,
                                          )
                                        : undefined
                                    }
                                    branchMember={memberSideOf(
                                      ghost.item.fid,
                                      cmd.id,
                                    )}
                                    interactive={false}
                                    exiting
                                  />
                                </div>
                              );
                            })}
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
                {edges.map((edge) => edgeNode(edge))}
                <FlowTravel
                  edges={travelEdges}
                  paths={edgeEls.current}
                  linkMs={flow?.linkMs ?? 0}
                  runId={flow?.runId ?? 0}
                  reduced={reducedMotion}
                />
                {previewNode()}
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
                  {edges.map((edge) => edgeNode(edge))}
                  <FlowTravel
                    edges={travelEdges}
                    paths={edgeEls.current}
                    linkMs={flow?.linkMs ?? 0}
                    runId={flow?.runId ?? 0}
                    reduced={reducedMotion}
                  />
                  {previewNode()}
                </g>
              </svg>
            )}
          </div>
        </div>
        {emptyWorkspace ? (
          <div className="canvas-empty enter-up enter-delay-heading">
            <strong>No blocks yet</strong>
            <span>
              <RevealText
                text={`Drag a block from the library to start building ${breadcrumbPath(selectedFunc?.name ?? null)}.`}
                delay={700}
                stagger={28}
              />
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
