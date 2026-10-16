import { useCallback, useEffect, useRef } from "react";
import type { CommandId, FunctionId } from "../lib/optilotus";
import type { CommandSummary } from "../lib/optilotus";
import type { LayoutMap, Pos } from "../lib/layout";

interface PendingInherit {
  readonly fid: FunctionId;
  /** Spots handed to newcomers in command order (see `capturePositions`). */
  readonly poses: readonly Pos[];
  readonly oldIds: ReadonlySet<number>;
}

interface GraveEntry {
  readonly pos: Pos;
  readonly sig: string;
}

/** Remembered removals per function (most-recent last). */
const MAX_GRAVE = 50;

/** Content signature so a restored block reclaims its own old spot. */
function sigOf(cmd: CommandSummary): string {
  return [cmd.kind, cmd.var ?? "", cmd.ty ?? "", cmd.expr ?? "", cmd.template ?? ""].join(
    "|",
  );
}

/**
 * Owns position inheritance across command replace AND undo/redo
 * (P10: UI state). The bridge has no in-place edit, so Apply-edit is
 * delete + recreate with fresh ids — which the layout would otherwise
 * auto-place at the row end, visibly teleporting the edited blocks. The
 * caller captures the old blocks' positions (plus the pre-edit id set);
 * once the recreated commands appear in the refreshed projection, the
 * stored positions are applied in command order via `moveBlockIn` (a
 * restore, never a view-undo entry). A failed edit leaves no newcomer
 * (or only the rolled-back original), so the pending capture simply
 * clears once the hook settles.
 *
 * A declare type/name edit also rebuilds its dependent assigns (their
 * baked-in engine types must follow the declaration), so capture
 * covers several blocks at once — see `capturePositions`.
 *
 * Undo/redo recreates blocks under fresh ids too (deleted ids stay
 * dead), so an undone delete would likewise jump to the row end.
 * Removed positions are therefore remembered per function (with a
 * content signature); `armRestore()` — called by the undo/redo buttons
 * just before running the semantic thunk — hands each restored newcomer
 * back its own old spot (signature match, else most-recent). Fresh adds
 * never consume remembered spots: they keep the row-end/drop-point
 * placement from reconciliation.
 */
