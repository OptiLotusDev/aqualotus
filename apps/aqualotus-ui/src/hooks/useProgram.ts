import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommandId,
  CommandSummary,
  FunctionId,
  FunctionInfo,
  FunctionSummary,
  OptilotusError,
  RunResult,
} from "../lib/optilotus";
import {
  optilotus_assign,
  optilotus_cast,
  optilotus_clearPackage,
  optilotus_createFunction,
  optilotus_declare,
  optilotus_declareWithAccess,
  optilotus_deleteCommand,
  optilotus_deleteFunction,
  optilotus_getFunction,
  optilotus_if,
  optilotus_if_append,
  optilotus_if_condition,
  optilotus_if_set_condition,
  optilotus_input,
  optilotus_listCommands,
  optilotus_listFunctions,
  optilotus_print,
  optilotus_renameFunction,
  optilotus_return,
  optilotus_runProgram,
  optilotus_setEntry,
  optilotus_setNext,
  optilotus_type,
} from "../lib/optilotus";
import { HistoryIdMap, type HistoryEntry } from "../lib/history";
import {
  commandDraftEqual,
  declareEditAffected,
  errorMessage,
  isOptilotusError,
  normalizeDeclareInit,
  renameRefs,
  summaryToDraft,
  type UiCommand,
} from "../lib/program";
import type { CommandDraft } from "../lib/program";
import {
  castingIncomplete,
  collapseCasting,
  declaredTypeOf,
  nextConvertedNames,
  nextCastingNames,
  resolveCastingEntry,
  type CastingInfo,
} from "../lib/casting";
import {
  branchOwnerOf,
  chainTailOf,
  resolveEntry,
  type LinkPlan,
} from "../lib/graph";
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

