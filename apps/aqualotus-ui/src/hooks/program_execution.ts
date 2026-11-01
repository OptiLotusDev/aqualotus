/**
 * Execution operations for the program projection.
 *
 * The single consolidated execution path: `run` (start), `provideInput`,
 * `cancelRun`, `clearRun`, and `dismissError`. Each op is a bridge call
 * plus a snapshot transition; the state transformation itself stays in
 * `program_state.ts` (`applyRunStatus`).
 *
 * Pure over the bridge + snapshot. The React-owned lifecycle stays in
 * `useProgram`: the projection hook passes `sessionActiveRef` through
 * `ProgramMutationContext`, and these operations only read and set it.
 */

import type { ProgramMutationContext } from "./program_ops";
import {
  optilotus_runProgramCancel,
  optilotus_runProgramProvideInput,
  optilotus_runProgramStart,
} from "../lib/optilotus";
import { applyRunStatus, clearFailure } from "./program_state";
import { setSnapshotFailThrown } from "./program_ctx_helpers";

/** Start a run from the entry point. */
export function run(ctx: ProgramMutationContext): void {
  const { setSnapshot, sessionActiveRef } = ctx;
  try {
    // A paused session left from a previous run is cancelled first: a
    // fresh run must never by accident resume an abandoned one.
    if (sessionActiveRef.current) {
      optilotus_runProgramCancel();
      sessionActiveRef.current = false;
    }
    setSnapshot((prev) => ({
      ...clearFailure(prev),
      running: true,
      pendingInput: null,
      run: null,
      durationMs: null,
    }));
    const started =
      typeof performance !== "undefined" ? performance.now() : 0;
    const result = optilotus_runProgramStart();
    const durationMs =
      typeof performance !== "undefined"
        ? Math.max(0, performance.now() - started)
        : 0;
    sessionActiveRef.current = result.status === "waiting_input";
    setSnapshot((prev) => applyRunStatus(prev, result, durationMs));
  } catch (e: unknown) {
    sessionActiveRef.current = false;
    setSnapshotFailThrown(ctx, e);
  }
}

/** Feed a line to the paused run; no-op when nothing waits. */
export function provideInput(
  ctx: ProgramMutationContext,
  value: string,
): void {
  const { setSnapshot, sessionActiveRef } = ctx;
  if (!sessionActiveRef.current) return;
  try {
    setSnapshot((prev) => ({
      ...clearFailure(prev),
      running: true,
    }));
    const started =
      typeof performance !== "undefined" ? performance.now() : 0;
    const result = optilotus_runProgramProvideInput(value);
    const durationMs =
      typeof performance !== "undefined"
        ? Math.max(0, performance.now() - started)
        : 0;
    sessionActiveRef.current = result.status === "waiting_input";
    setSnapshot((prev) => applyRunStatus(prev, result, durationMs));
  } catch (e: unknown) {
    sessionActiveRef.current = false;
    setSnapshotFailThrown(ctx, e);
  }
}

/** Cancel the paused run (the run itself, not its output). */
export function cancelRun(ctx: ProgramMutationContext): void {
  const { setSnapshot, sessionActiveRef } = ctx;
  if (sessionActiveRef.current) {
    optilotus_runProgramCancel();
    sessionActiveRef.current = false;
  }
  setSnapshot((prev) => ({
    ...prev,
    running: false,
    pendingInput: null,
  }));
}

/** Drop the run's output and any paused session. */
export function clearRun(ctx: ProgramMutationContext): void {
  const { setSnapshot, sessionActiveRef } = ctx;
  if (sessionActiveRef.current) {
    optilotus_runProgramCancel();
    sessionActiveRef.current = false;
  }
  setSnapshot((prev) => ({
    ...prev,
    run: null,
    durationMs: null,
    pendingInput: null,
  }));
}

export function dismissError(ctx: ProgramMutationContext): void {
  const { setSnapshot } = ctx;
  setSnapshot((prev) => ({
    ...clearFailure(prev),
    recoveryVar: null,
  }));
}
