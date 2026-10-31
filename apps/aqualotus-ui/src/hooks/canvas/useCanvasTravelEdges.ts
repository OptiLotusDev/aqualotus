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
      if (edge.kind === "branch-head") {
        // Branch head edge: match by from/to to find the correct branch edge key
        const branchEdge = branchEdgesByEnds.get(`${edge.fid}:${edge.from}:${edge.to}`);
        if (branchEdge !== undefined) {
          push(branchEdge.key, selected);
        }
        return;
      }
      // Chain edge: key is ${fid}:${from}
      const chainKey = `${edge.fid}:${edge.from}`;
      const drawn = byKey.get(chainKey);
      if (drawn === undefined) return;
      push(drawn.key, selected);
    });
    return out;
  }, [edges, flow, selectedCommandId, selectedFunctionId]);
}