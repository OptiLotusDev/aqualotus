/**
 * Pure program-state domain logic.
 *
 * These functions take a snapshot and return a **new** snapshot: they
 * never touch React state, refs, or the bridge. `useProgram` owns the
 * single snapshot (`snapshotRef`/`setSnapshot`) and applies these
 * transformations, so there is one source of truth and these stay
 * easy to unit-test in isolation.
 */

import type {
  CommandId,
  FunctionId,
  FunctionInfo,
  FunctionSummary,
  OptilotusError,
  RunResult,
} from "../lib/optilotus";
import { isOptilotusError, errorMessage, type UiCommand } from "../lib/program";
import {
  internalCommandOf,
  resolveErrorTarget,
  type UiRunError,
} from "../lib/errors";

/** Immutable program projection owned by `useProgram` (P10). */
export interface ProgramSnapshot {
  readonly functions: readonly FunctionSummary[];
  readonly selectedId: FunctionId | null;
  readonly selected: (FunctionInfo & { status: "ok" }) | null;
  /**
   * The user-visible entry point of the selected function.
   *
   * The engine's own `entry` can point at a **hidden** node: when an
   * `if` heads the chain, the engine points the entry at the `if`'s
   * condition compute. The UI resolves it to the block the chain
   * really starts at (`lib/graph.ts::resolveEntry`), so every consumer
   * (the connection notice, the link planners, the flow animation)
   * works on a block id.
   */
  readonly entry: number | null;
  readonly commands: readonly UiCommand[];
  /** All functions' commands, keyed by FunctionId (for the workspace canvas). */
  readonly commandsByFunction: Readonly<
    Record<number, readonly UiCommand[]>
  >;
  readonly selectedCommandId: CommandId | null;
  readonly run: RunResult | null;
  readonly running: boolean;
  /** UI-measured bridge round-trip of the last run (not runtime CPU time). */
  readonly durationMs: number | null;
  readonly busy: boolean;
  readonly actionError: string;
  /**
   * The failure the UI is currently showing, **exactly as the bridge
   * reported it**.
   *
   * The envelope is kept verbatim: the error family (`kind`), the
   * engine's message, the internal IR node id (`command`) and the
   * kind-specific extras (`detail`, `value`, `expected`, `found`,
   * `limit`, `var`, `function`). `null` when there is no failure.
   *
   * `command` is an **internal node id**, not a block id — see
   * `lib/errors.ts`.
   */
  readonly error: UiRunError | null;
  /**
   * The visible block the current failure points at.
   *
   * `null` when the failure cannot be attributed to a block the canvas
   * knows: the engine blamed a hidden node (a `print`'s hidden print
   * node, a `cast`'s hidden compute node, an `if`'s hidden condition
   * compute) or a node of another package. The UI never guesses a
   * block for an unresolved failure.
   */
  readonly errorBlockId: CommandId | null;
  /** The function that owns {@link ProgramSnapshot.errorBlockId}. */
  readonly errorFunctionId: FunctionId | null;
  /**
   * Non-destructive recovery hint: when an assign fails because its
   * variable is undeclared, the attempted name is kept here so the UI
   * can offer a one-click declare instead of dropping the user's work.
   */
  readonly recoveryVar: string | null;
}

export const EMPTY: ProgramSnapshot = {
  functions: [],
  selectedId: null,
  selected: null,
  entry: null,
  commands: [],
  commandsByFunction: {},
  selectedCommandId: null,
  run: null,
  running: false,
  durationMs: null,
  busy: false,
  actionError: "",
  error: null,
  errorBlockId: null,
  errorFunctionId: null,
  recoveryVar: null,
};

/** Captured failure: the human message, the verbatim envelope, and the
 * resolved visible target. */
export function withFailure(
  snapshot: ProgramSnapshot,
  error: UiRunError,
  message: string,
): ProgramSnapshot {
  const target = resolveErrorTarget(
    snapshot.commandsByFunction,
    internalCommandOf(error),
  );
  return {
    ...snapshot,
    actionError: message,
    error,
    errorBlockId: target?.blockId ?? null,
    errorFunctionId: target?.functionId ?? null,
  };
}

/** Forget the current failure. The message, the verbatim envelope and
 * the resolved visible target go together: a stale target can never
 * outlive the failure it belonged to. */
export function clearFailure(snapshot: ProgramSnapshot): ProgramSnapshot {
  return {
    ...snapshot,
    actionError: "",
    error: null,
    errorBlockId: null,
    errorFunctionId: null,
  };
}

/** Record a thrown failure. */
export function failThrown(
  snapshot: ProgramSnapshot,
  e: unknown,
): ProgramSnapshot {
  return {
    ...clearFailure(snapshot),
    busy: false,
    running: false,
    actionError: e instanceof Error ? e.message : String(e),
  };
}

/** Re-derive the visible target of the current failure against the
 * graph as it is now. A block that was deleted no longer owns the id
 * the engine blamed, so the target disappears with it. */
export function withResolvedTarget(
  snapshot: ProgramSnapshot,
): ProgramSnapshot {
  const target = resolveErrorTarget(
    snapshot.commandsByFunction,
    internalCommandOf(snapshot.error!),
  );
  return {
    ...snapshot,
    errorBlockId: target?.blockId ?? null,
    errorFunctionId: target?.functionId ?? null,
  };
}

/** Record a bridge failure into the snapshot. */
export function failCommand(
  snapshot: ProgramSnapshot,
  raw: unknown,
): ProgramSnapshot {
  if (typeof raw !== "object" || raw === null || !("status" in raw)) {
    return {
      ...clearFailure(snapshot),
      busy: false,
      actionError: String(raw),
    };
  }
  const result = raw as { status: string } & Record<string, unknown>;
  if (!isOptilotusError(result)) {
    return { ...snapshot, busy: false };
  }
  return {
    ...withFailure(snapshot, result, errorMessage(result)),
    busy: false,
    recoveryVar: snapshot.recoveryVar,
  };
}

/** `true` when a typed bridge error is an undeclared-variable failure. */
export function isUndeclaredError(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || !("status" in raw)) {
    return false;
  }
  const result = raw as { status: string } & Record<string, unknown>;
  if (!isOptilotusError(result)) return false;
  return result.message.includes("declare it first");
}

/** A typed bridge-shaped error for UI-side validation that prevents an
 * invalid Engine write. Engine failures are always passed through
 * verbatim. */
export function castingValidationError(message: string): OptilotusError {
  return {
    status: "error",
    kind: "PackageError",
    command: null,
    message,
  };
}
