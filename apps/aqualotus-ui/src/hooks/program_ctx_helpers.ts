/**
 * Small shared state-transition helpers used by program feature modules.
 * Kept in one place so every module applies the same snapshot pattern:
 * set busy, clear failure, or record a thrown/bridge error.
 */

import type { Dispatch, SetStateAction } from "react";
import type { ProgramSnapshot } from "./program_state";
import { failCommand, failThrown, clearFailure } from "./program_state";

/** Set `busy: true`, clear any prior failure. */
export function setBusy(ctx: {
  setSnapshot: Dispatch<SetStateAction<ProgramSnapshot>>;
}): void {
  ctx.setSnapshot((prev) => ({
    ...clearFailure(prev),
    busy: true,
    recoveryVar: null,
  }));
}

/** Record a bridge error into the snapshot. */
export function setSnapshotFailCommand(
  ctx: {
    setSnapshot: Dispatch<SetStateAction<ProgramSnapshot>>;
  },
  raw: unknown,
): void {
  ctx.setSnapshot((prev) => failCommand(prev, raw));
}

/** Record a thrown exception into the snapshot. */
export function setSnapshotFailThrown(
  ctx: {
    setSnapshot: Dispatch<SetStateAction<ProgramSnapshot>>;
  },
  e: unknown,
): void {
  ctx.setSnapshot((prev) => failThrown(prev, e));
}

/** Set selectedCommandId on the snapshot. */
export function setSnapshotSel(
  ctx: {
    setSnapshot: Dispatch<SetStateAction<ProgramSnapshot>>;
  },
  id: number,
): void {
  ctx.setSnapshot((prev) => ({ ...prev, selectedCommandId: id }));
}
