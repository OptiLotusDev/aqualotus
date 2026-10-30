/**
 * Hierarchical program-model canvas: Package → Struct → Function →
 * Blocks. Composition layer: initializes and connects the extracted
 * canvas hooks, computes shared data, and passes it to child
 * components. Interaction, geometry, branch, rendering, and gesture
 * logic live in dedicated modules under hooks/canvas/ and
 * components/canvas/.
 */

import {
  useCallback,
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
import type { FlowState } from "../lib/flow";
import type { LayoutMap, Pos } from "../lib/layout";
import type { BlockSide, BranchSide, MergeJoin } from "../lib/graph";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { useCanvasView } from "../hooks/useCanvasView";
import { useCanvasViewport } from "../hooks/canvas/useCanvasViewport";
import { useCanvasGestures } from "../hooks/canvas/useCanvasGestures";
import { useCanvasIfShapes } from "../hooks/canvas/useCanvasIfShapes";
import { useCanvasEdges } from "../hooks/canvas/useCanvasEdges";
import { useCanvasTravelEdges } from "../hooks/canvas/useCanvasTravelEdges";
import { useCanvasViewportSync } from "../hooks/canvas/useCanvasViewportSync";
import { useCanvasGesturesSetup } from "../hooks/canvas/useCanvasGesturesSetup";
import { useCanvasResizeObserver } from "../hooks/canvas/useCanvasResizeObserver";
import { useCanvasLibraryDrop } from "../hooks/canvas/useCanvasLibraryDrop";
import { useCanvasBranchAutoPlace } from "../hooks/canvas/useCanvasBranchAutoPlace";
import { usePinnedBlocks, useVisibleCmdsGetter, useCulledBlocks } from "../hooks/canvas/useCanvasCulling";
import { useCanvasBlocks } from "../hooks/canvas/useCanvasBlocks";
import { useCanvasStartupFit } from "../hooks/canvas/useCanvasStartupFit";
import { computeCanvasLayout } from "../lib/canvas_layout";
import {
  FALLBACK_SIZE,
  VIEW_OVERSCAN,
  type Size,
} from "./visualEditor_constants";
import CanvasToolbar from "./canvas/CanvasToolbar";
import CanvasWorkspace from "./canvas/CanvasWorkspace";

interface VisualEditorProps {
  readonly functions: readonly FunctionSummary[];
  readonly commandsByFunction: Readonly<
    Record<number, readonly CommandSummary[]>
  >;
  readonly layoutStore: Readonly<Record<number, LayoutMap>>;
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
    side?: BlockSide,
  ) => boolean;
  readonly onMoveBlock: (
    fid: FunctionId,
    id: CommandId,
    pos: Pos,
  ) => void;
  readonly mergeJoins?: Readonly<Record<number, MergeJoin>>;
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
  readonly toolbarExtra?: ReactNode;
  readonly conditionTextFor?: (fid: FunctionId, ifId: CommandId) => string | null;
  readonly flow?: FlowState | null;
}

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
  const edgeRefs = useRef(new Map<string, SVGPathElement>());
  const reducedMotion = useReducedMotion();
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  const [pkgOff, setPkgOff] = useState<Pos>({ x: 0, y: 0 });

  // Derived if shapes
  const ifShapesByFunction = useCanvasIfShapes({
    functions,
    commandsByFunction,
    layoutStore,
    sizes,
  });

  // World geometry
  const layout = useMemo(() => {
    return computeCanvasLayout({
      functions,
      commandsByFunction,
      layoutStore,
      sizes,
      pkgOff,
      ifShapesByFunction,
    });
  }, [functions, commandsByFunction, layoutStore, sizes, pkgOff, ifShapesByFunction]);

  // Camera / view
  const {
    zoom,
    setZoom,
    zoomRef,
    commitZoom,
    zoomBy,
    zoomTo,
    zoomAtCursor,
    fitView,
    pkgCenter,
    toCanvas,
  } = useCanvasView({
    boardRef,
    layout: {
      pkgPos: layout.pkgPos,
      pkgW: layout.pkgW,
      pkgH: layout.pkgH,
    },
    onRegisterZoom,
    onZoomSettled,
  });

  // Viewport
  const { viewport, setViewport } = useCanvasViewport({
    boardRef,
    zoom,
    zoomRef,
  });

  // Viewport sync effects
  useCanvasViewportSync({ boardRef, zoom, zoomRef, setViewport });

  // Startup fit effect
  useCanvasStartupFit({ boardRef, layout, functions, setZoom, viewport });

  // Wheel/keyboard zoom setup
  useCanvasGesturesSetup({
    boardRef,
    zoomRef,
    setZoom,
    commitZoom,
    zoomBy,
    zoomAtCursor,
  });

  // Resize observer for block geometry
  useCanvasResizeObserver({ blockEls, setSizes });

  // Library ghost drops
  useCanvasLibraryDrop({
    boardRef,
    functions,
    selectedFunctionId,
    layout,
    toCanvas,
    zoomRef,
    onRegisterDrop,
    onDropBlock,
  });

  // Semantic edges
  const edges = useCanvasEdges({
    functions,
    commandsByFunction,
    layoutStore,
    sizes,
    layout,
    ifShapesByFunction,
    mergeJoins,
  });

  // Travel edges
  const travelEdges = useCanvasTravelEdges({
    edges,
    flow,
    selectedCommandId,
    selectedFunctionId,
  });

  // placeBranchMember: auto-place a freshly wired branch member
  const placeBranchMember = useCallback(
    (fid: number, ifId: number, branch: BranchSide, blockId: number): void => {
      if (branch !== "then" && branch !== "else") return;
      const cmds = commandsByFunction[fid] ?? [];
      const byIndex = new Map<number, number>(
        cmds.map((c, i) => [c.id, i] as const),
      );
      const ifIndex = byIndex.get(ifId);
      const ifCmd = ifIndex === undefined ? undefined : cmds[ifIndex];
      if (ifCmd === undefined || ifIndex === undefined) return;
      const store = layoutStore[fid];
      const ifPos = store?.[ifId] ?? { x: 48, y: 36 + ifIndex * 264 };
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
        if (id === blockId) continue;
        const index = byIndex.get(id) ?? -1;
        const cmd = cmds[index];
        if (cmd === undefined) continue;
        const p = store?.[cmd.id] ?? { x: 48, y: 36 + index * 264 };
        const s = sizes.get(`${fid}:${cmd.id}`) ?? FALLBACK_SIZE;
        memberRects.push([p.y, s.h] as const);
      }
      onMoveBlock(
        fid,
        blockId,
        {
          x: branch === "then" ? ifPos.x : ifPos.x + ifSize.w + 24,
          y: memberRects.length === 0
            ? ifPos.y + ifSize.h + 40
            : memberRects[memberRects.length - 1][0] + memberRects[memberRects.length - 1][1] + 24,
        },
      );
    },
    [commandsByFunction, layoutStore, sizes, ifShapesByFunction, onMoveBlock],
  );

  // Branch auto-place
  useCanvasBranchAutoPlace({
    functions,
    commandsByFunction,
    ifShapesByFunction,
    layoutStore,
    sizes,
    busy,
    placeBranchMember,
  });

  // We need to use refs for preview and dragPos since they come from gestures
  const previewRef = useRef<{ readonly fid: number; readonly sourceId: number; readonly side: string; readonly x: number; readonly y: number } | null>(null);
  const dragPosRef = useRef<{ readonly fid: number; readonly id: number; readonly pos: Pos } | null>(null);

  // Gestures
  const gestures = useCanvasGestures({
    boardRef,
    busy,
    selectedFunctionId,
    selectedCommandId,
    commandsByFunction,
    layoutStore,
    sizes,
    ifShapesByFunction,
    posOf: layout.posOf,
    blockWorld: (fid: number, cmd: CommandSummary, index: number): Pos => {
      const f = layout.funcOrigin(fid);
      const p = layout.posOf(fid, cmd, index);
      return { x: f.x + p.x, y: f.y + p.y };
    },
    funcOrigin: layout.funcOrigin,
    mergeJoins,
    zoom,
    onSelectFunction,
    onSelectCommand,
    onMoveBlock,
    onReconnect,
    onDropBlock,
    onMoveJoin,
    setPkgOff,
    pkgOff,
    flashHint: () => {},
    setZoom,
    zoomBy,
    edges,
    flow,
    placeBranchMember,
  });

  // Update refs from gestures
  previewRef.current = gestures.preview;
  dragPosRef.current = gestures.dragPos;

  // Culling with gesture refs
  const pinnedBlocksWithGestures = usePinnedBlocks({
    selectedCommandId,
    errorId,
    preview: previewRef.current,
    dragPos: dragPosRef.current,
  });

  const visibleCmds = useVisibleCmdsGetter({
    layout,
    sizes,
    viewport,
    pinnedBlocks: pinnedBlocksWithGestures,
  });

  const culledBlocks = useCulledBlocks({
    functions,
    commandsByFunction,
    layout,
    sizes,
    viewport,
    pinnedBlocks: pinnedBlocksWithGestures,
  });

  // Live/exiting blocks
  const { blockPos, exitingBlocks } = useCanvasBlocks({
    functions,
    commandsByFunction,
    dragEffectivePos: gestures.dragEffectivePos,
  });

  const selectedFunc =
    functions.find((f) => f.id === selectedFunctionId) ?? null;
  const selectedCount =
    selectedFunctionId === null
      ? 0
      : (commandsByFunction[selectedFunctionId]?.length ?? 0);

  const emptyWorkspace = functions.length === 0;

  return (
    <div className="canvas-wrap">
      <CanvasToolbar
        selectedFunc={selectedFunc}
        selectedCount={selectedCount}
        culledBlocks={culledBlocks}
        zoom={zoom}
        hint={gestures.hint}
        toolbarExtra={toolbarExtra}
        onZoomOut={() => zoomBy(1 / 1.05)}
        onZoomReset={() => zoomTo(1, pkgCenter())}
        onZoomIn={() => zoomBy(1.05)}
        onFitView={fitView}
      />
      <CanvasWorkspace
        boardRef={boardRef}
        functions={functions}
        commandsByFunction={commandsByFunction}
        layout={{
          pkgPos: layout.pkgPos,
          pkgW: layout.pkgW,
          pkgH: layout.pkgH,
          structW: layout.structW,
          structH: layout.structH,
          worldW: layout.worldW,
          worldH: layout.worldH,
          heights: layout.heights,
          widths: layout.widths,
          ys: layout.ys,
          funcOrigin: layout.funcOrigin,
        }}
        zoom={zoom}
        selectedFunctionId={selectedFunctionId}
        selectedCommandId={selectedCommandId}
        errorId={errorId}
        errorFunctionId={errorFunctionId}
        conditionTextFor={conditionTextFor}
        onSelectFunction={onSelectFunction}
        onRequestLibrary={onRequestLibrary}
        ifShapesByFunction={ifShapesByFunction}
        mergeJoins={mergeJoins}
        branchFrames={(fid, vp) => {
          const f = layout.funcOrigin(fid);
          const overscan = vp === null ? null : {
            x: vp.x - VIEW_OVERSCAN,
            y: vp.y - VIEW_OVERSCAN,
            w: vp.w + VIEW_OVERSCAN * 2,
            h: vp.h + VIEW_OVERSCAN * 2,
          };
          const frames: { ifId: number; branch: BranchSide; rect: { x: number; y: number; w: number; h: number }; empty: boolean }[] = [];
          for (const shape of ifShapesByFunction.get(fid) ?? []) {
            for (const frame of shape.frames) {
              let rect = frame.rect;
              const drag = gestures.branchDrag !== null &&
                gestures.branchDrag.fid === fid &&
                gestures.branchDrag.ifId === shape.ifId &&
                gestures.branchDrag.branch === frame.branch
                ? gestures.branchDrag
                : null;
              if (drag !== null) {
                rect = { x: rect.x + drag.dx, y: rect.y + drag.dy, w: rect.w, h: rect.h };
              }
              if (overscan !== null) {
                const world = { x: f.x + rect.x, y: f.y + rect.y, w: rect.w, h: rect.h };
                if (
                  world.x < overscan.x + overscan.w &&
                  world.x + world.w > overscan.x &&
                  world.y < overscan.y + overscan.h &&
                  world.y + world.h > overscan.y
                ) {
                  frames.push({ ...frame, rect, ifId: shape.ifId, empty: frame.empty });
                }
              } else {
                frames.push({ ...frame, rect, ifId: shape.ifId, empty: frame.empty });
              }
            }
          }
          return frames;
        }}
        joinLivePos={gestures.joinLivePos}
        joinDrag={gestures.joinDrag}
        sizes={sizes}
        visibleCmds={visibleCmds}
        exitingBlocks={exitingBlocks}
        blockPositions={blockPos}
        dragEffectivePos={gestures.dragEffectivePos}
        memberSideOf={gestures.memberSideOf}
        onJoinRef={(el, fid, ifId) => {
          const key = `${fid}:join:${ifId}`;
          if (el !== null) {
            blockEls.current.set(key, el);
          } else {
            blockEls.current.delete(key);
          }
        }}
        edges={edges}
        travelEdges={travelEdges}
        drawing={gestures.drawing}
        edgeRefs={edgeRefs}
        reduced={reducedMotion}
        linkMs={flow?.linkMs ?? 0}
        runId={flow?.runId ?? 0}
        previewElement={gestures.previewNode()}
        viewport={viewport}
        emptyWorkspace={emptyWorkspace}
        selectedFunc={selectedFunc}
        onBoardPointerDown={gestures.onBoardPointerDown}
        onBoardPointerMove={gestures.onBoardPointerMove}
        onBoardPointerUp={gestures.onBoardPointerUp}
        onBoardClick={gestures.onBoardClick}
        onBoardKeyDown={gestures.onBoardKeyDown}
        onPointerCancel={gestures.onPointerCancel}
      />
    </div>
  );
}