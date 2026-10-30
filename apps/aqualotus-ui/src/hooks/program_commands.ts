/**
 * Public command-level API for the program projection.
 *
 * addCommand, declareVariable, deleteCommand — the user-facing editing
 * operations callers invoke through `useProgram`. They orchestrate
 * low-level operations from `program_editing.ts` and record history
 * entries.
 *
 * replaceCommand lives in `program_replace.ts` because of its size and
 * distinct declare-to-declare edit path.
 */

import type { CommandId, FunctionId } from "../lib/optilotus";
import {
  optilotus_declare,
  optilotus_getFunction,
  optilotus_listCommands,
  optilotus_type,
} from "../lib/optilotus";
import type { CommandDraft } from "../lib/program";
import { isOptilotusError } from "../lib/program";
import { collapseCasting } from "../lib/casting";
import { chainTailOf, resolveEntry } from "../lib/graph";
import {
  createDetached,
  deleteVisibleCommand,
  insertSlot,
  readLinks,
  slotOf,
} from "./program_editing";
import { plannedLinksOf, forgetPlannedLink, setPlannedLink } from "./program_links";
import type { ProgramMutationContext } from "./program_ops";
import { setBusy, setSnapshotFailThrown, setSnapshotFailCommand, setSnapshotSel } from "./program_ctx_helpers";

export function addCommand(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  draft: CommandDraft,
): void {
  const { load, pushHistory } = ctx;
  try {
    setBusy(ctx);
    const before = optilotus_listCommands(fid);
    const beforeInfo = optilotus_getFunction(fid);
    const beforeEntry =
      !isOptilotusError(beforeInfo) && beforeInfo.entry !== undefined
        ? beforeInfo.entry
        : null;
    const collapsed = isOptilotusError(before)
      ? { commands: [] }
      : collapseCasting(before.commands);
    const tail = isOptilotusError(before)
      ? null
      : chainTailOf(
          collapsed.commands,
          resolveEntry(collapsed.commands, beforeEntry),
        );
    const createdId = createDetached(ctx, fid, draft);
    if (createdId === null) {
      load(fid);
      return;
    }
    if (draft.kind === "if" && tail !== null) {
      setPlannedLink(ctx.plannedRef.current, fid, tail, createdId);
    }
    const box = { id: createdId };
    load(fid);
    setSnapshotSel(ctx, box.id);
    pushHistory({
      label: `Add ${draft.kind}`,
      undo: () => {
        setBusy(ctx);
        const ok = deleteVisibleCommand(
          ctx,
          fid,
          ctx.remapRef.current.resolve(box.id),
        );
        load(fid);
        return ok;
      },
      redo: () => {
        setBusy(ctx);
        const nid = createDetached(ctx, fid, draft);
        if (nid === null) {
          load(fid);
          return false;
        }
        ctx.remapRef.current.track(box.id, nid);
        box.id = nid;
        load(fid);
        setSnapshotSel(ctx, nid);
        return true;
      },
    });
  } catch (e: unknown) {
    setSnapshotFailThrown(ctx, e);
  }
}

export function declareVariable(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  name: string,
): void {
  const { load, pushHistory } = ctx;
  try {
    const trimmed = name.trim();
    if (trimmed === "") return;
    setBusy(ctx);
    const created = optilotus_declare(
      fid,
      trimmed,
      optilotus_type.int32,
    );
    if (isOptilotusError(created)) {
      setSnapshotFailCommand(ctx, created);
      load(fid);
      return;
    }
    const box = { id: created.id };
    load(fid);
    setSnapshotSel(ctx, box.id);
    pushHistory({
      label: `Declare ${trimmed}`,
      undo: () => {
        setBusy(ctx);
        const ok = deleteVisibleCommand(
          ctx,
          fid,
          ctx.remapRef.current.resolve(box.id),
        );
        load(fid);
        return ok;
      },
      redo: () => {
        setBusy(ctx);
        const again = optilotus_declare(
          fid,
          trimmed,
          optilotus_type.int32,
        );
        if (isOptilotusError(again)) {
          setSnapshotFailCommand(ctx, again);
          load(fid);
          return false;
        }
        ctx.remapRef.current.track(box.id, again.id);
        box.id = again.id;
        load(fid);
        return true;
      },
    });
  } catch (e: unknown) {
    setSnapshotFailThrown(ctx, e);
  }
}

export function deleteCommand(
  ctx: ProgramMutationContext,
  fid: FunctionId,
  cmd: CommandId,
): void {
  const { load, pushHistory, snapshot } = ctx;
  try {
    setBusy(ctx);
    const ordered =
      snapshot.commandsByFunction[fid] ?? snapshot.commands;
    const entryNow =
      readLinks(fid, plannedLinksOf(ctx.plannedRef.current, fid))?.entry ??
      null;
    const slot = slotOf(fid, ordered, entryNow, cmd);
    if (slot === null) {
      ctx.setSnapshot((prev) => ({
        ...prev,
        busy: false,
        actionError: `Cannot delete: command #${cmd} no longer exists.`,
      }));
      return;
    }
    if (!deleteVisibleCommand(ctx, fid, cmd)) {
      load(fid);
      return;
    }
    forgetPlannedLink(ctx.plannedRef.current, fid, cmd);
    const box = { id: cmd };
    load(fid);
    pushHistory({
      label: `Delete ${slot.kind}`,
      undo: () => {
        setBusy(ctx);
        const nid = insertSlot(
          ctx,
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
        setSnapshotSel(ctx, nid);
        return true;
      },
      redo: () => {
        setBusy(ctx);
        const ok = deleteVisibleCommand(
          ctx,
          fid,
          ctx.remapRef.current.resolve(box.id),
        );
        load(fid);
        return ok;
      },
    });
  } catch (e: unknown) {
    setSnapshotFailThrown(ctx, e);
  }
}
