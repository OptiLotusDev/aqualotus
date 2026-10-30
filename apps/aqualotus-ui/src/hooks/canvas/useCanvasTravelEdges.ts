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
    const byEnds = new Map(edges.map((e) => [`${e.fid}:${e.from}:${e.to}`, e]));
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
      const drawn = byEnds.get(`${edge.fid}:${edge.from}:${edge.to}`);
      if (drawn === undefined) return;
      push(drawn.key, selected);
    });
    return out;
  }, [edges, flow, selectedCommandId, selectedFunctionId]);
}