/**
 * Canvas branches: vertical branch frames, true/false labels, empty
 * branch placeholders, and manual merge join points. Preserves all
 * existing DOM attributes and data attributes used by interaction
 * handlers and tests.
 */

import type { ReactElement } from "react";
import type { BranchSide } from "../../lib/graph_topology";
import type { Pos } from "../../lib/layout";
import type { IfShape, MergeJoin } from "../../lib/graph";

interface BranchFrame {
  readonly ifId: number;
  readonly branch: BranchSide;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly empty: boolean;
}

interface JoinDragState {
  readonly ifId: number;
  readonly dx: number;
  readonly dy: number;
}

interface CanvasBranchesProps {
  readonly fid: number;
  readonly frames: readonly BranchFrame[];
  readonly ifShapes: readonly IfShape[];
  readonly mergeJoins?: Readonly<Record<number, MergeJoin>>;
  readonly joinLivePos: (fid: number, ifId: number) => Pos | null;
  readonly joinDrag: JoinDragState | null;
  readonly sizes: ReadonlyMap<string, { readonly w: number; readonly h: number }>;
  readonly funcOrigin: (fid: number) => { readonly x: number; readonly y: number };
  readonly onJoinRef: (el: HTMLDivElement | null, fid: number, ifId: number) => void;
  /** Source of an in-flight connection drag, or null. */
  readonly connectSource: { readonly fid: number; readonly sourceId: number } | null;
}

export default function CanvasBranches(
  props: CanvasBranchesProps,
): ReactElement {
  const {
    fid,
    frames,
    ifShapes,
    mergeJoins,
    joinLivePos,
    joinDrag,
    connectSource,
    onJoinRef,
  } = props;

  return (
    <>
      {frames.map((frame) => (
        <div
          key={`ifbody-${frame.ifId}-${frame.branch}`}
          className={`vbranch${frame.empty ? " vbranch-empty" : ""}`}
          data-if-id={frame.ifId}
          data-fid={fid}
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
      {ifShapes.map((shape) => {
        const state = mergeJoins?.[shape.ifId];
        if (state === undefined || !state.on) return null;
        const pos = joinLivePos(fid, shape.ifId);
        if (pos === null) return null;
        const dragging =
          joinDrag !== null && joinDrag.ifId === shape.ifId;
        return (
          <div
            key={`vjoin-${shape.ifId}`}
            id={`vjoin-${fid}-${shape.ifId}`}
            className="vjoin"
            data-join-of={shape.ifId}
            data-fid={fid}
            data-dragging={dragging ? "true" : undefined}
            data-connect-from={
              connectSource !== null &&
              connectSource.fid === fid &&
              connectSource.sourceId === shape.ifId
                ? "true"
                : undefined
            }
            ref={(el) => onJoinRef(el, fid, shape.ifId)}
            style={{ left: pos.x, top: pos.y }}
          >
            <span
              className="vport vport-top"
              data-port="in"
              aria-hidden="true"
            />
            <span className="vjoin-tag">End of If Block</span>
            <span
              className="vport vport-right"
              data-port="out"
              data-side="right"
              data-block-id={shape.ifId}
              data-fid={fid}
              aria-hidden="true"
            />
          </div>
        );
      })}
    </>
  );
}
