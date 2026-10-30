/**
 * Canvas edges: derives the semantic edges from `next` pointers in world
 * coordinates. Pure over explicit inputs.
 */

import { useMemo } from "react";
import type { CommandSummary } from "../../lib/optilotus";
import type { LayoutMap, Pos } from "../../lib/layout";
import type { IfShape, MergeJoin } from "../../lib/graph";
import { branchOwnerOf, joinDefaultPos } from "../../lib/graph";
import { buildEdges } from "../../lib/canvas_edges";
import type { CanvasDrawnEdge } from "../../lib/canvas_edges";
import type { Size } from "../../components/visualEditor_constants";
import { FALLBACK_SIZE } from "../../components/visualEditor_constants";

interface CanvasLayoutLike {
  readonly posOf: (fid: number, cmd: CommandSummary, index: number) => Pos;
  readonly funcOrigin: (fid: number) => Pos;
}

interface UseCanvasEdgesArgs {
  readonly functions: readonly { readonly id: number }[];
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
  readonly layoutStore: Readonly<Record<number, LayoutMap>>;
  readonly sizes: ReadonlyMap<string, Size>;
  readonly layout: CanvasLayoutLike;
  readonly ifShapesByFunction: ReadonlyMap<number, readonly IfShape[]>;
  readonly mergeJoins?: Readonly<Record<number, MergeJoin>>;
}

export function useCanvasEdges(args: UseCanvasEdgesArgs): readonly CanvasDrawnEdge[] {
  const { functions, commandsByFunction, layoutStore, sizes, layout, ifShapesByFunction, mergeJoins } = args;

  return useMemo(() => {
    const out: CanvasDrawnEdge[] = [];
    for (const fn of functions) {
      const cmds = commandsByFunction[fn.id] ?? [];
      const byId = new Map<number, number>();
      cmds.forEach((c, i) => byId.set(c.id, i));
      const owners = branchOwnerOf(cmds);
      const worldRect = (c: CommandSummary, i: number): { x: number; y: number; w: number; h: number } => {
        const p = layout.posOf(fn.id, c, i);
        const f = layout.funcOrigin(fn.id);
        const s = sizes.get(`${fn.id}:${c.id}`) ?? FALLBACK_SIZE;
        return { x: f.x + p.x, y: f.y + p.y, w: s.w, h: s.h };
      };
      const joinOn = (ifId: number): boolean =>
        mergeJoins?.[ifId]?.on === true;
      const joinBasePos = (fid: number, ifId: number): Pos | null => {
        const state = mergeJoins?.[ifId];
        if (state === undefined || !state.on) return null;
        const shape = (ifShapesByFunction.get(fid) ?? []).find(
          (s) => s.ifId === ifId,
        );
        const pos = state.pos ?? joinDefaultPos(shape?.frames ?? []);
        if (pos === null) return null;
        return { x: pos.x, y: pos.y };
      };
      const joinWorldRect = (ifId: number): { x: number; y: number; w: number; h: number } | null => {
        const base = joinBasePos(fn.id, ifId);
        if (base === null) return null;
        const s = sizes.get(`${fn.id}:join:${ifId}`) ?? { w: 168, h: 40 };
        const f = layout.funcOrigin(fn.id);
        return { x: f.x + base.x, y: f.y + base.y, w: s.w, h: s.h };
      };
      const ifShapes = ifShapesByFunction.get(fn.id) ?? [];
      out.push(
        ...buildEdges({
          cmds,
          byId,
          worldRect,
          joinOn,
          owners,
          joinWorldRect,
          ifShapes,
          fid: fn.id,
        }),
      );
    }
    return out;
  }, [functions, commandsByFunction, sizes, layoutStore, layout, ifShapesByFunction, mergeJoins]);
}