const EMPTY: ProgramSnapshot = {
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

/** Captured slot for removing/reinserting one command. */
interface CommandSlot {
  readonly kind: string;
  readonly draft: CommandDraft;
  readonly prevId: number | null;
  readonly nextId: number | null;
  readonly wasEntry: boolean;
  /** The hidden conversion group when the command is a casting assign. */
  readonly casting?: CastingInfo;
}

function failThrown(snapshot: ProgramSnapshot, e: unknown): ProgramSnapshot {
  return {
    ...clearFailure(snapshot),
    busy: false,
    running: false,
    actionError: e instanceof Error ? e.message : String(e),
  };
}

/**
 * Forget the current failure.
 *
 * The message, the verbatim envelope and the resolved visible target go
 * together: a stale target can never outlive the failure it belonged
 * to. Every new user action starts from here, so a previous run's
 * block is never highlighted while a new one runs.
 */
function clearFailure(snapshot: ProgramSnapshot): ProgramSnapshot {
  return {
    ...snapshot,
    actionError: "",
    error: null,
    errorBlockId: null,
    errorFunctionId: null,
  };
}

/**
 * Record a failure: the human message, the envelope exactly as the
 * bridge sent it, and the visible block it resolves to.
 *
 * The resolution is a **verified** lookup (see `lib/errors.ts`): the
 * engine's id is only a block id when that very node is the one a
 * visible block owns. A failure on a hidden node resolves to nothing,
 * and the UI then shows the failure without pointing at a block.
 */
function withFailure(
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

/**
 * Re-derive the visible target of the current failure against the
 * graph as it is now.
 *
 * A block that was deleted (or replaced by a fresh one) no longer owns
 * the id the engine blamed, so the target disappears with it instead of
 * pointing at a block that is no longer there.
 */
function withResolvedTarget(
  snapshot: ProgramSnapshot,
  commandsByFunction: ProgramSnapshot["commandsByFunction"],
): ProgramSnapshot {
  const target = resolveErrorTarget(
    commandsByFunction,
    internalCommandOf(snapshot.error),
  );
  return {
    ...snapshot,
    errorBlockId: target?.blockId ?? null,
    errorFunctionId: target?.functionId ?? null,
  };
}

function failCommand(snapshot: ProgramSnapshot, raw: unknown): ProgramSnapshot {
  if (typeof raw !== "object" || raw === null || !("status" in raw)) {
    // Not a typed envelope: the message replaces the previous failure
    // completely, so no stale envelope or target survives it.
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
function isUndeclaredError(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || !("status" in raw)) {
    return false;
  }
  const result = raw as { status: string } & Record<string, unknown>;
  if (!isOptilotusError(result)) return false;
  return result.message.includes("declare it first");
}

/**
 * A typed bridge-shaped error for UI-side validation that prevents an
 * invalid Engine write (for example Casting enabled with no target).
 * Engine failures are always passed through verbatim.
 */
function castingValidationError(message: string): OptilotusError {
  return {
    status: "error",
    kind: "PackageError",
    command: null,
    message,
  };
}

/** Best-effort removal of a partially created conversion group. */
function rollbackCastingGroup(
  fid: FunctionId,
  ids: {
    anchorId: number;
    // Hidden casts only: never the visible representative.
    castIds: number[];
    visibleId?: number;
  },
): void {
  const listed = optilotus_listCommands(fid);
  if (!isOptilotusError(listed)) {
    // Detach the group from the chain before deleting it, so a dangling
    // predecessor never remains.
    const predecessor = listed.commands.find(
      (cmd) =>
        cmd.next === ids.anchorId &&
        cmd.id !== ids.anchorId &&
        !ids.castIds.includes(cmd.id) &&
        cmd.id !== ids.visibleId,
    );
    if (predecessor !== undefined) {
      optilotus_setNext(fid, predecessor.id);
    }
    const info = optilotus_getFunction(fid);
    if (!isOptilotusError(info) && info.entry === ids.anchorId) {
      optilotus_setEntry(fid, null);
    }
  }
  if (ids.visibleId !== undefined) {
    optilotus_deleteCommand(fid, ids.visibleId);
  }
  // Hidden casts in reverse creation order: each cast group cascades
  // its hidden compute/cast nodes, and a later delete must never walk
  // into already-removed raw nodes.
  for (const castId of [...ids.castIds].reverse()) {
    optilotus_deleteCommand(fid, castId);
  }
  // After the casts are gone the anchor can still hold a raw pointer
  // into the deleted cast groups. Clearing its user-level successor
  // first detaches that pointer so deleting the anchor cannot leave a
  // dangling edge (same order verified against the real Engine).
  optilotus_setNext(fid, ids.anchorId);
  optilotus_deleteCommand(fid, ids.anchorId);
}

interface CreatedCastingGroup {
  /** Engine id of the visible block (the assign, or the native cast). */
  readonly visibleId: number;
  readonly anchorId: number;
  /** The user's target conversion cast; `=== visibleId` for native groups. */
  readonly castId: number;
}

/**
 * Create the conversion group through the public bridge.
 *
 * **Target equals the destination's declared type** — a hidden
 * single-leg group:
 *
 *     declare anchor
 *     cast temp = <source>    (target: the user's choice)
 *     assign dest = {temp}
 *
 * The Engine's `Set` operation only stores a value whose type equals
 * the destination variable's declared type, and the value the cast
 * produces already has it. The destination is untouched.
 *
 * **Target differs (or the destination is undeclared)** — a converted
 * value cannot live in the destination variable, so the group is the
 * Engine's *native* cast, which both converts and creates its variable:
 *
 *     declare anchor        (name carries the derived out name)
 *     cast <outName> to <target> = <source>   (the visible Cast block)
 *
 * The derived name comes from the assignment's destination and the
 * target tag (`x` cast to `float64` → `x_f64`), suffixed when taken;
 * the destination's declare block and its variable are never rewritten
 * and the converted value is read through the new variable.</think><tool_call>edit<arg_key>newString</arg_key><arg_value> /**
  * Both legs are real `ops::cast_value` conversions: an out-of-range
 * value fails in the Engine at run time with its own error.
 *
 * Validation happens before any write when possible. A write that the
 * Engine still rejects (for example an empty expression) rolls the
 * whole group back and returns the Engine's own typed error.
 */
function createCastingGroup(
  fid: FunctionId,
  draft: Extract<CommandDraft, { kind: "assign" }>,
): { ok: true; group: CreatedCastingGroup } | { ok: false; error: OptilotusError } {
  const setting = draft.casting;
  if (setting?.enabled !== true) {
    return {
      ok: false,
      error: castingValidationError(
        "Casting is not enabled for this assignment.",
      ),
    };
  }
  if (castingIncomplete(setting) || setting.targetType === null) {
    return {
      ok: false,
      error: castingValidationError(
        "Select a target type to complete casting.",
      ),
    };
  }
  const target = setting.targetType;
  const destName = draft.name.trim();
  if (destName === "") {
    return {
      ok: false,
      error: castingValidationError(
        "Enter the destination variable name first.",
      ),
    };
  }
  const listed = optilotus_listCommands(fid);
  if (isOptilotusError(listed)) return { ok: false, error: listed };
  const taken = listed.commands.flatMap((cmd) =>
    cmd.var === undefined ? [] : [cmd.var],
  );

  const destinationType = declaredTypeOf(listed.commands, destName);
  if (destinationType !== undefined && destinationType === target) {
    // Single leg: the conversion result already has the destination's
    // type, so the visible assign stores it directly. The destination
    // declaration is respected, nothing is derived.
    const { anchorName, tempName } = nextCastingNames(taken);

    const anchor = optilotus_declare(fid, anchorName, optilotus_type.int32);
    if (isOptilotusError(anchor)) return { ok: false, error: anchor };

    const cast = optilotus_cast(fid, tempName, target, draft.expr);
    if (isOptilotusError(cast)) {
      rollbackCastingGroup(fid, { anchorId: anchor.id, castIds: [] });
      return { ok: false, error: cast };
    }

    const assign = optilotus_assign(fid, draft.name, `{${tempName}}`);
    if (isOptilotusError(assign)) {
      rollbackCastingGroup(fid, {
        anchorId: anchor.id,
        castIds: [cast.id],
      });
      return { ok: false, error: assign };
    }

    return {
      ok: true,
      group: {
        visibleId: assign.id,
        anchorId: anchor.id,
        castId: cast.id,
      },
    };
  }

  // Native cast shape: the block becomes the Engine's own cast, which
  // converts AND creates the converted variable. The destination needs
  // no validation at all — it is never written by the group.
  const { anchorName, outName } = nextConvertedNames(taken, destName, target);

  const anchor = optilotus_declare(fid, anchorName, optilotus_type.int32);
  if (isOptilotusError(anchor)) return { ok: false, error: anchor };

  const cast = optilotus_cast(fid, outName, target, draft.expr);
  if (isOptilotusError(cast)) {
    rollbackCastingGroup(fid, { anchorId: anchor.id, castIds: [] });
    return { ok: false, error: cast };
  }

  return {
    ok: true,
    group: { visibleId: cast.id, anchorId: anchor.id, castId: cast.id },
  };
}

/**
 * Exhaustiveness guard for `CommandDraft`. A new draft kind must be
 * wired to a bridge call in `runBuilder`; reaching here means one was
 * added without that wiring, so fail loudly instead of creating nothing.
 */
function assertNeverDraft(draft: never): never {
  throw new Error(
    `Unhandled command draft kind: ${String((draft as { kind?: string }).kind)}`,
  );
}

/**
 * Read the function's links and entry straight from the bridge.
 *
 * The links are the **logical** user-level ones: the engine's own
 * `next` edges plus the connections the engine accepted but cannot
 * report (the edge into an `if`). The undo/redo history captures this
 * map, so a rewire into an `if` can be undone like any other.
 *
 * The entry is the **user-visible** one: the engine's entry can point
 * at a hidden node (an `if`'s condition compute), which no block could
 * be named after.
 */
function readLinks(
  fid: FunctionId,
  planned: PlannedLinks,
): {
  links: Map<number, number | null>;
  entry: number | null;
} | null {
  const listed = optilotus_listCommands(fid);
  if (isOptilotusError(listed)) return null;
  const collapsed = collapseCasting(listed.commands);
  const commands = withPlannedLinks(collapsed.commands, planned);
  const info = optilotus_getFunction(fid);
  const rawEntry =
    !isOptilotusError(info) && info.entry !== undefined ? info.entry : null;
  const links = new Map<number, number | null>();
  for (const c of commands) links.set(c.id, c.next ?? null);
  const known = new Set(commands.map((c) => c.id));
  for (const [from, to] of planned) {
    if ((links.get(from) ?? null) !== null) continue;
    if (!known.has(to)) continue;
    links.set(from, to);
  }
  return {
    links,
    entry: resolveCastingEntry(
      (entry) => resolveEntry(commands, entry),
      collapsed.redirects,
      rawEntry,
    ),
  };
}

/**
 * The UI-planned connections of one function: `from` → `to`, where
 * `to` is always an `if`.
 *
 * The engine cannot report the edge into an `if` (its hidden condition
 * compute sits between the two blocks — see `lib/graph.ts`), so the UI
 * remembers the connections it planned and the engine accepted. The
 * overlay is a cache of the UI's own writes: it is filled when a link
 * plan targets an `if`, and it is dropped again when the engine
 * reports the edge itself, when the plan rewires the block, or when
 * one of the two blocks disappears.
 */
type PlannedLinks = ReadonlyMap<number, number>;

/** The overlay of one function (empty when it has no planned links). */
function plannedLinksOf(
  planned: ReadonlyMap<number, PlannedLinks>,
  fid: FunctionId,
): PlannedLinks {
  return planned.get(fid) ?? new Map<number, number>();
}

/**
 * Merge the engine's command summaries with the connections the UI
 * planned and the engine accepted but cannot report.
 *
 * A planned link only fills a gap the engine left open: when the
 * engine reports the successor itself, the engine's value wins and the
 * command is not marked as planned. A planned link whose target is
 * gone is dropped, so a deleted block never keeps a stale connection.
 *
 * Exported for the engine-level integration tests: they must build the
 * same projection the canvas sees (see `load`).
 */
export function withPlannedLinks(
  cmds: readonly CommandSummary[],
  planned: PlannedLinks,
): UiCommand[] {
  if (planned.size === 0) return [...cmds];
  const known = new Set(cmds.map((c) => c.id));
  return cmds.map((c) => {
    const link = planned.get(c.id);
    if (link === undefined) return c;
    if (c.next !== null && c.next !== undefined) return c;
    if (!known.has(link)) return c;
    return { ...c, next: link, planned: true };
  });
}

/**
 * Record the connections of a link plan the engine cannot report.
 *
 * Only the edge *into* an `if` needs remembering: every other
 * successor is the engine's own `next`. A rewired block loses its old
 * planned link, so a plan that moves a block away from an `if` never
 * leaves a stale connection behind.
 */
function recordPlannedLinks(
  planned: Map<number, Map<number, number>>,
  fid: FunctionId,
  plan: LinkPlan,
  cmds: readonly CommandSummary[],
  remap: HistoryIdMap,
): void {
  const links = new Map(planned.get(fid) ?? []);
  const kindOf = new Map(cmds.map((c) => [c.id, c.kind]));
  for (const edit of plan.edits) {
    const id = remap.resolve(edit.id);
    const next = edit.next === null ? null : remap.resolve(edit.next);
    if (next !== null && kindOf.get(next) === "if") {
      links.set(id, next);
    } else {
      links.delete(id);
    }
  }
  if (links.size === 0) {
    planned.delete(fid);
  } else {
    planned.set(fid, links);
  }
}

/** Remember one planned connection (the engine cannot report it). */
function setPlannedLink(
  planned: Map<number, Map<number, number>>,
  fid: FunctionId,
  from: number,
  to: number,
): void {
  const links = planned.get(fid) ?? new Map<number, number>();
  links.set(from, to);
  planned.set(fid, links);
}

/**
 * Drop the planned links of the blocks a plan rewrites.
 *
 * Used when the engine's state cannot be read: an unknown state must
 * not leave a connection behind that the engine may not have.
 */
function forgetPlannedLinks(
  planned: Map<number, Map<number, number>>,
  fid: FunctionId,
  plan: LinkPlan,
  remap: HistoryIdMap,
): void {
  const links = planned.get(fid);
  if (links === undefined) return;
  for (const edit of plan.edits) {
    links.delete(remap.resolve(edit.id));
  }
  if (links.size === 0) planned.delete(fid);
}

/** Drop the planned connection one block had (it left the chain). */
function forgetPlannedLink(
  planned: Map<number, Map<number, number>>,
  fid: FunctionId,
  id: number,
): void {
  const links = planned.get(fid);
  if (links === undefined) return;
  links.delete(id);
  if (links.size === 0) planned.delete(fid);
}

/** The logical successor of one command (the engine's edge, else planned). */
function logicalNextOf(
  cmds: readonly CommandSummary[],
  planned: PlannedLinks,
  id: number,
): number | null {
  const cmd = cmds.find((c) => c.id === id);
  if (cmd === undefined) return null;
  if (cmd.next !== null && cmd.next !== undefined) return cmd.next;
  return planned.get(id) ?? null;
}

/**
 * A restorable draft for one command summary.
 *
 * `CommandSummary.condition` is the **raw `ValueId`** of the `if`'s
 * hidden condition compute — not the user's expression. A draft built
 * from the summary alone would therefore recreate the `if` with a
 * literal number as its condition, and the restored program would fail
 * at run time ("if condition must be bool, got int32"). The engine's own
 * `if_condition` recovers the expression the user wrote, so the undo
 * paths ask for it (the Inspector does the same).
 *
 * A condition the engine cannot report stays empty: the engine rejects
 * an empty condition, so the undo fails honestly instead of restoring a
 * block that would break the program.
 */
function restorableDraft(
  fid: FunctionId,
  cmd: CommandSummary,
): CommandDraft {
  const draft = summaryToDraft(cmd);
  if (draft.kind !== "if") return draft;
  const condition = optilotus_if_condition(fid, cmd.id);
  if (isOptilotusError(condition)) return { ...draft, condition: "" };
  return { ...draft, condition: condition.expr };
}

/** Capture a command's restorable slot from a command list + entry. */
function slotOf(
  fid: FunctionId,
  commands: readonly CommandSummary[],
  entry: number | null,
  id: CommandId,
): CommandSlot | null {
  const cmd = commands.find((c) => c.id === id);
  if (cmd === undefined) return null;
  return {
    kind: cmd.kind,
    draft: restorableDraft(fid, cmd),
    prevId: commands.find((c) => c.next === id)?.id ?? null,
    nextId: cmd.next ?? null,
    wasEntry: entry === id,
    ...(cmd.kind === "assign" &&
    (cmd as CommandSummary & { casting?: CastingInfo }).casting !== undefined
      ? {
          casting: (cmd as CommandSummary & { casting?: CastingInfo })
            .casting,
        }
      : {}),
  };
}

/**
 * Owns the UI projection of the Optilotus package plus the semantic
 * undo history. Optilotus stays authoritative: every mutation goes
 * through the bridge and is followed by a refresh; React keeps
 * selection / layout / transient state only. Undo entries replay
 * inverse bridge operations, so history can never diverge from the
 * runtime into a second source of truth.
 *
 * History discipline (Issues 1–2): stale command ids in undo/redo
 * thunks resolve through one central `HistoryIdMap` (`remapRef`) —
 * never per-component ad-hoc logic. Undo/redo are transactional: an
 * entry moves stacks only when its thunk returns `true`. On partial
 * failure the thunk refreshes from the runtime (the source of truth),
 * keeps a persistent actionable error, and reports `false` so the
 * entry stays put and the next undo/redo remains predictable.
 */
export function useProgram(
  active: boolean,
  issueSeq: () => number,
): {
  snapshot: ProgramSnapshot;
  selectFunction: (id: FunctionId | null) => void;
  selectCommand: (id: CommandId | null) => void;
  refresh: () => void;
  createFunction: (name: string) => void;
  renameFunction: (id: FunctionId, name: string) => void;
  deleteFunction: (id: FunctionId) => void;
  addCommand: (fid: FunctionId, draft: CommandDraft) => void;
  declareVariable: (fid: FunctionId, name: string) => void;
  replaceCommand: (
    fid: FunctionId,
    oldId: CommandId,
    draft: CommandDraft,
  ) => void;
  deleteCommand: (fid: FunctionId, cmd: CommandId) => void;
  applyLinks: (fid: FunctionId, plan: LinkPlan) => void;
  /**
   * Append an existing block to an `if` branch (then/else port wiring).
   * The engine owns branch membership; undo rewires the `next` edges
   * captured before/after but branch membership itself stays — the
   * engine exposes no branch-list reverse operation yet.
   */
  applyIfAppend: (
    fid: FunctionId,
    ifId: CommandId,
    branch: "then" | "else",
    targetId: CommandId,
  ) => boolean;
  /** The expression an `if`'s condition was built from (null on error). */
  ifConditionText: (fid: FunctionId, ifId: CommandId) => string | null;
  clearEntry: (fid: FunctionId) => void;
  clearPackage: () => void;
  run: () => void;
  clearRun: () => void;
  dismissError: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undoSeq: number | null;
  redoSeq: number | null;
  undo: () => void;
  redo: () => void;
} {
  const [snapshot, setSnapshot] = useState<ProgramSnapshot>(EMPTY);
  const pastRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  /** Central id remapper (Issue 1): old id → live replacement id. */
  const remapRef = useRef<HistoryIdMap>(new HistoryIdMap());

  interface HistTops {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    undoSeq: number | null;
    redoSeq: number | null;
  }

  const [tops, setTops] = useState<HistTops>({
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    undoSeq: null,
    redoSeq: null,
  });

  /** Derive button state from the stacks (render reads state, not refs). */
  const syncTops = useCallback((): void => {
    const past = pastRef.current;
    const future = futureRef.current;
    setTops({
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoLabel:
        past.length > 0 ? (past[past.length - 1]?.label ?? null) : null,
      redoLabel:
        future.length > 0 ? (future[future.length - 1]?.label ?? null) : null,
      undoSeq:
        past.length > 0 ? (past[past.length - 1]?.seq ?? null) : null,
      redoSeq:
        future.length > 0 ? (future[future.length - 1]?.seq ?? null) : null,
    });
  }, []);
  const selectedIdRef = useRef<FunctionId | null>(null);

  /**
   * The connections the UI planned and the engine accepted but cannot
   * report, per function (`from` → the `if` it leads to). See
   * {@link PlannedLinks}.
   */
  const plannedRef = useRef<Map<number, Map<number, number>>>(new Map());

  useEffect(() => {
    selectedIdRef.current = snapshot.selectedId;
  }, [snapshot.selectedId]);

  /**
   * Refresh the projection from the runtime. Never clears `actionError`:
   * loading state and error state are separate (Issue 3) — a reload must
   * not erase an unrelated failure. Errors clear only on an explicit
   * new user action (mutating thunks set `busy` with a cleared error at
   * their start), a successful retry, or `dismissError`.
   */
  const load = useCallback(
    (selectedId: FunctionId | null): void => {
      try {
        const listed = optilotus_listFunctions();
        const functions = listed.functions;
        const nextSelected =
          selectedId !== null &&
          functions.some((f) => f.id === selectedId)
            ? selectedId
            : (functions[0]?.id ?? null);
        let selected: ProgramSnapshot["selected"] = null;
        let commands: readonly UiCommand[] = [];
        let entry: number | null = null;
        const commandsByFunction: Record<number, readonly UiCommand[]> = {};
        for (const fn of functions) {
          const cmds = optilotus_listCommands(fn.id);
          if (!isOptilotusError(cmds)) {
            commandsByFunction[fn.id] = withPlannedLinks(
              collapseCasting(cmds.commands).commands,
              plannedLinksOf(plannedRef.current, fn.id),
            );
          } else {
            commandsByFunction[fn.id] = [];
          }
        }
        if (nextSelected !== null) {
          const info = optilotus_getFunction(nextSelected);
          const listed = optilotus_listCommands(nextSelected);
          if (!isOptilotusError(info) && !isOptilotusError(listed)) {
            const collapsed = collapseCasting(listed.commands);
            commands = [...(commandsByFunction[nextSelected] ?? [])];
            // The engine's entry can point at a hidden node (an `if`'s
            // condition compute, or a conversion group's anchor):
            // resolve it to the block the chain really starts at.
            entry = resolveCastingEntry(
              (raw) => resolveEntry(commands, raw),
              collapsed.redirects,
              info.entry ?? null,
            );
            // `command_count` counts hidden Engine commands; the
            // inspector shows the user-visible blocks.
            selected = { ...info, commandCount: commands.length };
          }
        }
        setSnapshot((prev) =>
          withResolvedTarget(
            {
              ...prev,
              functions,
              selectedId: nextSelected,
              selected,
              entry,
              commands,
              commandsByFunction,
              selectedCommandId:
                prev.selectedCommandId !== null &&
                commands.some((c) => c.id === prev.selectedCommandId)
                  ? prev.selectedCommandId
                  : null,
              busy: false,
              // Output always describes the current program: any
              // refresh invalidates the previous run result (its
              // command ids may be gone after the next mutation).
              run: null,
              durationMs: null,
            },
            commandsByFunction,
          ),
        );
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setSnapshot((prev) => ({
          ...prev,
          busy: false,
          actionError: message,
        }));
      }
    },
    [],
  );

  // Initial projection once the runtime is ready. The ready signal
  // arrives over an async boundary (post-WASM-init), so the projection
  // load is chained on a microtask: synchronization with the external
  // runtime system, with effective cancellation if readiness is revoked
  // or the component unmounts before the handshake lands. Loading twice
  // is harmless (idempotent).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) load(null);
    });
    return () => {
      cancelled = true;
    };
  }, [active, load]);

  const refresh = useCallback((): void => {
    load(snapshot.selectedId);
  }, [load, snapshot.selectedId]);

  const selectFunction = useCallback(
    (id: FunctionId | null): void => {
      setSnapshot((prev) => ({
        ...prev,
        selectedCommandId: null,
        run: null,
      }));
      load(id);
    },
    [load],
  );

  const selectCommand = useCallback((id: CommandId | null): void => {
    setSnapshot((prev) => ({ ...prev, selectedCommandId: id }));
  }, []);

  /** Record a completed action; new actions clear the redo stack. */
  const pushHistory = useCallback(
    (entry: Omit<HistoryEntry, "seq">): void => {
      pastRef.current.push({ ...entry, seq: issueSeq() });
      futureRef.current = [];
      syncTops();
    },
    [issueSeq, syncTops],
  );

  const runBuilder = useCallback(
    (fid: FunctionId, draft: CommandDraft) => {
      switch (draft.kind) {
        case "declare": {
          // `init` is optional per the bridge/runtime (Issue 7): an empty
          // editor field means "omitted" (engine default), never a
          // fabricated zero. `normalizeDeclareInit` unwraps the way users
          // naturally write literals (`"hi"`, `'a'`, `True`, `2` for a
          // float) before the engine validates.
          const normalized = normalizeDeclareInit(draft.ty, draft.init);
          return optilotus_declareWithAccess(
            fid,
            draft.name,
            draft.ty,
            draft.access ?? "private",
            normalized === "" ? undefined : normalized,
          );
        }
        case "assign":
          return optilotus_assign(fid, draft.name, draft.expr);
        case "print":
          return optilotus_print(fid, draft.template);
        case "input":
          return optilotus_input(fid, draft.ty);
        case "cast":
          return optilotus_cast(fid, draft.name, draft.to, draft.expr);
        case "return":
          return optilotus_return(fid, draft.expr);
        case "if":
          return optilotus_if(
            fid,
            draft.condition,
            [...draft.then],
            draft.else === null ? null : [...draft.else],
          );
        default:
          // Exhaustiveness: a new draft kind must be wired to a bridge
          // call here, not silently create nothing.
          return assertNeverDraft(draft);
      }
    },
    [],
  );

  /**
   * Low-level create that leaves the node detached (undoes the runtime
   * tail-append link). Bridge only; caller refreshes. History-free.
   *
   * Detached semantics (Issue 5): when the entry was `null` before the
   * call, `append_raw` in the engine assigns the new head as entry. A
   * detached creation must not establish an entry point, so the entry
   * is restored to `null` in that case. Appends through every other
   * path keep engine behavior unchanged.
   */
  const createDetached = useCallback(
    (fid: FunctionId, draft: CommandDraft): number | null => {
      const info = optilotus_getFunction(fid);
      const entryBefore =
        !isOptilotusError(info) && info.entry !== undefined
          ? (info.entry ?? null)
          : null;
      if (draft.kind === "assign" && draft.casting?.enabled === true) {
        const created = createCastingGroup(fid, draft);
        if (!created.ok) {
          setSnapshot((prev) =>
            failCommand(
              {
                ...prev,
                recoveryVar: isUndeclaredError(created.error)
                  ? draft.name
                  : prev.recoveryVar,
              },
              created.error,
            ),
          );
          return null;
        }
        const { visibleId, anchorId } = created.group;
        const after = optilotus_listCommands(fid);
        if (!isOptilotusError(after)) {
          // Detach the conversion group from the runtime tail. The
          // anchor is the user-level head, so clearing its predecessor
          // removes the whole group from the chain in one edit.
          const pred = after.commands.find((c) => c.next === anchorId);
          if (pred !== undefined) {
            const cleared = optilotus_setNext(fid, pred.id);
            if (isOptilotusError(cleared)) {
              rollbackCastingGroup(fid, {
                anchorId,
                castIds:
                  created.group.castId !== created.group.visibleId
                    ? [created.group.castId]
                    : [],
                visibleId,
              });
              setSnapshot((prev) => failCommand(prev, cleared));
              return null;
            }
          }
        }
        if (entryBefore === null) {
          const now = optilotus_getFunction(fid);
          const entryNow =
            !isOptilotusError(now) && now.entry !== undefined
              ? (now.entry ?? null)
              : null;
          if (entryNow !== null) {
            const restored = optilotus_setEntry(fid, null);
            if (isOptilotusError(restored)) {
              setSnapshot((prev) => failCommand(prev, restored));
              return null;
            }
          }
        }
        return visibleId;
      }
      const created = runBuilder(fid, draft);
      if (isOptilotusError(created)) {
        setSnapshot((prev) =>
          failCommand(
            {
              ...prev,
              recoveryVar:
                draft.kind === "assign" && isUndeclaredError(created)
                  ? draft.name
                  : prev.recoveryVar,
            },
            created,
          ),
        );
        return null;
      }
      const after = optilotus_listCommands(fid);
      if (!isOptilotusError(after)) {
        const pred = after.commands.find((c) => c.next === created.id);
        if (pred !== undefined) {
          const cleared = optilotus_setNext(fid, pred.id);
          if (isOptilotusError(cleared)) {
            setSnapshot((prev) => failCommand(prev, cleared));
            return null;
          }
        }
      }
      if (entryBefore === null) {
        const now = optilotus_getFunction(fid);
        const entryNow =
          !isOptilotusError(now) && now.entry !== undefined
            ? (now.entry ?? null)
            : null;
        if (entryNow !== null) {
          const restored = optilotus_setEntry(fid, null);
          if (isOptilotusError(restored)) {
            setSnapshot((prev) => failCommand(prev, restored));
            return null;
          }
        }
      }
      return created.id;
    },
    [runBuilder],
  );

  /** Low-level delete. Bridge only; caller refreshes. History-free. */
  const bridgeDelete = useCallback(
    (fid: FunctionId, id: CommandId): boolean => {
      const removed = optilotus_deleteCommand(fid, id);
      if (isOptilotusError(removed)) {
        setSnapshot((prev) => failCommand(prev, removed));
        return false;
      }
      return true;
    },
    [],
  );

  /**
   * Re-splice an `if`'s hidden condition compute.
   *
   * The engine keeps an `if`'s condition in a hidden compute command
   * that has to run *immediately before* the `if`. That compute is not
   * a user command, so the bridge's user-level `next` edges cannot see
   * it: linking a block to an `if` overwrites the edge that reached the
   * compute and leaves the condition dangling — the run then fails with
   * `MissingValue` ("missing value N at M").
   *
   * `if_set_condition` is the engine's own repair primitive: it rebuilds
   * the compute and re-points the `if`'s predecessors — and the entry,
   * when the `if` is the chain head — at the new compute. Calling it
   * with the condition the engine already holds keeps the expression
   * exactly as the user wrote it.
   *
   * **Why it stays (audit F-1).** The repair is not a workaround the
   * UI could drop: `if_set_condition` is the *only* bridge operation
   * that can put the hidden compute back in front of its `if` — the
   * compute has no user-level id, so `set_next` cannot address it.
   * Removing the repair would make every rewire into an `if` fail at
   * run time. Its cost is that the repair also hides the connection
   * from the engine's summary (the compute sits between the two
   * blocks), which the UI compensates for by remembering the
   * connections it planned (see {@link PlannedLinks}). The engine
   * change that would remove the need for both is `Package::user_next`
   * skipping hidden nodes — or `Package::set_next` being `if`-aware.
   *
   * Returns false when the bridge rejected the repair (the error is
   * surfaced by the caller).
   */
  const repairIfCondition = useCallback(
    (fid: FunctionId, ifId: CommandId): boolean => {
      const condition = optilotus_if_condition(fid, ifId);
      // No condition to repair (the command is not an `if`, or the
      // engine cannot recover the expression): nothing to do.
      if (isOptilotusError(condition)) return true;
      const repaired = optilotus_if_set_condition(fid, ifId, condition.expr);
      if (isOptilotusError(repaired)) {
        setSnapshot((prev) => failCommand(prev, repaired));
        return false;
      }
      return true;
    },
    [],
  );

  /**
   * Low-level link plan application. Bridge only; caller refreshes.
   * History-free (used by recording actions and by undo/redo thunks).
   * Ids resolve through the central remapper; unknown ids fail honestly
   * (the runtime rejects them and the error surfaces) — callers that
   * tolerate dead ids (e.g. `restoreLinks`) filter them beforehand.
   *
   * A plan that links a block to an `if` also repairs that `if`'s
   * condition compute (see `repairIfCondition`), so the block really
   * runs the branch instead of failing on a dangling condition. The
   * repair hides the connection from the engine's summary, so the plan
   * is remembered as a *planned link* (see {@link PlannedLinks}).
   */
  const runLinkPlan = useCallback(
    (fid: FunctionId, plan: LinkPlan): boolean => {
      const remap = remapRef.current;
      // Translation to hidden conversion heads. An edit that *targets* a
      // visible casting assign must point at its anchor; outgoing edits
      // keep using the visible assign (the anchor -> cast -> assign
      // group executes as a unit). Read before applying the plan so a
      // freshly created group is already known.
      const before = optilotus_listCommands(fid);
      const castings = isOptilotusError(before)
        ? new Map<number, CastingInfo>()
        : collapseCasting(before.commands).castings;
      const targetId = (id: number): number =>
        castings.get(id)?.anchorId ?? id;
      const linked = new Set<number>();
      for (const edit of plan.edits) {
        const id = remap.resolve(edit.id);
        const next =
          edit.next === null ? null : targetId(remap.resolve(edit.next));
        const link =
          next === null
            ? optilotus_setNext(fid, id)
            : optilotus_setNext(fid, id, next);
        if (isOptilotusError(link)) {
          setSnapshot((prev) => failCommand(prev, link));
          return false;
        }
        if (next !== null) linked.add(next);
      }
      if (plan.entry.type === "set") {
        const entry =
          plan.entry.entry === null
            ? null
            : targetId(remap.resolve(plan.entry.entry));
        const updated =
          entry === null
            ? optilotus_setEntry(fid, null)
            : optilotus_setEntry(fid, entry);
        if (isOptilotusError(updated)) {
          setSnapshot((prev) => failCommand(prev, updated));
          return false;
        }
        if (entry !== null) linked.add(entry);
      }
      const listed = optilotus_listCommands(fid);
      if (isOptilotusError(listed)) {
        // The engine's state is unknown: drop the planned links of the
        // rewritten blocks rather than keep a stale connection.
        forgetPlannedLinks(plannedRef.current, fid, plan, remap);
        return true;
      }
      for (const cmd of listed.commands) {
        if (cmd.kind !== "if") continue;
        if (!linked.has(cmd.id)) continue;
        if (!repairIfCondition(fid, cmd.id)) return false;
      }
      // The repair hides the edge into an `if` from the engine's
      // summary: remember it, so the canvas and the connection notice
      // show the connection the runtime really has. A plan that
      // rewires a block drops its old planned link, so a rewired
      // block never keeps a connection the engine no longer has.
      recordPlannedLinks(
        plannedRef.current,
        fid,
        plan,
        listed.commands,
        remap,
      );
      return true;
    },
    [repairIfCondition],
  );

  /** Exact link-map restore (reorder undo/redo, function restore). */
  const restoreLinks = useCallback(
    (
      fid: FunctionId,
      links: ReadonlyMap<number, number | null>,
      entry: number | null,
      keepEntry: boolean,
    ): boolean => {
      const listed = optilotus_listCommands(fid);
      if (isOptilotusError(listed)) {
        setSnapshot((prev) => failCommand(prev, listed));
        return false;
      }
      const remap = remapRef.current;
      const live = new Set(listed.commands.map((c) => c.id));
      const edits: { id: number; next: number | null }[] = [];
      for (const [id, next] of links) {
        const liveId = remap.resolve(id);
        if (!live.has(liveId)) continue;
        const liveNext = next === null ? null : remap.resolve(next);
        if (liveNext !== null && !live.has(liveNext)) continue;
        edits.push({ id: liveId, next: liveNext });
      }
      const liveEntry = entry === null ? null : remap.resolve(entry);
      return runLinkPlan(fid, {
        edits,
        entry: keepEntry
          ? { type: "keep" }
          : {
              type: "set",
              entry: liveEntry !== null && !live.has(liveEntry) ? null : liveEntry,
            },
      });
    },
    [runLinkPlan],
  );

  /**
   * Insert a draft into a captured slot. History-free. Stale slot ids
   * resolve through the central remapper; when `restoresId` names the
   * deleted command being restored, the fresh id is tracked so later
   * history entries referencing the old id keep working (Issue 1).
   */
  const insertSlot = useCallback(
    (
      fid: FunctionId,
      draft: CommandDraft,
      slot: { prevId: number | null; nextId: number | null; makeEntry: boolean },
      restoresId?: number,
    ): number | null => {
      const remap = remapRef.current;
      const nid = createDetached(fid, draft);
      if (nid === null) return null;
      if (restoresId !== undefined) remap.track(restoresId, nid);
      const prevId = slot.prevId === null ? null : remap.resolve(slot.prevId);
      const nextId = slot.nextId === null ? null : remap.resolve(slot.nextId);
      const edits: { id: number; next: number | null }[] = [];
      if (prevId !== null) edits.push({ id: prevId, next: nid });
      edits.push({ id: nid, next: nextId });
      if (
        !runLinkPlan(fid, {
          edits,
          entry: slot.makeEntry
            ? { type: "set", entry: nid }
            : { type: "keep" },
        })
      ) {
        return null;
      }
      return nid;
    },
    [createDetached, runLinkPlan],
  );

  /**
   * Delete one visible command, including a hidden conversion group.
   *
   * The chain is rewired around the block first (predecessor and/or
   * entry), so deleting the internal group cannot leave a dangling raw
   * edge. Then the visible assign, its cast and its anchor are removed
   * in that order — the same order undo replays in reverse. After the
   * cast is gone, the anchor's user-level successor is cleared before
   * the anchor itself is deleted, detaching the stale pointer into the
   * removed cast group.
   */
  const deleteVisibleCommand = useCallback(
    (fid: FunctionId, id: CommandId): boolean => {
      const listed = optilotus_listCommands(fid);
      const casting = isOptilotusError(listed)
        ? undefined
        : collapseCasting(listed.commands).castings.get(id);
      if (casting === undefined) return bridgeDelete(fid, id);
      const links = readLinks(
        fid,
        plannedLinksOf(plannedRef.current, fid),
      );
      if (links !== null) {
        const next = links.links.get(id) ?? null;
        let prev: number | null = null;
        for (const [from, to] of links.links) {
          if (to === id) {
            prev = from;
            break;
          }
        }
        if (prev !== null) {
          if (
            !runLinkPlan(fid, {
              edits: [{ id: prev, next }],
              entry: { type: "keep" },
            })
          ) {
            return false;
          }
        } else if (links.entry === id) {
          if (
            !runLinkPlan(fid, {
              edits: [],
              entry: { type: "set", entry: next },
            })
          ) {
            return false;
          }
        }
      }
      if (!bridgeDelete(fid, id)) return false;
      // For the hidden single-leg shape the target cast still sits
      // behind the assign (its group cascades on delete). For the
      // native-cast shape the visible block IS the cast row, so this
      // second delete must not repeat it.
      if (casting.castId !== id && !bridgeDelete(fid, casting.castId)) {
        return false;
      }
      const cleared = optilotus_setNext(fid, casting.anchorId);
      if (isOptilotusError(cleared)) {
        setSnapshot((prev) => failCommand(prev, cleared));
        return false;
      }
      return bridgeDelete(fid, casting.anchorId);
    },
    [runLinkPlan, bridgeDelete],
  );

  const createFunction = useCallback(
    (name: string): void => {
      try {
        const trimmed = name.trim();
        if (trimmed === "") return;
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        const created = optilotus_createFunction(trimmed);
        if (isOptilotusError(created)) {
          setSnapshot((prev) => failCommand(prev, created));
          return;
        }
        const box = { id: created.id };
        load(created.id);
        pushHistory({
          label: `Create function ${trimmed}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const gone = optilotus_deleteFunction(box.id);
            if (isOptilotusError(gone)) {
              setSnapshot((prev) => failCommand(prev, gone));
              load(selectedIdRef.current);
              return false;
            }
            load(selectedIdRef.current);
            return true;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const again = optilotus_createFunction(trimmed);
            if (isOptilotusError(again)) {
              setSnapshot((prev) => failCommand(prev, again));
              load(selectedIdRef.current);
              return false;
            }
            box.id = again.id;
            load(again.id);
            return true;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [load, pushHistory],
  );

  const deleteFunction = useCallback(
    (id: FunctionId): void => {
      try {
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        const info = optilotus_getFunction(id);
        if (isOptilotusError(info)) {
          setSnapshot((prev) => failCommand(prev, info));
          return;
        }
        const cmds = optilotus_listCommands(id);
        // Back up the **visible** commands: a casting assignment's
        // hidden anchor/cast must not be recreated as standalone blocks.
        // Its projected summary carries the casting choice, so undo
        // rebuilds a fresh valid conversion group through `createDetached`.
        const items: { draft: CommandDraft }[] = isOptilotusError(cmds)
          ? []
          : collapseCasting(cmds.commands).commands.map((c) => ({
              draft: restorableDraft(id, c),
            }));
        const linksBefore = readLinks(
          id,
          plannedLinksOf(plannedRef.current, id),
        );
        const name = info.name;
        const deleted = optilotus_deleteFunction(id);
        if (isOptilotusError(deleted)) {
          setSnapshot((prev) => failCommand(prev, deleted));
          return;
        }
        // The deleted function's planned connections are gone with it.
        plannedRef.current.delete(id);
        const box = { id };
        setSnapshot((prev) => ({ ...prev, selectedCommandId: null }));
        load(snapshot.selectedId === id ? null : snapshot.selectedId);
        pushHistory({
          label: `Delete function ${name}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const again = optilotus_createFunction(name);
            if (isOptilotusError(again)) {
              setSnapshot((prev) => failCommand(prev, again));
              load(selectedIdRef.current);
              return false;
            }
            box.id = again.id;
            if (linksBefore !== null) {
              const remap = remapRef.current;
              const createdIds: number[] = [];
              for (const item of items) {
                const nid = createDetached(again.id, item.draft);
                if (nid === null) break;
                createdIds.push(nid);
              }
              const oldIds = [...linksBefore.links.keys()];
              const local = new Map<number, number>();
              oldIds.forEach((old, i) => {
                const nid = createdIds[i];
                if (nid !== undefined) {
                  local.set(old, nid);
                  remap.track(old, nid);
                }
              });
              const edits: { id: number; next: number | null }[] = [];
              for (const [old, next] of linksBefore.links) {
                const nid = local.get(old);
                if (nid === undefined) continue;
                edits.push({
                  id: nid,
                  next: next === null ? null : (local.get(next) ?? null),
                });
              }
              const oldEntry = linksBefore.entry;
              runLinkPlan(again.id, {
                edits,
                entry:
                  oldEntry === null
                    ? { type: "keep" as const }
                    : {
                        type: "set" as const,
                        entry: local.get(oldEntry) ?? null,
                      },
              });
            }
            load(again.id);
            return true;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const gone = optilotus_deleteFunction(box.id);
            if (isOptilotusError(gone)) {
              setSnapshot((prev) => failCommand(prev, gone));
              load(selectedIdRef.current);
              return false;
            }
            load(selectedIdRef.current);
            return true;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [
      load,
      pushHistory,
      snapshot.selectedId,
      createDetached,
      runLinkPlan,
    ],
  );

  /**
   * Rename a function in place (stable id, history-backed). The bridge
   * rejects empty names, `{}"` chars, `"main"` for helpers, and
   * duplicates; failures surface without recording history.
   */
  const renameFunction = useCallback(
    (id: FunctionId, name: string): void => {
      try {
        const trimmed = name.trim();
        if (trimmed === "") return;
        const info = optilotus_getFunction(id);
        if (isOptilotusError(info)) {
          setSnapshot((prev) => failCommand(prev, info));
          return;
        }
        if (info.name === trimmed) return;
        const oldName = info.name;
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        const renamed = optilotus_renameFunction(id, trimmed);
        if (isOptilotusError(renamed)) {
          setSnapshot((prev) => failCommand(prev, renamed));
          return;
        }
        load(id);
        pushHistory({
          label: `Rename function to ${trimmed}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const back = optilotus_renameFunction(id, oldName);
            if (isOptilotusError(back)) {
              setSnapshot((prev) => failCommand(prev, back));
              load(selectedIdRef.current);
              return false;
            }
            load(selectedIdRef.current);
            return true;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const again = optilotus_renameFunction(id, trimmed);
            if (isOptilotusError(again)) {
              setSnapshot((prev) => failCommand(prev, again));
              load(selectedIdRef.current);
              return false;
            }
            load(id);
            return true;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [load, pushHistory],
  );

  const addCommand = useCallback(
    (fid: FunctionId, draft: CommandDraft): void => {
      try {
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        // The chain tail before the new block. An `if` is appended
        // behind the engine's hidden condition compute, so the block
        // before it stays its visible predecessor — a connection the
        // engine cannot report, and the UI therefore remembers.
        const before = optilotus_listCommands(fid);
        const beforeInfo = optilotus_getFunction(fid);
        const beforeEntry =
          !isOptilotusError(beforeInfo) && beforeInfo.entry !== undefined
            ? beforeInfo.entry
            : null;
        const tail = isOptilotusError(before)
          ? null
          : chainTailOf(
              withPlannedLinks(
                before.commands,
                plannedLinksOf(plannedRef.current, fid),
              ),
              resolveEntry(before.commands, beforeEntry),
            );
        const createdId = createDetached(fid, draft);
        if (createdId === null) {
          // Validation failed: nothing was created, the error (plus a
          // recovery hint for undeclared variables) stays visible and
          // no history entry is recorded. The user's draft is NOT
          // deleted — it never left the caller's editor.
          load(fid);
          return;
        }
        if (draft.kind === "if" && tail !== null) {
          setPlannedLink(plannedRef.current, fid, tail, createdId);
        }
        const box = { id: createdId };
        load(fid);
        setSnapshot((prev) => ({ ...prev, selectedCommandId: box.id }));
        pushHistory({
          label: `Add ${draft.kind}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const ok = deleteVisibleCommand(
              fid,
              remapRef.current.resolve(box.id),
            );
            load(fid);
            return ok;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const nid = createDetached(fid, draft);
            if (nid === null) {
              load(fid);
              return false;
            }
            remapRef.current.track(box.id, nid);
            box.id = nid;
            load(fid);
            setSnapshot((prev) => ({ ...prev, selectedCommandId: nid }));
            return true;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [load, createDetached, deleteVisibleCommand, pushHistory],
  );

  /**
   * Non-destructive recovery for failed assigns (Issue 6): declare the
   * missing variable with the default `int32` type and no initializer
   * (engine default), then keep the user's attempted assign draft
   * untouched so they can retry it. Never deletes or invents semantics
   * beyond what the bridge validates.
   */
  const declareVariable = useCallback(
    (fid: FunctionId, name: string): void => {
      try {
        const trimmed = name.trim();
        if (trimmed === "") return;
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        const created = optilotus_declare(
          fid,
          trimmed,
          optilotus_type.int32,
        );
        if (isOptilotusError(created)) {
          setSnapshot((prev) => failCommand(prev, created));
          load(fid);
          return;
        }
        const box = { id: created.id };
        load(fid);
        setSnapshot((prev) => ({ ...prev, selectedCommandId: box.id }));
        pushHistory({
          label: `Declare ${trimmed}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const ok = deleteVisibleCommand(
              fid,
              remapRef.current.resolve(box.id),
            );
            load(fid);
            return ok;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const again = optilotus_declare(
              fid,
              trimmed,
              optilotus_type.int32,
            );
            if (isOptilotusError(again)) {
              setSnapshot((prev) => failCommand(prev, again));
              load(fid);
              return false;
            }
            remapRef.current.track(box.id, again.id);
            box.id = again.id;
            load(fid);
            return true;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [load, deleteVisibleCommand, pushHistory],
  );

  /**
   * Append a block into an `if` branch: the engine's `if_append` (which
   * moves the block's whole raw group out of wherever it chained, wires
   * the branch tail to its head and ends its chain at the join) plus the
   * two UI-level healers composition needs:
   *
   * - a planned connection the mover had is forgotten (the block leaves
   *   the main chain), and
   * - the `if`'s hidden condition compute is re-spliced ahead of the
   *   `if` (`Package::if_append` detaching the appended group can steal
   *   it when the member was chained straight into the `if`) — see the
   *   in-body comment.
   *
   * `record` set to `false` performs the same engine mutations without
   * pushing a history entry. Callers that own the history record (block
   * replacement inside a branch, whose undo/redo reproduce the append)
   * use it so the undo stack stays one entry per user action.
   */
  const appendIntoBranch = useCallback(
    (
      fid: FunctionId,
      ifId: CommandId,
      branch: "then" | "else",
      targetId: CommandId,
      record = true,
    ): boolean => {
      try {
        const before = readLinks(
          fid,
          plannedLinksOf(plannedRef.current, fid),
        );
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        // A casting assignment is a hidden group behind one visible
        // block: `anchor -> cast -> [assign]` (the assign is absent for
        // the native-cast shape, whose visible block IS the cast row).
        // The engine appends one user-level command at a time, so the
        // whole group — in creation order, without repeating the
        // visible cast — moves into the branch.
        const listed = optilotus_listCommands(fid);
        const casting = isOptilotusError(listed)
          ? undefined
          : collapseCasting(listed.commands).castings.get(targetId);
        const appendIds =
          casting === undefined
            ? [targetId]
            : casting.castId === targetId
              ? [casting.anchorId, targetId]
              : [casting.anchorId, casting.castId, targetId];
        // A member the main chain wired into this `if` (a repaired edge,
        // since every connection into an `if` is spliced — see
        // `runLinkPlan`) drags the `if`'s fresh condition compute into
        // the branch body when `if_append` extends the member's raw
        // group. The main chain then reaches the `if` without a computed
        // condition and the run fails with `MissingValue` — the same
        // theft the engine already caused when the compute mirrored the
        // chain path. This is engine-owned composition (`raw_group` has
        // no user-level counterpart); the UI heals it with the engine's
        // own repair primitive after the appends: a fresh compute is
        // spliced ahead of the `if` again, and the stale copy inside the
        // branch body runs harmlessly (the body walk stops when `next`
        // leaves branch membership — never an Engine change).
        const entryWasMember = before?.entry === targetId;
        for (const appendId of appendIds) {
          const result = optilotus_if_append(fid, ifId, branch, appendId);
          if (isOptilotusError(result)) {
            setSnapshot((prev) => failCommand(prev, result));
            load(fid);
            return false;
          }
        }
        // The appended block leaves the main chain (the engine runs it
        // from the `if` now): a planned connection it had is gone with
        // it.
        forgetPlannedLink(plannedRef.current, fid, targetId);
        if (entryWasMember) {
          // The entry was the appended member, so the engine's entry now
          // points inside a stolen group. Move it to the `if` first; the
          // repair below re-points the entry itself at the fresh compute
          // (engine behavior of `if_set_condition`, mirrored by
          // `resolveEntry`). Ordering matters: repairing first would
          // strand the entry inside the branch body.
          const moved = optilotus_setEntry(fid, ifId);
          if (isOptilotusError(moved)) {
            setSnapshot((prev) => failCommand(prev, moved));
            load(fid);
            return false;
          }
        }
        // Healer: the fresh compute returns ahead of the `if`. Runs once
        // per append; for an unplanned member it is a no-op refresh, the
        // engine re-splicing what it already holds.
        if (!repairIfCondition(fid, ifId)) {
          load(fid);
          return false;
        }
        const after = readLinks(
          fid,
          plannedLinksOf(plannedRef.current, fid),
        );
        load(fid);
        if (record && before !== null && after !== null) {
          const beforeLinks = before.links;
          const beforeEntry = before.entry;
          const afterLinks = after.links;
          const afterEntry = after.entry;
          pushHistory({
            label: "Wire if branch",
            undo: () => {
              setSnapshot((prev) => ({ ...prev, busy: true }));
              const ok = restoreLinks(fid, beforeLinks, beforeEntry, false);
              load(fid);
              return ok;
            },
            redo: () => {
              setSnapshot((prev) => ({ ...prev, busy: true }));
              const ok = restoreLinks(fid, afterLinks, afterEntry, false);
              load(fid);
              return ok;
            },
          });
        }
        return true;
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
        return false;
      }
    },
    [load, pushHistory, restoreLinks, repairIfCondition],
  );

  const replaceCommand = useCallback(
    (fid: FunctionId, oldId: CommandId, draft: CommandDraft): void => {
      try {
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        // A `cast` Apply must never go through delete + recreate: the
        // Engine's cast group is `Compute -> Cast -> Set`, whose
        // execution head is the *hidden* `Compute` (the bridge reports
        // only the final `Set` as the user-facing id). The delete tears
        // the old group down completely, and a rebuild splices the
        // user-level edge at the `Set` — the new group then runs with no
        // inbound path to its own `Compute`, so the run dies with
        // `MissingValue` (the `Set` reads a value nobody produced). The
        // bridge offers no primitive that can re-splice a hidden compute
        // of a general group (`if_set_condition` is `if`-specific), so
        // the honest UI move is to refuse the edit and keep the block
        // verbatim; conversions should be rebuilt instead through an
        // assignment with casting (whose anchor head the links can
        // address).
        if (draft.kind === "cast") {
          setSnapshot((prev) => ({
            ...prev,
            busy: false,
            actionError:
              "Engine casts cannot be edited in place: the hidden conversion compute the block runs from has no user-level id the editor can re-link. Delete the block and add an assignment with casting instead (the public conversion flow).",
          }));
          return;
        }
        // An `if` Apply must never go through delete + recreate: the
        // branch bodies hold raw command ids a reconstruction cannot
        // preserve, so editing rewrites only the condition expression in
        // place (the engine keeps branches and linkage as they are).
        if (draft.kind === "if") {
          const previous = optilotus_if_condition(fid, oldId);
          if (isOptilotusError(previous)) {
            setSnapshot((prev) => failCommand(prev, previous));
            return;
          }
          // No-op Apply: the trimmed condition text matches.
          const expr = draft.condition.trim();
          if (expr === previous.expr.trim()) {
            setSnapshot((prev) => ({ ...prev, busy: false }));
            return;
          }
          const applied = optilotus_if_set_condition(fid, oldId, expr);
          if (isOptilotusError(applied)) {
            setSnapshot((prev) => failCommand(prev, applied));
            return;
          }
          load(fid);
          const beforeExpr = previous.expr;
          const afterExpr = expr;
          pushHistory({
            label: "Edit if condition",
            undo: () => {
              setSnapshot((prev) => ({ ...prev, busy: true }));
              const id = remapRef.current.resolve(oldId);
              const back = optilotus_if_set_condition(fid, id, beforeExpr);
              if (isOptilotusError(back)) {
                setSnapshot((prev) => failCommand(prev, back));
                load(fid);
                return false;
              }
              load(fid);
              return true;
            },
            redo: () => {
              setSnapshot((prev) => ({ ...prev, busy: true }));
              const id = remapRef.current.resolve(oldId);
              const forward = optilotus_if_set_condition(fid, id, afterExpr);
              if (isOptilotusError(forward)) {
                setSnapshot((prev) => failCommand(prev, forward));
                load(fid);
                return false;
              }
              load(fid);
              return true;
            },
          });
          return;
        }
        const ordered = snapshot.commands;
        // The user-visible entry: the engine's own entry can name a
        // hidden node (an `if`'s condition compute or a conversion
        // group's anchor). `readLinks` applies the projection redirects.
        const entryNow =
          readLinks(fid, plannedLinksOf(plannedRef.current, fid))?.entry ??
          null;
        const slot = slotOf(fid, ordered, entryNow, oldId);
        if (slot === null) {
          setSnapshot((prev) => ({
            ...prev,
            busy: false,
            actionError: `Cannot edit: command #${oldId} no longer exists.`,
          }));
          return;
        }
        // The replaced block may live inside an `if` branch: the engine
        // drops a deleted id from every branch list, and inside a branch
        // no block's predecessor points at it through a user-level edge
        // (each member's span ends at a hidden tail that owns the inner
        // pointer), so the rebuilt block would sit outside the branch
        // with no inbound path — the run never reaches it. The owner is
        // captured before any delete; after the splice succeeds the
        // rebuild re-appends (the engine chains the branch tail to the
        // rebuilt head there). Recorded without its own history entry:
        // this Edit action's undo/redo reproduce the append.
        const slotBranch = branchOwnerOf(ordered).get(oldId) ?? null;
        // No-op Apply (e.g. re-applying an untouched quoted string):
        // nothing changed, so record nothing and recreate nothing.
        if (commandDraftEqual(slot.draft, draft)) {
          setSnapshot((prev) => ({ ...prev, busy: false }));
          return;
        }
        // Declare-to-declare edit: the replacement keeps the variable's
        // identity but may change its type and/or name. Two engine facts
        // shape this path (UI only adapts to them):
        // - `declare` rejects a duplicate name while the original still
        //   exists, so a same-name edit must delete first and create
        //   second; a rename can validate first (create before delete),
        //   preserving the block when the new literal is invalid.
        // - every `assign` bakes the declaration's type (and name) into
        //   its engine `Set` at creation, so the edit must also rebuild
        //   dependent assigns — otherwise the run fails with a stale
        //   `TypeMismatch` while the editor already shows the new type.
        // On validation failure the original block is restored into its
        // slot, so no work is lost (Issue 6).
        const isDeclareToDeclare =
          draft.kind === "declare" && slot.draft.kind === "declare";
        // `isDeclareToDeclare` already implies that both kinds are
        // `declare`, so the kind checks are not repeated here.
        const isSameNameDeclare =
          isDeclareToDeclare &&
          draft.name.trim() !== "" &&
          draft.name.trim() === slot.draft.name.trim();
        if (isDeclareToDeclare) {
          const oldDraft = slot.draft;
          const oldKind = slot.kind;
          const dependents: {
            id: CommandId;
            oldDraft: CommandDraft;
            newDraft: CommandDraft;
          }[] = [];
          if (oldDraft.kind === "declare" && draft.kind === "declare") {
            const oldName = oldDraft.name.trim();
            const nextName = draft.name.trim();
            const renamed = nextName !== oldName;
            // Selection lives in one place (`declareEditAffected`,
            // shared with the position capture); here only drafts.
            const affected = new Set(
              declareEditAffected(ordered, oldId, draft.name),
            );
            for (const c of ordered) {
              if (c.id === oldId || !affected.has(c.id)) continue;
              const rebuilt = summaryToDraft(c);
              if (c.kind === "assign" && (c.var ?? "") === oldName) {
                // Bound to the variable: follows type and name, and its
                // expression follows a rename.
                if (rebuilt.kind !== "assign") continue;
                dependents.push({
                  id: c.id,
                  oldDraft: rebuilt,
                  newDraft: {
                    ...rebuilt,
                    name: nextName,
                    expr: renamed
                      ? renameRefs(rebuilt.expr, oldName, nextName)
                      : rebuilt.expr,
                    // The user's chosen conversion target survives the
                    // declaration edit untouched — the destination's
                    // declaration is never rewritten by casting. If the
                    // new declared type now differs from the target, the
                    // rebuilt group's hidden store leg converts into the
                    // destination's type again (see the module doc in
                    // `lib/casting.ts`).
                  },
                });
                continue;
              }
              // Rename-only: rewrite textual `{old}` references in other
              // expressions/templates; calls (`name()`) never match.
              if (rebuilt.kind === "assign") {
                const expr = renameRefs(rebuilt.expr, oldName, nextName);
                if (expr !== rebuilt.expr) {
                  dependents.push({
                    id: c.id,
                    oldDraft: rebuilt,
                    newDraft: { ...rebuilt, expr },
                  });
                }
              } else if (rebuilt.kind === "print") {
                const template = renameRefs(
                  rebuilt.template,
                  oldName,
                  nextName,
                );
                if (template !== rebuilt.template) {
                  dependents.push({
                    id: c.id,
                    oldDraft: rebuilt,
                    newDraft: { ...rebuilt, template },
                  });
                }
              } else if (rebuilt.kind === "return") {
                const expr = renameRefs(rebuilt.expr, oldName, nextName);
                if (expr !== rebuilt.expr) {
                  dependents.push({
                    id: c.id,
                    oldDraft: rebuilt,
                    newDraft: { ...rebuilt, expr },
                  });
                }
              }
            }
          }
          const before = readLinks(
            fid,
            plannedLinksOf(plannedRef.current, fid),
          );
          let candidate: number | null = null;
          if (isSameNameDeclare) {
            if (!deleteVisibleCommand(fid, oldId)) {
              load(fid);
              return;
            }
            candidate = createDetached(fid, draft);
          } else {
            // Rename: validate the replacement while the original still
            // exists, so a bad literal or duplicate name fails without
            // deleting anything.
            const built = createDetached(fid, draft);
            if (built === null) {
              load(fid);
              return;
            }
            if (!deleteVisibleCommand(fid, oldId)) {
              deleteVisibleCommand(fid, built);
              load(fid);
              return;
            }
            candidate = built;
          }
          if (candidate === null) {
            insertSlot(
              fid,
              oldDraft,
              {
                prevId: slot.prevId,
                nextId: slot.nextId,
                makeEntry: slot.wasEntry,
              },
              oldId,
            );
            load(fid);
            return;
          }
          const remap = remapRef.current;
          remap.track(oldId, candidate);
          const prevId =
            slot.prevId === null ? null : remap.resolve(slot.prevId);
          const nextId =
            slot.nextId === null ? null : remap.resolve(slot.nextId);
          const spliced = runLinkPlan(fid, {
            edits: [
              ...(prevId === null
                ? []
                : [{ id: prevId, next: candidate }]),
              { id: candidate, next: nextId },
            ],
            entry: slot.wasEntry
              ? { type: "set" as const, entry: candidate }
              : { type: "keep" as const },
          });
          if (!spliced) {
            load(fid);
            return;
          }
          // Rebuild each dependent assign in its own slot (fresh reads:
          // every rebuild repairs the chain around itself, so sequential
          // splices stay consistent even for adjacent assigns).
          const newAssignIds: CommandId[] = [];
          for (const dep of dependents) {
            const listed = optilotus_listCommands(fid);
            if (isOptilotusError(listed)) {
              setSnapshot((prev) => failCommand(prev, listed));
              load(fid);
              return;
            }
            const infoNow = optilotus_getFunction(fid);
            // The slot must be read from the **visible** projection:
            // a conversion group's raw predecessor is its hidden cast,
            // which is deleted together with the assign. Splicing from
            // that id would leave the rebuilt group detached.
            const collapsedNow = collapseCasting(listed.commands);
            const logical = withPlannedLinks(
              collapsedNow.commands,
              plannedLinksOf(plannedRef.current, fid),
            );
            const entryNow =
              !isOptilotusError(infoNow) && infoNow.entry !== undefined
                ? resolveCastingEntry(
                    (entry) => resolveEntry(logical, entry),
                    collapsedNow.redirects,
                    infoNow.entry ?? null,
                  )
                : null;
            const depSlot = slotOf(fid, logical, entryNow, dep.id);
            if (depSlot === null) {
              load(fid);
              return;
            }
            if (!deleteVisibleCommand(fid, dep.id)) {
              load(fid);
              return;
            }
            const nid = createDetached(fid, dep.newDraft);
            if (nid === null) {
              load(fid);
              return;
            }
            remap.track(dep.id, nid);
            newAssignIds.push(nid);
            const depPrev =
              depSlot.prevId === null
                ? null
                : remap.resolve(depSlot.prevId);
            const depNext =
              depSlot.nextId === null
                ? null
                : remap.resolve(depSlot.nextId);
            const depSpliced = runLinkPlan(fid, {
              edits: [
                ...(depPrev === null
                  ? []
                  : [{ id: depPrev, next: nid }]),
                { id: nid, next: depNext },
              ],
              entry: depSlot.wasEntry
                ? { type: "set" as const, entry: nid }
                : { type: "keep" as const },
            });
            if (!depSpliced) {
              load(fid);
              return;
            }
          }
          const after = readLinks(
            fid,
            plannedLinksOf(plannedRef.current, fid),
          );
          const boxD = { id: candidate };
          const boxA = newAssignIds.map((id) => ({ id }));
          // Old drafts carry the previous name (for rename) and pair with
          // the previous baked-in types; new drafts carry the new name so
          // recreation picks up the new declaration type.
          const oldAssignDrafts = dependents.map((dep) => dep.oldDraft);
          const newAssignDrafts = dependents.map((dep) => dep.newDraft);
          load(fid);
          setSnapshot((prev) => ({ ...prev, selectedCommandId: boxD.id }));
          pushHistory({
            label: `Edit ${oldKind}`,
            undo: () => {
              setSnapshot((prev) => ({ ...prev, busy: true }));
              for (const b of [boxD, ...boxA]) {
                if (!deleteVisibleCommand(fid, remap.resolve(b.id))) {
                  load(fid);
                  return false;
                }
              }
              const nidD = createDetached(fid, oldDraft);
              if (nidD === null) {
                load(fid);
                return false;
              }
              remap.track(boxD.id, nidD);
              boxD.id = nidD;
              for (let i = 0; i < oldAssignDrafts.length; i += 1) {
                const item = oldAssignDrafts[i];
                const target = boxA[i];
                if (item === undefined || target === undefined) {
                  load(fid);
                  return false;
                }
                const nid = createDetached(fid, item);
                if (nid === null) {
                  load(fid);
                  return false;
                }
                remap.track(target.id, nid);
                target.id = nid;
              }
              if (before !== null) {
                if (!restoreLinks(fid, before.links, before.entry, false)) {
                  load(fid);
                  return false;
                }
              }
              load(fid);
              setSnapshot((prev) => ({ ...prev, selectedCommandId: nidD }));
              return true;
            },
            redo: () => {
              setSnapshot((prev) => ({ ...prev, busy: true }));
              for (const b of [boxD, ...boxA]) {
                if (!deleteVisibleCommand(fid, remap.resolve(b.id))) {
                  load(fid);
                  return false;
                }
              }
              const nidD = createDetached(fid, draft);
              if (nidD === null) {
                load(fid);
                return false;
              }
              remap.track(boxD.id, nidD);
              boxD.id = nidD;
              for (let i = 0; i < newAssignDrafts.length; i += 1) {
                const item = newAssignDrafts[i];
                const target = boxA[i];
                if (item === undefined || target === undefined) {
                  load(fid);
                  return false;
                }
                const nid = createDetached(fid, item);
                if (nid === null) {
                  load(fid);
                  return false;
                }
                remap.track(target.id, nid);
                target.id = nid;
              }
              if (after !== null) {
                if (!restoreLinks(fid, after.links, after.entry, false)) {
                  load(fid);
                  return false;
                }
              }
              load(fid);
              setSnapshot((prev) => ({ ...prev, selectedCommandId: nidD }));
              return true;
            },
          });
          return;
        }
        // Validate first (Issue 6): build the replacement detached
        // BEFORE deleting the original, so a validation failure (e.g.
        // assign to an undeclared variable) leaves the user's block
        // exactly where it was instead of silently deleting it.
        //
        const candidate = createDetached(fid, draft);
        if (candidate === null) {
          // Build failed before anything was touched: the original
          // block (still in place) plus the persistent error is the
          // whole visible outcome; no work is lost.
          load(fid);
          return;
        }
        // Candidate is live but detached; now remove the original and
        // splice the candidate into its slot.
        if (!deleteVisibleCommand(fid, oldId)) {
          // Original could not be removed: drop the candidate to avoid
          // duplicating the block, keep the error, restore the view.
          deleteVisibleCommand(fid, candidate);
          load(fid);
          return;
        }
        const remap = remapRef.current;
        const prevId =
          slot.prevId === null ? null : remap.resolve(slot.prevId);
        const nextId =
          slot.nextId === null ? null : remap.resolve(slot.nextId);
        const spliced = runLinkPlan(fid, {
          edits: [
            ...(prevId === null
              ? []
              : [{ id: prevId, next: candidate }]),
            { id: candidate, next: nextId },
          ],
          entry: slot.wasEntry
            ? { type: "set" as const, entry: candidate }
            : { type: "keep" as const },
        });
        if (!spliced) {
          // Splice failed partway: resync from the runtime (source of
          // truth), keep the persistent error, record no history. The
          // blocks all still exist; only their order may differ.
          load(fid);
          return;
        }
        if (
          slotBranch !== null &&
          !appendIntoBranch(
            fid,
            slotBranch.ifId,
            slotBranch.branch,
            candidate,
            false,
          )
        ) {
          load(fid);
          return;
        }
        const box = { id: candidate };
        const oldDraft = slot.draft;
        const oldKind = slot.kind;
        load(fid);
        setSnapshot((prev) => ({ ...prev, selectedCommandId: box.id }));
        pushHistory({
          label: `Edit ${oldKind}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            if (!deleteVisibleCommand(fid, remap.resolve(box.id))) {
              load(fid);
              return false;
            }
            const nid = insertSlot(
              fid,
              oldDraft,
              {
                prevId: slot.prevId,
                nextId: slot.nextId,
                makeEntry: slot.wasEntry,
              },
              oldId,
            );
            if (nid === null) {
              load(fid);
              return false;
            }
            remap.track(box.id, nid);
            box.id = nid;
            if (
              slotBranch !== null &&
              !appendIntoBranch(
                fid,
                slotBranch.ifId,
                slotBranch.branch,
                nid,
                false,
              )
            ) {
              load(fid);
              return false;
            }
            load(fid);
            setSnapshot((prev) => ({ ...prev, selectedCommandId: nid }));
            return true;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            if (!deleteVisibleCommand(fid, remap.resolve(box.id))) {
              load(fid);
              return false;
            }
            const nid = insertSlot(
              fid,
              draft,
              {
                prevId: slot.prevId,
                nextId: slot.nextId,
                makeEntry: slot.wasEntry,
              },
            );
            if (nid === null) {
              load(fid);
              return false;
            }
            remap.track(box.id, nid);
            box.id = nid;
            if (
              slotBranch !== null &&
              !appendIntoBranch(
                fid,
                slotBranch.ifId,
                slotBranch.branch,
                nid,
                false,
              )
            ) {
              load(fid);
              return false;
            }
            load(fid);
            setSnapshot((prev) => ({ ...prev, selectedCommandId: nid }));
            return true;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [
      load,
      snapshot.commands,
      deleteVisibleCommand,
      insertSlot,
      createDetached,
      runLinkPlan,
      restoreLinks,
      appendIntoBranch,
      pushHistory,
    ],
  );

  const deleteCommand = useCallback(
    (fid: FunctionId, cmd: CommandId): void => {
      try {
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        // The target function's own commands: `snapshot.commands` holds
        // the *selected* function's list, which is a different function
        // whenever the caller deletes a block outside the selection.
        const ordered =
          snapshot.commandsByFunction[fid] ?? snapshot.commands;
        // Projection-aware entry: a conversion group's engine entry is
        // its hidden anchor, which is redirected to the visible assign.
        const entryNow =
          readLinks(fid, plannedLinksOf(plannedRef.current, fid))?.entry ??
          null;
        const slot = slotOf(fid, ordered, entryNow, cmd);
        if (slot === null) {
          // The block is already gone: report it and leave the UI usable
          // (a stuck `busy` flag would disable the run button and the
          // whole canvas).
          setSnapshot((prev) => ({
            ...prev,
            busy: false,
            actionError: `Cannot delete: command #${cmd} no longer exists.`,
          }));
          return;
        }
        if (!deleteVisibleCommand(fid, cmd)) {
          load(fid);
          return;
        }
        // The deleted block's planned connection is gone with it.
        forgetPlannedLink(plannedRef.current, fid, cmd);
        const box = { id: cmd };
        load(fid);
        pushHistory({
          label: `Delete ${slot.kind}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const nid = insertSlot(
              fid,
              slot.draft,
              {
                prevId: slot.prevId,
                nextId: slot.nextId,
                makeEntry: slot.wasEntry,
              },
              box.id,
            );
            if (nid === null) {
              load(fid);
              return false;
            }
            box.id = nid;
            load(fid);
            setSnapshot((prev) => ({ ...prev, selectedCommandId: nid }));
            return true;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const ok = deleteVisibleCommand(
              fid,
              remapRef.current.resolve(box.id),
            );
            load(fid);
            return ok;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [
      load,
      snapshot.commands,
      snapshot.commandsByFunction,
      deleteVisibleCommand,
      insertSlot,
      pushHistory,
    ],
  );

  const applyLinks = useCallback(
    (fid: FunctionId, plan: LinkPlan): void => {
      try {
        const before = readLinks(
          fid,
          plannedLinksOf(plannedRef.current, fid),
        );
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        if (!runLinkPlan(fid, plan)) {
          // Rewire failed (e.g. stale id): the runtime rejected it, the
          // error persists, and no history entry is recorded. Refresh
          // so the canvas shows the authoritative graph.
          load(fid);
          return;
        }
        const after = readLinks(
          fid,
          plannedLinksOf(plannedRef.current, fid),
        );
        load(fid);
        if (before === null || after === null) return;
        const beforeLinks = before.links;
        const beforeEntry = before.entry;
        const afterLinks = after.links;
        const afterEntry = after.entry;
        pushHistory({
          label: "Rewire blocks",
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const ok = restoreLinks(fid, beforeLinks, beforeEntry, false);
            load(fid);
            return ok;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const ok = restoreLinks(fid, afterLinks, afterEntry, false);
            load(fid);
            return ok;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [runLinkPlan, load, pushHistory, restoreLinks],
  );

  /**
   * Wire a block into an `if` branch (then/else port drop). The engine
   * call is authoritative for branch membership; undo/redo replay the
   * captured `next`-edge state so the wires revert, though membership
   * stays (the bridge exposes no branch-list reverse operation —
   * documented limitation, never a silent divergence).
   */
  /** The polite form callers see: appends with one history record. */
  const applyIfAppend = useCallback(
    (
      fid: FunctionId,
      ifId: CommandId,
      branch: "then" | "else",
      targetId: CommandId,
    ): boolean => appendIntoBranch(fid, ifId, branch, targetId),
    [appendIntoBranch],
  );

  /** Read an `if`'s condition expression (null on bridge error). */
  const ifConditionText = useCallback(
    (fid: FunctionId, ifId: CommandId): string | null => {
      try {
        const result = optilotus_if_condition(fid, ifId);
        return isOptilotusError(result) ? null : result.expr;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Clear a function's entry point (`setEntry(fid, null)`). The commands
   * stay as orphans and runs become a no-op — exact engine semantics.
   * Undo restores the previous entry head (resolved through the
   * remapper in case it was recreated since).
   */
  const clearEntry = useCallback(
    (fid: FunctionId): void => {
      try {
        const info = optilotus_getFunction(fid);
        if (isOptilotusError(info)) {
          setSnapshot((prev) => failCommand(prev, info));
          return;
        }
        const prevEntry = info.entry ?? null;
        if (prevEntry === null) return;
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        const cleared = optilotus_setEntry(fid, null);
        if (isOptilotusError(cleared)) {
          setSnapshot((prev) => failCommand(prev, cleared));
          return;
        }
        load(fid);
        pushHistory({
          label: "Clear entry point",
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const target = remapRef.current.resolve(prevEntry);
            const restored = optilotus_setEntry(fid, target);
            if (isOptilotusError(restored)) {
              setSnapshot((prev) => failCommand(prev, restored));
              load(fid);
              return false;
            }
            load(fid);
            return true;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const gone = optilotus_setEntry(fid, null);
            if (isOptilotusError(gone)) {
              setSnapshot((prev) => failCommand(prev, gone));
              load(fid);
              return false;
            }
            load(fid);
            return true;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [load, pushHistory],
  );

  /** One function's restorable backup for project reset undo. */
  interface FunctionBackup {
    readonly name: string;
    readonly isMain: boolean;
    readonly items: { draft: CommandDraft }[];
    readonly links: readonly (readonly [number, number | null])[];
    readonly entry: number | null;
  }

  /**
   * Reset the whole project (`clearPackage`: helpers wiped, `main`
   * re-created empty). Captures every function's drafts + links + entry
   * first, so undo rebuilds the package through real bridge operations
   * (recreated commands get fresh ids — the engine has no un-delete —
   * tracked in the central remapper).
   */
  const clearPackage = useCallback((): void => {
    try {
      setSnapshot((prev) => ({
        ...clearFailure(prev),
        busy: true,
        recoveryVar: null,
      }));
      const backups: FunctionBackup[] = [];
      const listed = optilotus_listFunctions();
      for (const fn of listed.functions) {
        const info = optilotus_getFunction(fn.id);
        if (isOptilotusError(info)) {
          setSnapshot((prev) => failCommand(prev, info));
          return;
        }
        const cmds = optilotus_listCommands(fn.id);
        // Collapse hidden conversion groups before backing up: their
        // projected visible assign carries the casting choice, so undo
        // recreates a fresh valid group instead of two extra blocks.
        const collapsed = isOptilotusError(cmds)
          ? null
          : collapseCasting(cmds.commands);
        const ordered = collapsed === null ? [] : [...collapsed.commands];
        const planned = plannedLinksOf(plannedRef.current, fn.id);
        backups.push({
          name: info.name,
          isMain: info.isMain,
          items: ordered.map((c) => ({ draft: restorableDraft(fn.id, c) })),
          // The logical links: the engine's own edges plus the
          // connections it accepted but cannot report (the edge into an
          // `if`). The entry is the block the chain starts at — the
          // engine's raw entry can name a hidden node (`if` condition
          // compute or conversion anchor).
          links: ordered.map(
            (c) => [c.id, logicalNextOf(ordered, planned, c.id)] as const,
          ),
          entry:
            collapsed === null
              ? null
              : resolveCastingEntry(
                  (entry) => resolveEntry(ordered, entry),
                  collapsed.redirects,
                  info.entry ?? null,
                ),
        });
      }
      const selectedName = snapshot.selected?.name ?? null;

      /** Rebuild every backup; returns the restored selected id. */
      const restoreAll = (): FunctionId | null => {
        let restoredSelected: FunctionId | null = null;
        const remap = remapRef.current;
        for (const backup of backups) {
          let fid: number | null = null;
          if (backup.isMain) {
            const fresh = optilotus_listFunctions();
            const main = fresh.functions.find((f) => f.name === backup.name);
            if (main === undefined) {
              setSnapshot((prev) => ({
                ...prev,
                actionError: `Cannot restore: function "${backup.name}" is missing.`,
              }));
              return null;
            }
            fid = main.id;
          } else {
            const again = optilotus_createFunction(backup.name);
            if (isOptilotusError(again)) {
              setSnapshot((prev) => failCommand(prev, again));
              return null;
            }
            fid = again.id;
          }
          const createdIds: number[] = [];
          for (const item of backup.items) {
            const nid = createDetached(fid, item.draft);
            if (nid === null) return null;
            createdIds.push(nid);
          }
          const local = new Map<number, number>();
          backup.links.forEach(([old], i) => {
            const nid = createdIds[i];
            if (nid !== undefined) {
              local.set(old, nid);
              remap.track(old, nid);
            }
          });
          const edits: { id: number; next: number | null }[] = [];
          for (const [old, next] of backup.links) {
            const nid = local.get(old);
            if (nid === undefined) continue;
            edits.push({
              id: nid,
              next: next === null ? null : (local.get(next) ?? null),
            });
          }
          const applied = runLinkPlan(fid, {
            edits,
            entry:
              backup.entry === null
                ? { type: "keep" as const }
                : {
                    type: "set" as const,
                    entry: local.get(backup.entry) ?? null,
                  },
          });
          if (!applied) return null;
          if (backup.name === selectedName) restoredSelected = fid;
        }
        return restoredSelected;
      };

      optilotus_clearPackage();
      remapRef.current.clear();
      // The planned connections belonged to the wiped program.
      plannedRef.current.clear();
      setSnapshot((prev) => ({ ...prev, selectedCommandId: null }));
      load(null);
      pushHistory({
        label: "Reset project",
        undo: () => {
          setSnapshot((prev) => ({ ...prev, busy: true }));
          const restored = restoreAll();
          load(restored);
          return restored !== null;
        },
        redo: () => {
          setSnapshot((prev) => ({ ...prev, busy: true }));
          optilotus_clearPackage();
          // The allocator restarts, so every remembered id mapping is
          // stale (reused ids would otherwise resolve to wrong blocks).
          remapRef.current.clear();
          plannedRef.current.clear();
          setSnapshot((prev) => ({ ...prev, selectedCommandId: null }));
          load(null);
          return true;
        },
      });
    } catch (e: unknown) {
      setSnapshot((prev) => failThrown(prev, e));
    }
  }, [load, pushHistory, snapshot.selected, createDetached, runLinkPlan]);

  const run = useCallback((): void => {
    try {
      // A new execution starts without a failure: the previous error
      // (and the block it pointed at) must not survive into the new
      // run, or the canvas would keep highlighting a block that the
      // new run never touched.
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
          // The failure keeps its type, its message and every
          // structured field the engine sent; the visible block is
          // resolved from the engine's id, and stays unresolved when
          // the engine blamed a hidden node.
          return {
            ...withFailure(prev, result, errorMessage(result)),
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
      setSnapshot((prev) => failThrown(prev, e));
    }
  }, []);

  const clearRun = useCallback((): void => {
    setSnapshot((prev) => ({ ...prev, run: null, durationMs: null }));
  }, []);

  const dismissError = useCallback((): void => {
    setSnapshot((prev) => ({
      ...clearFailure(prev),
      recoveryVar: null,
    }));
  }, []);

  /**
   * Transactional undo/redo (Issue 2): the entry moves stacks only when
   * its thunk reports success. Failures leave the stacks untouched and
   * surface the persistent error the thunk recorded.
   */
  const undo = useCallback((): void => {
    const entry = pastRef.current[pastRef.current.length - 1];
    if (entry === undefined) return;
    let done = false;
    try {
      done = entry.undo();
    } catch (e: unknown) {
      setSnapshot((prev) => failThrown(prev, e));
      done = false;
    }
    if (!done) {
      syncTops();
      return;
    }
    pastRef.current.pop();
    futureRef.current.push(entry);
    syncTops();
  }, [syncTops]);

  const redo = useCallback((): void => {
    const entry = futureRef.current[futureRef.current.length - 1];
    if (entry === undefined) return;
    let done = false;
    try {
      done = entry.redo();
    } catch (e: unknown) {
      setSnapshot((prev) => failThrown(prev, e));
      done = false;
    }
    if (!done) {
      syncTops();
      return;
    }
    futureRef.current.pop();
    pastRef.current.push(entry);
    syncTops();
  }, [syncTops]);

  return {
    snapshot,
    selectFunction,
    selectCommand,
    refresh,
    createFunction,
    renameFunction,
    deleteFunction,
    addCommand,
    declareVariable,
    replaceCommand,
    deleteCommand,
    applyLinks,
    applyIfAppend,
    ifConditionText,
    clearEntry,
    clearPackage,
    run,
    clearRun,
    dismissError,
    canUndo: tops.canUndo,
    canRedo: tops.canRedo,
    undoLabel: tops.undoLabel,
    redoLabel: tops.redoLabel,
    undoSeq: tops.undoSeq,
    redoSeq: tops.redoSeq,
    undo,
    redo,
  };
}

export type { CommandDraft };
