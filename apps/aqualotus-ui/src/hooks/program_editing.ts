/**
 * Command-level editing operations for the program projection.
 *
 * Pure over the bridge + snapshot: they call Optilotus operations and
 * return results/errors, but never touch React state directly.
 * `useProgram` owns the snapshot and calls them from its `useCallback`
 * handlers, applying state transitions itself.
 *
 * Responsibility boundary: create / replace / delete of one visible
 * command, including hidden conversion groups and link repair around
 * `if` nodes.
 */

import type {
  CommandId,
  FunctionId,
} from "../lib/optilotus";
import {
  optilotus_deleteCommand,
  optilotus_getFunction,
  optilotus_if_append,
  optilotus_if_condition,
  optilotus_if_set_condition,
  optilotus_listCommands,
  optilotus_setEntry,
  optilotus_setNext,
} from "../lib/optilotus";
import type { CommandDraft } from "../lib/program";
import {
  isOptilotusError,
  summaryToDraft,
} from "../lib/program";
import { collapseCasting, type CastingInfo, resolveCastingEntry } from "../lib/casting";
import {
  withPlannedLinks,
  plannedLinksOf,
  recordPlannedLinks,
  forgetPlannedLinks,
  forgetPlannedLink,
  type PlannedLinks,
} from "./program_links";
import { createCastingGroup, rollbackCastingGroup, runBuilder } from "./program_casting";
import {
  resolveEntry,
  type LinkPlan,
} from "../lib/graph";
import type { ProgramMutationContext } from "./program_ops";
import {
  failCommand,
  failThrown,
  clearFailure,
  isUndeclaredError,
} from "./program_state";

/** Captured slot for removing/reinserting one command. */
interface CommandSlot {
  readonly kind: string;
  readonly draft: CommandDraft;
  readonly prevId: number | null;
  readonly nextId: number | null;
  readonly wasEntry: boolean;
  readonly casting?: CastingInfo;
}

/** Create the conversion group through the public bridge. */
export function createDetached(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  draft: CommandDraft,
): number | null {
  const { setSnapshot } = ctx;
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
}

/** Low-level delete. Bridge only; caller refreshes. History-free. */
export function bridgeDelete(
  fid: FunctionId,
  id: CommandId,
  ctx: ProgramMutationContext,
): boolean {
  const { setSnapshot } = ctx;
  const removed = optilotus_deleteCommand(fid, id);
  if (isOptilotusError(removed)) {
    setSnapshot((prev) => failCommand(prev, removed));
    return false;
  }
  return true;
}

/** Re-splice an `if`'s hidden condition compute. */
export function repairIfCondition(
  fid: FunctionId,
  ifId: CommandId,
  ctx: ProgramMutationContext,
): boolean {
  const { setSnapshot } = ctx;
  const condition = optilotus_if_condition(fid, ifId);
  if (isOptilotusError(condition)) return true;
  const repaired = optilotus_if_set_condition(fid, ifId, condition.expr);
  if (isOptilotusError(repaired)) {
    setSnapshot((prev) => failCommand(prev, repaired));
    return false;
  }
  return true;
}

/** Low-level link plan application. Bridge only; caller refreshes. */
export function runLinkPlan(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  plan: LinkPlan,
): boolean {
  const { setSnapshot, remapRef, plannedRef } = ctx;
  const remap = remapRef.current;
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
    forgetPlannedLinks(plannedRef.current, fid, plan, remap);
    return true;
  }
  for (const cmd of listed.commands) {
    if (cmd.kind !== "if") continue;
    if (!linked.has(cmd.id)) continue;
    if (!repairIfCondition(fid, cmd.id, ctx)) return false;
  }
  recordPlannedLinks(
    plannedRef.current,
    fid,
    plan,
    listed.commands,
    remap,
  );
  return true;
}

/** Exact link-map restore (reorder undo/redo, function restore). */
export function restoreLinks(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  links: ReadonlyMap<number, number | null>,
  entry: number | null,
  keepEntry: boolean,
): boolean {
  const { setSnapshot, remapRef } = ctx;
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
  return runLinkPlan(ctx, fid, {
    edits,
    entry: keepEntry
      ? { type: "keep" }
      : {
          type: "set",
          entry: liveEntry !== null && !live.has(liveEntry) ? null : liveEntry,
        },
  });
}

