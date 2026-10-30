/**
 * Package-level operations for the program projection.
 *
 * clearPackage: reset the whole project, capturing every function's
 * drafts + links + entry first so undo rebuilds through real bridge
 * operations.
 */

import type { FunctionId } from "../lib/optilotus";
import {
  optilotus_clearPackage,
  optilotus_createFunction,
  optilotus_getFunction,
  optilotus_listCommands,
  optilotus_listFunctions,
} from "../lib/optilotus";
import type { CommandDraft } from "../lib/program";
import { isOptilotusError } from "../lib/program";
import { collapseCasting, resolveCastingEntry } from "../lib/casting";
import { resolveEntry } from "../lib/graph";
import { plannedLinksOf, logicalNextOf } from "./program_links";
import { restorableDraft } from "./program_editing";
import type { ProgramMutationContext } from "./program_ops";
import { failCommand } from "./program_state";
import { setBusy, setSnapshotFailThrown } from "./program_ctx_helpers";

interface FunctionBackup {
  readonly name: string;
  readonly isMain: boolean;
  readonly items: { draft: CommandDraft }[];
  readonly links: readonly (readonly [number, number | null])[];
  readonly entry: number | null;
}

export function clearPackage(ctx: ProgramMutationContext): void {
  const { load, pushHistory, createDetached, runLinkPlan } = ctx;
  try {
    setBusy(ctx);
    const backups: FunctionBackup[] = [];
    const listed = optilotus_listFunctions();
    for (const fn of listed.functions) {
      const info = optilotus_getFunction(fn.id);
      if (isOptilotusError(info)) {
        ctx.setSnapshot((prev) => failCommand(prev, info));
        return;
      }
      const cmds = optilotus_listCommands(fn.id);
      const collapsed = isOptilotusError(cmds)
        ? null
        : collapseCasting(cmds.commands);
      const ordered = collapsed === null ? [] : [...collapsed.commands];
      const planned = plannedLinksOf(ctx.plannedRef.current, fn.id);
      backups.push({
        name: info.name,
        isMain: info.isMain,
        items: ordered.map((c) => ({ draft: restorableDraft(fn.id, c as never) })),
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
    const selectedName = ctx.snapshot.selected?.name ?? null;

    const restoreAll = (): FunctionId | null => {
      let restoredSelected: FunctionId | null = null;
      const remap = ctx.remapRef.current;
      for (const backup of backups) {
        let fid: number | null = null;
        if (backup.isMain) {
          const fresh = optilotus_listFunctions();
          const main = fresh.functions.find((f) => f.name === backup.name);
          if (main === undefined) {
            ctx.setSnapshot((prev) => ({
              ...prev,
              actionError: `Cannot restore: function "${backup.name}" is missing.`,
            }));
            return null;
          }
          fid = main.id;
        } else {
          const again = optilotus_createFunction(backup.name);
          if (isOptilotusError(again)) {
            ctx.setSnapshot((prev) => failCommand(prev, again));
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
    ctx.remapRef.current.clear();
    ctx.plannedRef.current.clear();
    ctx.setSnapshot((prev) => ({ ...prev, selectedCommandId: null }));
    load(null);
    pushHistory({
      label: "Reset project",
      undo: () => {
        setBusy(ctx);
        const restored = restoreAll();
        load(restored);
        return restored !== null;
      },
      redo: () => {
        setBusy(ctx);
        optilotus_clearPackage();
        ctx.remapRef.current.clear();
        ctx.plannedRef.current.clear();
        ctx.setSnapshot((prev) => ({ ...prev, selectedCommandId: null }));
        load(null);
        return true;
      },
    });
  } catch (e: unknown) {
    setSnapshotFailThrown(ctx, e);
  }
}
