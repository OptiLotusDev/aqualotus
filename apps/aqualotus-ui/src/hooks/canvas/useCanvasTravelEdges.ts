/**
 * Canvas travel edges: matches flow edges to drawn edges for the travelling
 * indicator. Pure over explicit inputs.
 */

import { useMemo } from "react";
import type { CanvasDrawnEdge } from "../../lib/canvas_edges";
import type { FlowState } from "../../lib/flow";

export interface TravelEdge {
  readonly key: string;
  readonly selected: boolean;
  /**
   * `true` on the one connection the run is paused at: the indicator
   * holds at this edge's end — the input block's entry side — until the
   * wait ends. Derived from `flow.pause` (the engine's own status), so
   * it stays `false` for every connection of an unpaved run.
   */
  readonly pause: boolean;
}

interface UseCanvasTravelEdgesArgs {
  readonly edges: readonly CanvasDrawnEdge[];
  readonly flow: FlowState | null;
  readonly selectedCommandId: number | null;
  readonly selectedFunctionId: number | null;
}

export function useCanvasTravelEdges(args: UseCanvasTravelEdgesArgs): readonly TravelEdge[] {
  const { edges, flow, selectedCommandId, selectedFunctionId } = args;

  return useMemo(() => {
    if (flow === null || flow === undefined) return [];
    // Build lookup by the actual drawn edge keys
    const byKey = new Map(edges.map((e) => [e.key, e]));
    // Also build lookup by from/to for branch-head edges
    const branchEdgesByEnds = new Map<string, CanvasDrawnEdge>();
    for (const e of edges) {
      if (e.key.includes(":branch:")) {
        branchEdgesByEnds.set(`${e.fid}:${e.from}:${e.to}`, e);
      }
    }
    const joinOutAfter = new Map<number, string>();
    for (const e of edges) {
      if (e.joinTail === true && e.joinIfId !== undefined) {
        joinOutAfter.set(e.from, `${e.fid}:jo:${e.joinIfId}`);
      }
    }
    const travelSeen = new Set<string>();
    const out: TravelEdge[] = [];
    const pauseCommand = flow.pause;
    // The travelled connection the pause sits on: its drawn end is the
    // input block's entry side. A merge kind draws through two segments
    // (tail rail + join wire); the hold goes on the last one that ends
    // at the connection's destination — the join wire when the run has
    // a continuation, the tail rail itself when it does not.
    let pauseKey: string | null = null;
    const push = (key: string, selected: boolean, isPause: boolean): void => {
      if (travelSeen.has(key)) {
        if (isPause) pauseKey = key;
        return;
      }
      travelSeen.add(key);
      out.push({ key, selected, pause: false });
      if (isPause) pauseKey = key;
    };
    flow.edges.forEach((edge) => {
      const selected =
        edge.from === selectedCommandId && edge.fid === selectedFunctionId;
      const pauseHere = pauseCommand !== null && edge.to === pauseCommand;
      if (edge.kind === "merge") {
        const joinsAfter = joinOutAfter.get(edge.from);
        if (joinsAfter !== undefined) {
          // The run continues past the join: the tail rail feeds the join
          // circle, the join wire carries on into the destination.
          push(`${edge.fid}:merge:${edge.from}`, selected, false);
          push(joinsAfter, selected, pauseHere);
        } else {
          // The connection ends where it lands: the tail rail feeds the
          // destination directly (classic merge, or a join circle with
          // no continuation).
          push(`${edge.fid}:merge:${edge.from}`, selected, pauseHere);
        }
        return;
      }
      if (edge.kind === "branch-head") {
        // Branch head edge: match by from/to to find the correct branch edge key
        const branchEdge = branchEdgesByEnds.get(`${edge.fid}:${edge.from}:${edge.to}`);
        if (branchEdge !== undefined) {
          push(branchEdge.key, selected, pauseHere);
        }
        return;
      }
      // Chain edge: key is ${fid}:${from}
      const chainKey = `${edge.fid}:${edge.from}`;
      const drawn = byKey.get(chainKey);
      if (drawn === undefined) return;
      push(drawn.key, selected, pauseHere);
    });
    if (pauseKey === null) return out;
    return out.map((e) => (e.key === pauseKey ? { ...e, pause: true } : e));
  }, [edges, flow, selectedCommandId, selectedFunctionId]);
}