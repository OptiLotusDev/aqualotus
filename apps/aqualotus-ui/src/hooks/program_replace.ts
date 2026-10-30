/**
 * Command replacement (Apply edit) for the program projection.
 *
 * The most complex editing operation: replaces one command with another,
 * including declare-to-declare edits that rebuild dependent assigns,
 * print templates, and return expressions on rename.
 */

import type { CommandId, FunctionId } from "../lib/optilotus";
import {
  optilotus_getFunction,
  optilotus_if_condition,
  optilotus_if_set_condition,
  optilotus_listCommands,
} from "../lib/optilotus";
import type { CommandDraft } from "../lib/program";
import {
  isOptilotusError,
  summaryToDraft,
  declareEditAffected,
  renameRefs,
} from "../lib/program";
import { collapseCasting, type CastingInfo, resolveCastingEntry } from "../lib/casting";
import { resolveEntry } from "../lib/graph";
import { withPlannedLinks } from "./program_links";
import { branchOwnerOf } from "../lib/graph";
import {
  createDetached,
  deleteVisibleCommand,
  insertSlot,
  readLinks,
  runLinkPlan,
  slotOf,
} from "./program_editing";
import { appendIntoBranch } from "./program_editing";
import { plannedLinksOf } from "./program_links";
import type { ProgramMutationContext } from "./program_ops";
import { failCommand } from "./program_state";
import { setBusy, setSnapshotFailThrown, setSnapshotSel } from "./program_ctx_helpers";
import {
  commandDraftEqual,
  commandSpecListEqual,
} from "./program_replace_helpers";

export function replaceCommand(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  oldId: CommandId,
  draft: CommandDraft,
): void {
  const {
    snapshot,
    setSnapshot,
  } = ctx;
  try {
    setBusy(ctx);
    const ordered = snapshot.commands;
    const entryNow =
      readLinks(fid, plannedLinksOf(ctx.plannedRef.current, fid))?.entry ??
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
    const slotBranch = branchOwnerOf(ordered).get(oldId) ?? null;
    if (commandDraftEqual(slot.draft, draft)) {
      setSnapshot((prev) => ({ ...prev, busy: false }));
      return;
    }

    // ------------------------------------------------------------------
    // Cast edits are refused: the hidden conversion compute has no
    // user-level id the editor can re-link. Conversions must be rebuilt
    // through an assignment with casting instead.
    // ------------------------------------------------------------------
    if (draft.kind === "cast") {
      setSnapshot((prev) => ({
        ...prev,
        busy: false,
        actionError:
          "Engine casts cannot be edited in place: the hidden conversion compute the block runs from has no user-level id the editor can re-link. Delete the block and add an assignment with casting instead (the public conversion flow).",
      }));
      return;
    }

    // ------------------------------------------------------------------
    // `if` condition-only edit: repoint the hidden condition compute in
    // place via `optilotus_if_set_condition`. This preserves the command
    // id and the planned connection into the `if` (the engine cannot
    // report that edge). Deleting + recreating would change the id and
    // break callers that still hold the old id.
    // ------------------------------------------------------------------
    if (
      slot.draft.kind === "if" &&
      draft.kind === "if" &&
      commandSpecListEqual(slot.draft.then, draft.then) &&
      commandSpecListEqual(slot.draft.else, draft.else)
    ) {
      replaceIfCondition(ctx, fid, oldId, slot.draft.condition, draft.condition);
      return;
    }

    const isDeclareToDeclare =
      draft.kind === "declare" && slot.draft.kind === "declare";
    if (isDeclareToDeclare) {
      handleDeclareToDeclare(ctx, fid, oldId, draft, slot);
      return;
    }
    handleStandardReplace(ctx, fid, oldId, draft, slot, slotBranch);
  } catch (e: unknown) {
    setSnapshotFailThrown(ctx, e);
  }
}

// ------------------------------------------------------------------
// `if` condition-only replacement
// ------------------------------------------------------------------

