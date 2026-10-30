/**
 * Casting group creation and the command-draft → bridge-call dispatcher.
 *
 * These are pure over the bridge: they call Optilotus operations and
 * return results or errors, but they never touch React state.
 * `useProgram` owns the snapshot and calls them when building commands.
 */

import type {
  FunctionId,
  OptilotusError,
} from "../lib/optilotus";
import type { CommandDraft } from "../lib/program";
import {
  optilotus_assign,
  optilotus_cast,
  optilotus_declare,
  optilotus_deleteCommand,
  optilotus_declareWithAccess,
  optilotus_getFunction,
  optilotus_if,
  optilotus_input,
  optilotus_listCommands,
  optilotus_print,
  optilotus_return,
  optilotus_setEntry,
  optilotus_setNext,
  optilotus_type,
} from "../lib/optilotus";
import {
  isOptilotusError,
  normalizeDeclareInit,
} from "../lib/program";
import {
  castingIncomplete,
  declaredTypeOf,
  nextCastingNames,
  nextConvertedNames,
} from "../lib/casting";

/** Engine id of the visible block plus the hidden conversion group behind it. */
export interface CreatedCastingGroup {
  /** Engine id of the visible block (the assign, or the native cast). */
  readonly visibleId: number;
  /** Hidden anchor declare whose user id is the group's head. */
  readonly anchorId: number;
  /** The user's target conversion cast; `=== visibleId` for native groups. */
  readonly castId: number;
}

/** Build a bridge-shaped error from a message. */
function castingValidationError(message: string): OptilotusError {
  return {
    status: "error",
    kind: "PackageError",
    command: null,
    message,
  } as OptilotusError;
}

/**
 * Best-effort removal of a partially created conversion group.
 *
 * Detaches the group from the chain before deleting it, so a dangling
 * predecessor never remains. Hidden casts are deleted in reverse
 * creation order so a later delete never walks into already-removed
 * raw nodes. After the casts are gone the anchor's user-level successor
 * is cleared before the anchor itself is deleted, detaching the stale
 * pointer (same order verified against the real Engine).
 */
export function rollbackCastingGroup(
  fid: FunctionId,
  ids: {
    anchorId: number;
    /** Hidden casts only: never the visible representative. */
    castIds: number[];
    visibleId?: number;
  },
): void {
  const listed = optilotus_listCommands(fid);
  if (!isOptilotusError(listed)) {
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
  for (const castId of [...ids.castIds].reverse()) {
    optilotus_deleteCommand(fid, castId);
  }
  optilotus_setNext(fid, ids.anchorId);
  optilotus_deleteCommand(fid, ids.anchorId);
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
 * **Target differs (or the destination is undeclared)** — the Engine's
 * *native* cast, which both converts and creates its variable:
 *
 *     declare anchor        (name carries the derived out name)
 *     cast <outName> to <target> = <source>
 *
 * Validation happens before any write when possible. A write that the
 * Engine still rejects rolls the whole group back and returns the
 * Engine's own typed error.
 */
export function createCastingGroup(
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
    // type, so the visible assign stores it directly.
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
  // converts AND creates the converted variable.
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

/** Exhaustiveness guard for `CommandDraft`. */
export function assertNeverDraft(draft: never): never {
  throw new Error(
    `Unhandled command draft kind: ${String((draft as { kind?: string }).kind)}`,
  );
}

/**
 * Dispatch one command draft to the matching Optilotus bridge call.
 *
 * Returns the Engine's result: a typed error, or the created command's
 * id-bearing response. `useProgram` calls this when creating commands
 * detached from the chain.
 */
export function runBuilder(
  fid: FunctionId,
  draft: CommandDraft,
): { status: "ok"; id: number } | OptilotusError {
  switch (draft.kind) {
    case "declare": {
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
      return assertNeverDraft(draft);
  }
}
