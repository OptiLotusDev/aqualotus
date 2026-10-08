import { useCallback, useEffect, useRef } from "react";
import type { CommandId, FunctionId } from "../lib/optilotus";
import type { CommandSummary } from "../lib/optilotus";
import type { Pos } from "../lib/layout";

interface PendingInherit {
  readonly fid: FunctionId;
  readonly oldIds: ReadonlySet<number>;
  readonly pos: Pos;
}

/**
 * Owns position inheritance across command replace (P10: UI state).
 * The bridge has no in-place edit, so Apply-edit is delete + recreate
 * with a fresh id — which the layout would otherwise auto-place at the
 * row end, visibly teleporting the edited block. The caller captures
 * the old block's position (plus the pre-edit id set); once the
 * recreated command appears in the refreshed projection, its stored
 * position is applied via `moveBlockIn` (a restore, never a view-undo
 * entry). A failed edit leaves no newcomer, so the pending capture
 * simply clears once the hook settles.
 */
export function useInheritPosition(
  commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>,
  busy: boolean,
  moveBlockIn: (target: FunctionId, id: CommandId, pos: Pos) => void,
): {
  captureInherit: (
    fid: FunctionId,
    pos: Pos,
    currentIds: readonly CommandId[],
  ) => void;
} {
  const pendingRef = useRef<PendingInherit | null>(null);

  const captureInherit = useCallback(
    (fid: FunctionId, pos: Pos, currentIds: readonly CommandId[]): void => {
      pendingRef.current = { fid, oldIds: new Set(currentIds), pos };
    },
    [],
  );

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending === null) return;
    const cmds = commandsByFunction[pending.fid] ?? [];
    const newcomer = cmds.find((c) => !pending.oldIds.has(c.id));
    if (newcomer === undefined) {
      if (!busy) pendingRef.current = null;
      return;
    }
    moveBlockIn(pending.fid, newcomer.id, pending.pos);
    pendingRef.current = null;
  });

  return { captureInherit };
}