function replaceIfCondition(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  oldId: CommandId,
  beforeExpr: string,
  afterExpr: string,
): void {
  const { load, pushHistory, setSnapshot } = ctx;
  const previous = optilotus_if_condition(fid, oldId);
  if (isOptilotusError(previous)) {
    setSnapshot((prev) => failCommand(prev, previous));
    load(fid);
    return;
  }
  const applied = optilotus_if_set_condition(fid, oldId, afterExpr);
  if (isOptilotusError(applied)) {
    setSnapshot((prev) => failCommand(prev, applied));
    load(fid);
    return;
  }
  load(fid);
  pushHistory({
    label: "Edit if condition",
    undo: () => {
      setBusy(ctx);
      const back = optilotus_if_set_condition(fid, oldId, beforeExpr);
      if (isOptilotusError(back)) {
        setSnapshot((prev) => failCommand(prev, back));
        load(fid);
        return false;
      }
      load(fid);
      return true;
    },
    redo: () => {
      setBusy(ctx);
      const forward = optilotus_if_set_condition(fid, oldId, afterExpr);
      if (isOptilotusError(forward)) {
        setSnapshot((prev) => failCommand(prev, forward));
        load(fid);
        return false;
      }
      load(fid);
      return true;
    },
  });
}

function handleDeclareToDeclare(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  oldId: CommandId,
  draft: CommandDraft,
  slot: {
    kind: string;
    draft: CommandDraft;
    prevId: number | null;
    nextId: number | null;
    wasEntry: boolean;
    casting?: CastingInfo;
  },
): void {
  const { load, pushHistory, snapshot, remapRef } = ctx;
  if (draft.kind !== "declare" || slot.draft.kind !== "declare") return;
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
    const ordered = snapshot.commands;
    const affected = new Set(
      declareEditAffected(ordered, oldId, draft.name),
    );
    for (const c of ordered) {
      if (c.id === oldId || !affected.has(c.id)) continue;
      const rebuilt = summaryToDraft(c as never);
      if (c.kind === "assign" && (c.var ?? "") === oldName) {
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
          },
        });
        continue;
      }
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
        const template = renameRefs(rebuilt.template, oldName, nextName);
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
  const before = readLinks(fid, plannedLinksOf(ctx.plannedRef.current, fid));
  let candidate: number | null = null;
  const isSameNameDeclare =
    draft.name.trim() !== "" &&
    draft.name.trim() === slot.draft.name.trim();
  if (isSameNameDeclare) {
    if (!deleteVisibleCommand(ctx, fid, oldId)) {
      load(fid);
      return;
    }
    candidate = createDetached(ctx, fid, draft);
  } else {
    const built = createDetached(ctx, fid, draft);
    if (built === null) {
      load(fid);
      return;
    }
    if (!deleteVisibleCommand(ctx, fid, oldId)) {
      deleteVisibleCommand(ctx, fid, built);
      load(fid);
      return;
    }
    candidate = built;
  }
  if (candidate === null) {
    insertSlot(
      ctx,
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
  const spliced = runLinkPlan(ctx, fid, {
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
  const newAssignIds: CommandId[] = [];
  for (const dep of dependents) {
    const listed = optilotus_listCommands(fid);
    if (isOptilotusError(listed)) {
      ctx.setSnapshot((prev) => failCommand(prev, listed));
      load(fid);
      return;
    }
    const infoNow = optilotus_getFunction(fid);
    const collapsedNow = collapseCasting(listed.commands);
    const logical = withPlannedLinks(
      collapsedNow.commands,
      plannedLinksOf(ctx.plannedRef.current, fid),
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
    if (!deleteVisibleCommand(ctx, fid, dep.id)) {
      load(fid);
      return;
    }
    const nid = createDetached(ctx, fid, dep.newDraft);
    if (nid === null) {
      load(fid);
      return;
    }
    remap.track(dep.id, nid);
    newAssignIds.push(nid);
    const depPrev =
      depSlot.prevId === null ? null : remap.resolve(depSlot.prevId);
    const depNext =
      depSlot.nextId === null ? null : remap.resolve(depSlot.nextId);
    const depSpliced = runLinkPlan(ctx, fid, {
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
  const after = readLinks(fid, plannedLinksOf(ctx.plannedRef.current, fid));
  const boxD = { id: candidate };
  const boxA = newAssignIds.map((id) => ({ id }));
  const oldAssignDrafts = dependents.map((dep) => dep.oldDraft);
  const newAssignDrafts = dependents.map((dep) => dep.newDraft);
  load(fid);
  setSnapshotSel(ctx, boxD.id);
  pushHistory({
    label: `Edit ${oldKind}`,
    undo: () => {
      setBusy(ctx);
      for (const b of [boxD, ...boxA]) {
        if (!deleteVisibleCommand(ctx, fid, remap.resolve(b.id))) {
          load(fid);
          return false;
        }
      }
      const nidD = createDetached(ctx, fid, oldDraft);
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
        const nid = createDetached(ctx, fid, item);
        if (nid === null) {
          load(fid);
          return false;
        }
        remap.track(target.id, nid);
        target.id = nid;
      }
      if (before !== null) {
        if (!ctx.restoreLinks(fid, before.links, before.entry, false)) {
          load(fid);
          return false;
        }
      }
      load(fid);
      setSnapshotSel(ctx, nidD);
      return true;
    },
    redo: () => {
      setBusy(ctx);
      for (const b of [boxD, ...boxA]) {
        if (!deleteVisibleCommand(ctx, fid, remap.resolve(b.id))) {
          load(fid);
          return false;
        }
      }
      const nidD = createDetached(ctx, fid, draft);
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
        const nid = createDetached(ctx, fid, item);
        if (nid === null) {
          load(fid);
          return false;
        }
        remap.track(target.id, nid);
        target.id = nid;
      }
      if (after !== null) {
        if (!ctx.restoreLinks(fid, after.links, after.entry, false)) {
          load(fid);
          return false;
        }
      }
      load(fid);
      setSnapshotSel(ctx, nidD);
      return true;
    },
  });
}

function handleStandardReplace(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  oldId: CommandId,
  draft: CommandDraft,
  slot: {
    kind: string;
    draft: CommandDraft;
    prevId: number | null;
    nextId: number | null;
    wasEntry: boolean;
    casting?: CastingInfo;
  },
  slotBranch: { ifId: number; branch: "then" | "else" } | null,
): void {
  const { load, pushHistory, remapRef } = ctx;
  const candidate = createDetached(ctx, fid, draft);
  if (candidate === null) {
    load(fid);
    return;
  }
  if (!deleteVisibleCommand(ctx, fid, oldId)) {
    deleteVisibleCommand(ctx, fid, candidate);
    load(fid);
    return;
  }
  const remap = remapRef.current;
  const prevId =
    slot.prevId === null ? null : remap.resolve(slot.prevId);
  const nextId =
    slot.nextId === null ? null : remap.resolve(slot.nextId);
  const spliced = runLinkPlan(ctx, fid, {
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
  if (
    slotBranch !== null &&
    !appendIntoBranch(
      ctx,
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
  setSnapshotSel(ctx, box.id);
  pushHistory({
    label: `Edit ${oldKind}`,
    undo: () => {
      setBusy(ctx);
      if (!deleteVisibleCommand(ctx, fid, remap.resolve(box.id))) {
        load(fid);
        return false;
      }
      const nid = insertSlot(
        ctx,
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
          ctx,
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
      setSnapshotSel(ctx, nid);
      return true;
    },
    redo: () => {
      setBusy(ctx);
      if (!deleteVisibleCommand(ctx, fid, remap.resolve(box.id))) {
        load(fid);
        return false;
      }
      const nid = insertSlot(
        ctx,
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
          ctx,
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
      setSnapshotSel(ctx, nid);
      return true;
    },
  });
}
