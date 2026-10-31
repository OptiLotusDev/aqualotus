/**
 * Canvas workspace: main workspace composition — package container,
 * struct container, function containers, branch frames, blocks, edges,
 * and empty state. Keeps the canvas world structure and positioning.
 */

import type { ReactElement } from "react";
import type { CommandSummary } from "../../lib/optilotus";
import type { Pos } from "../../lib/layout";
import type { CanvasDrawnEdge } from "../../lib/canvas_edges";
import type { TravelEdge } from "../../hooks/canvas/useCanvasTravelEdges";
import type { IfShape, BranchSide } from "../../lib/graph";
import PackageContainer from "../PackageContainer";
import StructContainer from "../StructContainer";
import FunctionContainer from "../FunctionContainer";
import CanvasBranches from "./CanvasBranches";
import CanvasBlocks from "./CanvasBlocks";
import CanvasEdges from "./CanvasEdges";
import CanvasEmptyState from "./CanvasEmptyState";

interface CanvasWorkspaceProps {
  readonly boardRef: React.RefObject<HTMLDivElement | null>;
  readonly functions: readonly { readonly id: number; readonly name: string; readonly isMain: boolean }[];
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
  readonly layout: {
    readonly pkgPos: { readonly x: number; readonly y: number };
    readonly pkgW: number;
    readonly pkgH: number;
    readonly structW: number;
    readonly structH: number;
    readonly worldW: number;
    readonly worldH: number;
    readonly heights: ReadonlyMap<number, number>;
    readonly widths: ReadonlyMap<number, number>;
    readonly ys: ReadonlyMap<number, number>;
    readonly funcOrigin: (fid: number) => Pos;
  };
  readonly zoom: number;
  readonly selectedFunctionId: number | null;
  readonly selectedCommandId: number | null;
  readonly errorId: number | null;
  readonly errorFunctionId: number | null;
  readonly conditionTextFor?: (fid: number, ifId: number) => string | null;
  readonly onSelectFunction: (id: number) => void;
  readonly onRequestLibrary: () => void;
  readonly ifShapesByFunction: ReadonlyMap<number, readonly IfShape[]>;
  readonly mergeJoins?: Readonly<Record<number, { readonly on: boolean; readonly pos: Pos | null }>>;
  readonly branchFrames: (fid: number, viewport: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null) => readonly { readonly ifId: number; readonly branch: BranchSide; readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }; readonly empty: boolean }[];
  readonly joinLivePos: (fid: number, ifId: number) => Pos | null;
  readonly joinDrag: { readonly ifId: number; readonly dx: number; readonly dy: number } | null;
  readonly sizes: ReadonlyMap<string, { readonly w: number; readonly h: number }>;
  readonly visibleCmds: (fid: number, cmds: readonly CommandSummary[]) => { readonly cmd: CommandSummary; readonly index: number }[];
  readonly exitingBlocks: readonly { readonly key: string; readonly item: { readonly fid: number; readonly cmd: CommandSummary; readonly index: number } }[];
  readonly blockPositions: ReadonlyMap<string, Pos>;
  readonly dragEffectivePos: (fid: number, cmd: CommandSummary, index: number) => Pos;
  readonly memberSideOf: (fid: number, id: number) => BranchSide | undefined;
  readonly onJoinRef: (el: HTMLDivElement | null, fid: number, ifId: number) => void;
  readonly onBlockRef?: (el: HTMLDivElement | null, fid: number, cmdId: number) => void;
  /** Source of an in-flight connection drag, or null. Drives the
   * "connecting from this block/join" highlight so the source port and
   * the dragged wire read as one stroke. */
  readonly connectSource: { readonly fid: number; readonly sourceId: number } | null;
  readonly edges: readonly CanvasDrawnEdge[];
  readonly travelEdges: readonly TravelEdge[];
  readonly drawing: ReadonlySet<string>;
  readonly edgeRefs: React.MutableRefObject<Map<string, SVGPathElement>>;
  readonly reduced: boolean;
  readonly linkMs: number;
  readonly runId: number;
  readonly previewElement: ReactElement | null;
  readonly viewport: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  readonly emptyWorkspace: boolean;
  readonly selectedFunc: { readonly id: number; readonly name: string; readonly isMain: boolean } | null;
  // Gesture handlers
  readonly onBoardPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  readonly onBoardPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  readonly onBoardPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  readonly onBoardClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  readonly onBoardKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: () => void;
}

