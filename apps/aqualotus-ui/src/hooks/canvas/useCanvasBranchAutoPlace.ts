/**
 * Canvas branch auto-place: auto-places newly joined branch members that
 * appear without a gesture (e.g. undo/redo replay). Side effects only.
 */

import { useEffect, useRef } from "react";
import type { CommandSummary } from "../../lib/optilotus";
import type { UiCommand } from "../../lib/program";
import type { LayoutMap } from "../../lib/layout";
import type { IfShape } from "../../lib/graph";
import { buildIfShapes } from "../../lib/graph";
import type { Size } from "../../components/visualEditor_constants";
import { FALLBACK_SIZE, fallbackPos } from "../../components/visualEditor_constants";

interface UseCanvasBranchAutoPlaceArgs {
  readonly functions: readonly { readonly id: number }[];
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
  readonly ifShapesByFunction: ReadonlyMap<number, readonly IfShape[]>;
  readonly layoutStore: Readonly<Record<number, LayoutMap>>;
  readonly sizes: ReadonlyMap<string, Size>;
  readonly busy: boolean;
  readonly placeBranchMember: (fid: number, ifId: number, branch: "then" | "else", blockId: number) => void;
}

export function useCanvasBranchAutoPlace(args: UseCanvasBranchAutoPlaceArgs): void {
  const { functions, commandsByFunction, ifShapesByFunction, layoutStore, sizes, busy, placeBranchMember } = args;

  const branchMembersSeenRef = useRef<ReadonlyMap<string, readonly number[]>>(new Map());

  useEffect(() => {
    const next = new Map<string, readonly number[]>();
    const gains: {
      fid: number;
      ifId: number;
      branch: "then" | "else";
      id: number;
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
      const rectOf = (id: number): { x: number; y: number; w: number; h: number } | undefined => {
        const index = byIndex.get(id);
        const cmd = index === undefined ? undefined : cmds[index];
        if (cmd === undefined || index === undefined) return undefined;
        const p = layoutStore[gain.fid]?.[id] ?? fallbackPos(index);
        const s = sizes.get(`${gain.fid}:${id}`) ?? FALLBACK_SIZE;
        return { x: p.x, y: p.y, w: s.w, h: s.h };
      };
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
      const p = layoutStore[gain.fid]?.[gain.id] ?? fallbackPos(byIndex.get(gain.id) ?? -1);
      if (
        preFrame !== undefined &&
        p.x >= preFrame.x &&
        p.x <= preFrame.x + preFrame.w &&
        p.y >= preFrame.y &&
        p.y <= preFrame.y + preFrame.h
      ) {
        continue;
      }
      placeBranchMember(gain.fid, gain.ifId, gain.branch, gain.id);
    }
  }, [functions, commandsByFunction, ifShapesByFunction, layoutStore, sizes, busy, placeBranchMember]);
}