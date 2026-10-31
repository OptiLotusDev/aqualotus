/**
 * Canvas if shapes: derives branch membership, container frames, and merge
 * targets from the engine's command summaries. Pure over explicit inputs.
 */

import { useMemo } from "react";
import type { CommandSummary } from "../../lib/optilotus";
import type { LayoutMap } from "../../lib/layout";
import type { IfShape } from "../../lib/graph";
import { buildIfShapes } from "../../lib/graph";
import type { Size } from "../../components/visualEditor_constants";
import { fallbackPos, FALLBACK_SIZE } from "../../components/visualEditor_constants";

interface UseCanvasIfShapesArgs {
  readonly functions: readonly { readonly id: number }[];
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
  readonly layoutStore: Readonly<Record<number, LayoutMap>>;
  readonly sizes: ReadonlyMap<string, Size>;
}

export function useCanvasIfShapes(args: UseCanvasIfShapesArgs): ReadonlyMap<number, readonly IfShape[]> {
  const { functions, commandsByFunction, layoutStore, sizes } = args;

  return useMemo(() => {
    const out = new Map<number, readonly IfShape[]>();
    for (const fn of functions) {
      const cmds = commandsByFunction[fn.id] ?? [];
      const byIndex = new Map<number, number>();
      cmds.forEach((cmd, i) => byIndex.set(cmd.id, i));
      const store = layoutStore[fn.id];
      const rectOf = (id: number): { x: number; y: number; w: number; h: number } | undefined => {
        const cmd = cmds[byIndex.get(id) ?? -1];
        if (cmd === undefined) return undefined;
        const p = store?.[cmd.id] ?? fallbackPos(byIndex.get(id) ?? 0);
        const s = sizes.get(`${fn.id}:${id}`) ?? FALLBACK_SIZE;
        return { x: p.x, y: p.y, w: s.w, h: s.h };
      };
      out.set(fn.id, buildIfShapes(cmds, rectOf, rectOf));
    }
    return out;
  }, [functions, commandsByFunction, layoutStore, sizes]);
}