export default function CanvasWorkspace(
  props: CanvasWorkspaceProps,
): ReactElement {
  const {
    boardRef,
    functions,
    commandsByFunction,
    layout,
    zoom,
    selectedFunctionId,
    selectedCommandId,
    errorId,
    errorFunctionId,
    conditionTextFor,
    onSelectFunction,
    onRequestLibrary,
    ifShapesByFunction,
    mergeJoins,
    branchFrames,
    joinLivePos,
    joinDrag,
    sizes,
    visibleCmds,
    exitingBlocks,
    blockPositions,
    dragEffectivePos,
    memberSideOf,
    onJoinRef,
    connectSource,
    edges,
    travelEdges,
    drawing,
    edgeRefs,
    reduced,
    linkMs,
    runId,
    previewElement,
    viewport,
    emptyWorkspace,
    selectedFunc,
    onBoardPointerDown,
    onBoardPointerMove,
    onBoardPointerUp,
    onBoardClick,
    onBoardKeyDown,
    onPointerCancel,
  } = props;
  const onBlockRef = props.onBlockRef ?? (() => {});

  const {
    pkgPos, pkgW, pkgH, structW, structH, worldW, worldH,
    heights, widths, ys, funcOrigin,
  } = layout;

  const { PKG_PAD, STRUCT_PAD, FUNC_MIN_HEIGHT, FUNC_MIN_WIDTH } = {
    PKG_PAD: 40,
    STRUCT_PAD: 30,
    FUNC_MIN_HEIGHT: 200,
    FUNC_MIN_WIDTH: 600,
  } as const;

  return (
    <div className="canvas-wrap">
      <div
        id="board"
        ref={boardRef}
        className="board"
        onPointerDown={onBoardPointerDown}
        onPointerMove={onBoardPointerMove}
        onPointerUp={onBoardPointerUp}
        onClick={onBoardClick}
        onPointerCancel={onPointerCancel}
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
            <div
              className="pkg-pos"
              style={{ left: pkgPos.x, top: pkgPos.y }}
            >
              <PackageContainer
                functionCount={functions.length}
                width={pkgW}
                height={pkgH}
              >
                <div className="struct-pos" style={{ left: PKG_PAD, top: PKG_PAD }}>
                  <StructContainer width={structW} height={structH}>
                    {functions.map((fn) => {
                      const cmds = commandsByFunction[fn.id] ?? [];
                      const fHeight = heights.get(fn.id) ?? FUNC_MIN_HEIGHT;
                      const fWidth = widths.get(fn.id) ?? FUNC_MIN_WIDTH;
                      return (
                        <FunctionContainer
                          key={fn.id}
                          func={fn}
                          selected={fn.id === selectedFunctionId}
                          blockCount={cmds.length}
                          width={fWidth}
                          height={fHeight}
                          position={{ x: STRUCT_PAD, y: ys.get(fn.id) ?? STRUCT_PAD }}
                          onSelect={() => onSelectFunction(fn.id)}
                        >
                          <CanvasBranches
                            fid={fn.id}
                            frames={branchFrames(fn.id, viewport)}
                            ifShapes={ifShapesByFunction.get(fn.id) ?? []}
                            mergeJoins={mergeJoins}
                            joinLivePos={joinLivePos}
                            joinDrag={joinDrag}
                            sizes={sizes}
                            funcOrigin={funcOrigin}
                            connectSource={connectSource}
                            onJoinRef={onJoinRef}
                          />
                          <CanvasBlocks
                            fid={fn.id}
                            fn={fn}
                            cmds={cmds}
                            visibleCmds={visibleCmds(fn.id, cmds)}
                            exitingBlocks={exitingBlocks}
                            selectedCommandId={selectedCommandId}
                            selectedFunctionId={selectedFunctionId}
                            errorId={errorId}
                            errorFunctionId={errorFunctionId}
                            conditionTextFor={conditionTextFor}
                            blockPositions={blockPositions}
                            dragEffectivePos={dragEffectivePos}
                            memberSideOf={memberSideOf}
                            connectSource={connectSource}
                            onRequestLibrary={onRequestLibrary}
                            onBlockRef={onBlockRef}
                          />
                        </FunctionContainer>
                      );
                    })}
                  </StructContainer>
                </div>
              </PackageContainer>
            </div>
            <CanvasEdges
              edges={edges}
              travelEdges={travelEdges}
              drawing={drawing}
              selectedCommandId={selectedCommandId}
              selectedFunctionId={selectedFunctionId}
              edgeRefs={edgeRefs}
              reduced={reduced}
              linkMs={linkMs}
              runId={runId}
              previewElement={previewElement}
              viewport={viewport}
              worldW={worldW}
              worldH={worldH}
            />
            {emptyWorkspace ? (
              <CanvasEmptyState
                selectedFunc={selectedFunc}
                onRequestLibrary={onRequestLibrary}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