/** Insert a draft into a captured slot. History-free. */
export function insertSlot(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  draft: CommandDraft,
  slot: { prevId: number | null; nextId: number | null; makeEntry: boolean },
  restoresId?: number,
): number | null {
  const { remapRef } = ctx;
  const remap = remapRef.current;
  const nid = createDetached(ctx, fid, draft);
  if (nid === null) return null;
  if (restoresId !== undefined) remap.track(restoresId, nid);
  const prevId = slot.prevId === null ? null : remap.resolve(slot.prevId);
  const nextId = slot.nextId === null ? null : remap.resolve(slot.nextId);
  const edits: { id: number; next: number | null }[] = [];
  if (prevId !== null) edits.push({ id: prevId, next: nid });
  edits.push({ id: nid, next: nextId });
  if (
    !runLinkPlan(ctx, fid, {
      edits,
      entry: slot.makeEntry
        ? { type: "set", entry: nid }
        : { type: "keep" },
    })
  ) {
    return null;
  }
  return nid;
}

/** Delete one visible command, including a hidden conversion group. */
export function deleteVisibleCommand(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  id: CommandId,
): boolean {
  const { setSnapshot, plannedRef } = ctx;
  const listed = optilotus_listCommands(fid);
  const casting = isOptilotusError(listed)
    ? undefined
    : collapseCasting(listed.commands).castings.get(id);
  if (casting === undefined) return bridgeDelete(fid, id, ctx);
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
        !runLinkPlan(ctx, fid, {
          edits: [{ id: prev, next }],
          entry: { type: "keep" },
        })
      ) {
        return false;
      }
    } else if (links.entry === id) {
      if (
        !runLinkPlan(ctx, fid, {
          edits: [],
          entry: { type: "set", entry: next },
        })
      ) {
        return false;
      }
    }
  }
  if (!bridgeDelete(fid, id, ctx)) return false;
  if (casting.castId !== id && !bridgeDelete(fid, casting.castId, ctx)) {
    return false;
  }
  const cleared = optilotus_setNext(fid, casting.anchorId);
  if (isOptilotusError(cleared)) {
    setSnapshot((prev) => failCommand(prev, cleared));
    return false;
  }
  return bridgeDelete(fid, casting.anchorId, ctx);
}

/** Append a block into an `if` branch (then/else port drop). */
export function appendIntoBranch(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  ifId: CommandId,
  branch: "then" | "else",
  targetId: CommandId,
  record = true,
): boolean {
  const { setSnapshot, plannedRef, load, pushHistory } = ctx;
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
    const entryWasMember = before?.entry === targetId;
    for (const appendId of appendIds) {
      const result = optilotus_if_append(fid, ifId, branch, appendId);
      if (isOptilotusError(result)) {
        setSnapshot((prev) => failCommand(prev, result));
        load(fid);
        return false;
      }
    }
    forgetPlannedLink(plannedRef.current, fid, targetId);
    if (entryWasMember) {
      const moved = optilotus_setEntry(fid, ifId);
      if (isOptilotusError(moved)) {
        setSnapshot((prev) => failCommand(prev, moved));
        load(fid);
        return false;
      }
    }
    if (!repairIfCondition(fid, ifId, ctx)) {
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
          const ok = restoreLinks(ctx, fid, beforeLinks, beforeEntry, false);
          load(fid);
          return ok;
        },
        redo: () => {
          setSnapshot((prev) => ({ ...prev, busy: true }));
          const ok = restoreLinks(ctx, fid, afterLinks, afterEntry, false);
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
}

/** Read the links + entry for one function (projection-aware). */
export function readLinks(
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

/** Capture a command's restorable slot from a command list + entry. */
export function slotOf(
  fid: FunctionId,
  commands: readonly { id: number; kind: string; next: number | null }[],
  entry: number | null,
  id: CommandId,
): CommandSlot | null {
  const cmd = commands.find((c) => c.id === id);
  if (cmd === undefined) return null;
  const draft = restorableDraft(fid, cmd as never);
  return {
    kind: cmd.kind,
    draft,
    prevId: commands.find((c) => c.next === id)?.id ?? null,
    nextId: cmd.next ?? null,
    wasEntry: entry === id,
  };
}

/** A restorable draft for one command summary. Recovers `if` condition
 * expressions from the engine (the summary only holds the raw ValueId). */
export function restorableDraft(
  fid: FunctionId,
  cmd: { kind: string; id: number; condition?: unknown; var?: string; expr?: string; template?: string; ty?: unknown; access?: unknown; then?: unknown; else?: unknown; casting?: import("../lib/casting").CastingInfo },
): CommandDraft {
  const draft = summaryToDraft(cmd as never);
  if (draft.kind !== "if") return draft;
  const condition = optilotus_if_condition(fid, cmd.id);
  if (isOptilotusError(condition)) return { ...draft, condition: "" };
  return { ...draft, condition: condition.expr };
}
