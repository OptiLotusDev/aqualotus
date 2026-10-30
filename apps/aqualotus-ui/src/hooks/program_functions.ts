/**
 * Function-level CRUD operations for the program projection.
 *
 * Pure over the bridge + snapshot. `useProgram` owns the snapshot and
 * calls them from its `useCallback` handlers.
 *
 * Imports low-level command operations from `program_editing.ts` for
 * use inside undo/redo thunks; no circular dependency because
 * `program_editing.ts` does not import from here.
 */

import type { FunctionId } from "../lib/optilotus";
import {
  optilotus_createFunction,
  optilotus_deleteFunction,
  optilotus_getFunction,
  optilotus_listCommands,
  optilotus_renameFunction,
} from "../lib/optilotus";
import {
  isOptilotusError,
} from "../lib/program";
import { collapseCasting } from "../lib/casting";
import { restorableDraft } from "./program_editing";
import { readLinks } from "./program_editing";
import {
  plannedLinksOf,
} from "./program_links";
import { createDetached, runLinkPlan } from "./program_editing";
import type { ProgramMutationContext } from "./program_ops";
import {
  failCommand,
  failThrown,
  clearFailure,
} from "./program_state";

export function createFunction(
  ctx: ProgramMutationContext,
  name: string,
): void {
  const { setSnapshot, load, pushHistory, selectedIdRef } = ctx;
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
}

export function deleteFunction(
  ctx: ProgramMutationContext,
  id: FunctionId,
): void {
  const {
    setSnapshot,
    load,
    pushHistory,
    selectedIdRef,
    snapshot,
  } = ctx;
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
    const items = isOptilotusError(cmds)
      ? []
      : collapseCasting(cmds.commands).commands.map((c) => ({
          draft: restorableDraft(id, c as never),
        }));
    const linksBefore = readLinks(
      id,
      plannedLinksOf(ctx.plannedRef.current, id),
    );
    const name = info.name;
    const deleted = optilotus_deleteFunction(id);
    if (isOptilotusError(deleted)) {
      setSnapshot((prev) => failCommand(prev, deleted));
      return;
    }
    ctx.plannedRef.current.delete(id);
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
          const remap = ctx.remapRef.current;
          const createdIds: number[] = [];
          for (const item of items) {
            const nid = createDetached(ctx, again.id, item.draft);
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
          runLinkPlan(ctx, again.id, {
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
}

export function renameFunction(
  ctx: ProgramMutationContext,
  id: FunctionId,
  name: string,
): void {
  const { setSnapshot, load, pushHistory, selectedIdRef } = ctx;
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
}
