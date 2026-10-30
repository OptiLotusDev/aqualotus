/**
 * Execution operations for the program projection.
 *
 * run / clearRun / dismissError. Pure over the bridge + snapshot.
 */

import type { ProgramMutationContext } from "./program_ops";
import { optilotus_runProgram } from "../lib/optilotus";
import { withFailure, clearFailure } from "./program_state";
import { setSnapshotFailThrown } from "./program_ctx_helpers";

export function run(ctx: ProgramMutationContext): void {
  const { setSnapshot } = ctx;
  try {
    setSnapshot((prev) => ({ ...clearFailure(prev), running: true }));
    const started =
      typeof performance !== "undefined" ? performance.now() : 0;
    const result = optilotus_runProgram();
    const durationMs =
      typeof performance !== "undefined"
        ? Math.max(0, performance.now() - started)
        : 0;
    setSnapshot((prev) => {
      if (result.status === "error") {
        return {
          ...withFailure(prev, result, `${result.kind}: ${result.message ?? result.kind}`),
          running: false,
          run: result,
          durationMs,
          recoveryVar: null,
        };
      }
      return {
        ...clearFailure(prev),
        running: false,
        run: result,
        durationMs,
        recoveryVar: null,
      };
    });
  } catch (e: unknown) {
    setSnapshotFailThrown(ctx, e);
  }
}

export function clearRun(ctx: ProgramMutationContext): void {
  const { setSnapshot } = ctx;
  setSnapshot((prev) => ({ ...prev, run: null, durationMs: null }));
}

export function dismissError(ctx: ProgramMutationContext): void {
  const { setSnapshot } = ctx;
  setSnapshot((prev) => ({
    ...clearFailure(prev),
    recoveryVar: null,
  }));
}