export function useInheritPosition(
  commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>,
  busy: boolean,
  moveBlockIn: (target: FunctionId, id: CommandId, pos: Pos) => void,
  positionsByFunction?: Readonly<Record<number, LayoutMap>>,
): {
  captureInherit: (
    fid: FunctionId,
    pos: Pos,
    currentIds: readonly CommandId[],
  ) => void;
  capturePositions: (
    fid: FunctionId,
    poses: readonly Pos[],
    currentIds: readonly CommandId[],
  ) => void;
  armRestore: () => void;
} {
  const pendingRef = useRef<PendingInherit | null>(null);
  const armedRef = useRef<boolean>(false);
  const graveRef = useRef<Map<number, GraveEntry[]>>(new Map());
  const prevIdsRef = useRef<Map<number, Set<number>>>(new Map());
  const prevCmdsRef = useRef<Map<number, Map<number, CommandSummary>>>(new Map());
  const lastPosRef = useRef<Map<number, Map<number, Pos>>>(new Map());

  const capturePositions = useCallback(
    (
      fid: FunctionId,
      poses: readonly Pos[],
      currentIds: readonly CommandId[],
    ): void => {
      pendingRef.current = { fid, poses, oldIds: new Set(currentIds) };
    },
    [],
  );

  const captureInherit = useCallback(
    (fid: FunctionId, pos: Pos, currentIds: readonly CommandId[]): void => {
      pendingRef.current = { fid, poses: [pos], oldIds: new Set(currentIds) };
    },
    [],
  );

  const armRestore = useCallback((): void => {
    armedRef.current = true;
  }, []);

  // Settle on every render (deliberately no dep array): the hook must
  // observe the settled projection even when the parent passes a
  // referentially-equal map (failed edit → same ids), otherwise a stale
  // capture would hijack a later unrelated newcomer. Writes target a
  // *different* hook's store and fire at most once per capture — an
  // async-sync handoff, not render-derived state.
  useEffect(() => {
    const posByFn = positionsByFunction ?? {};
    const fids = new Set<number>([
      ...prevIdsRef.current.keys(),
      ...Object.keys(commandsByFunction).map(Number),
    ]);

    // Remember freshly removed positions (with content signatures).
    // Runs for every function including a pending one: the swapped-out
    // originals are exactly what an undo needs to match against.
    for (const fid of fids) {
      const cmds = commandsByFunction[fid] ?? [];
      const current = new Set(cmds.map((c) => c.id));
      const prev = prevIdsRef.current.get(fid) ?? new Set<number>();
      let grave = graveRef.current.get(fid);
      if (grave === undefined) {
        grave = [];
        graveRef.current.set(fid, grave);
      }
      for (const gone of prev) {
        if (current.has(gone)) continue;
        const summary = prevCmdsRef.current.get(fid)?.get(gone);
        const spot = lastPosRef.current.get(fid)?.get(gone);
        if (summary !== undefined && spot !== undefined) {
          grave.push({ pos: { ...spot }, sig: sigOf(summary) });
          if (grave.length > MAX_GRAVE) grave.shift();
        }
      }
    }
    syncLastPos();

    const pending = pendingRef.current;
    if (pending !== null) {
      // Replace path (takes precedence over the armed restore below):
      // pair newcomers in command order with the captured spots. Extra
      // spots (rolled-back originals that never reappeared) and extra
      // newcomers (unrelated) are left alone.
      const cmds = commandsByFunction[pending.fid] ?? [];
      const newcomers = cmds.filter((c) => !pending.oldIds.has(c.id));
      const count = Math.min(newcomers.length, pending.poses.length);
      for (let i = 0; i < count; i += 1) {
        const cmd = newcomers[i];
        const pos = pending.poses[i];
        if (cmd !== undefined && pos !== undefined) {
          moveBlockIn(pending.fid, cmd.id, pos);
        }
      }
      // A settle with newcomers consumes the capture; a quiet settle
      // clears it (failed edit) — but never while busy (in-flight).
      if (newcomers.length > 0 || !busy) {
        pendingRef.current = null;
      }
      syncBookkeeping();
      return;
    }

    // Armed (undo/redo) newcomers reclaim remembered spots.
    if (armedRef.current) {
      for (const fid of fids) {
        const cmds = commandsByFunction[fid] ?? [];
        const prev = prevIdsRef.current.get(fid) ?? new Set<number>();
        const newcomers = cmds.filter((c) => !prev.has(c.id));
        if (newcomers.length === 0) continue;
        const grave = graveRef.current.get(fid) ?? [];
        for (const cmd of newcomers) {
          if (grave.length === 0) break;
          const want = sigOf(cmd);
          let pick = -1;
          for (let i = grave.length - 1; i >= 0; i -= 1) {
            if (grave[i]?.sig === want) {
              pick = i;
              break;
            }
          }
          if (pick === -1) pick = grave.length - 1;
          const spot = grave.splice(pick, 1)[0];
          if (spot !== undefined) {
            moveBlockIn(fid, cmd.id, spot.pos);
          }
        }
      }
      if (!busy) armedRef.current = false;
    }

    syncBookkeeping();

    function syncBookkeeping(): void {
      for (const fid of fids) {
        const cmds = commandsByFunction[fid] ?? [];
        prevIdsRef.current.set(fid, new Set(cmds.map((c) => c.id)));
        prevCmdsRef.current.set(
          fid,
          new Map(cmds.map((c) => [c.id, c] as const)),
        );
      }
    }

    function syncLastPos(): void {
      for (const fid of fids) {
        const cmds = commandsByFunction[fid] ?? [];
        const table = posByFn[fid];
        if (table === undefined) continue;
        let known = lastPosRef.current.get(fid);
        if (known === undefined) {
          known = new Map();
          lastPosRef.current.set(fid, known);
        }
        for (const cmd of cmds) {
          const p = table[cmd.id];
          if (p !== undefined) known.set(cmd.id, { ...p });
        }
        // Forget ids gone from every view (their spot lives in the
        // graveyard now, if it was ever known).
        const live = new Set(cmds.map((c) => c.id));
        for (const id of [...known.keys()]) {
          if (!live.has(id)) known.delete(id);
        }
      }
    }
  });

  return { captureInherit, capturePositions, armRestore };
}
