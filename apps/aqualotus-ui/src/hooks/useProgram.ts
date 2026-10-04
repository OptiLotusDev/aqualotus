import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommandId,
  CommandSummary,
  FunctionId,
  FunctionInfo,
  FunctionSummary,
  RunResult,
} from "../lib/optilotus";
import {
  optilotus_assign,
  optilotus_createFunction,
  optilotus_declare,
  optilotus_deleteCommand,
  optilotus_deleteFunction,
  optilotus_getFunction,
  optilotus_listCommands,
  optilotus_listFunctions,
  optilotus_print,
  optilotus_return,
  optilotus_runProgram,
  optilotus_setEntry,
  optilotus_setNext,
} from "../lib/optilotus";
import {
  errorMessage,
  isOptilotusError,
  summaryToDraft,
} from "../lib/program";
import type { CommandDraft, CommandKind } from "../lib/program";
import type { LinkPlan } from "../lib/graph";

/** Immutable program projection owned by `useProgram` (P10). */
export interface ProgramSnapshot {
  readonly functions: readonly FunctionSummary[];
  readonly selectedId: FunctionId | null;
  readonly selected: (FunctionInfo & { status: "ok" }) | null;
  readonly commands: readonly CommandSummary[];
  readonly selectedCommandId: CommandId | null;
  readonly run: RunResult | null;
  readonly running: boolean;
  /** UI-measured bridge round-trip of the last run (not runtime CPU time). */
  readonly durationMs: number | null;
  readonly busy: boolean;
  readonly actionError: string;
  readonly commandErrorId: CommandId | null;
}

const EMPTY: ProgramSnapshot = {
  functions: [],
  selectedId: null,
  selected: null,
  commands: [],
  selectedCommandId: null,
  run: null,
  running: false,
  durationMs: null,
  busy: false,
  actionError: "",
  commandErrorId: null,
};

/**
 * One undoable unit. Undo/redo re-execute real authoritative bridge
 * operations (never a fake parallel history): each entry replays the
 * inverse mutation and refreshes from Optilotus. Linear stack
 * discipline — a new action clears the redo stack.
 */
export interface HistoryEntry {
  readonly seq: number;
  readonly label: string;
  readonly undo: () => void;
  readonly redo: () => void;
}

/** Captured slot for removing/reinserting one command. */
interface CommandSlot {
  readonly kind: string;
  readonly draft: CommandDraft;
  readonly prevId: number | null;
  readonly nextId: number | null;
  readonly wasEntry: boolean;
}

function failThrown(snapshot: ProgramSnapshot, e: unknown): ProgramSnapshot {
  return {
    ...snapshot,
    busy: false,
    running: false,
    actionError: e instanceof Error ? e.message : String(e),
    commandErrorId: null,
  };
}

function failCommand(snapshot: ProgramSnapshot, raw: unknown): ProgramSnapshot {
  if (typeof raw !== "object" || raw === null || !("status" in raw)) {
    return { ...snapshot, busy: false, actionError: String(raw) };
  }
  const result = raw as { status: string } & Record<string, unknown>;
  if (!isOptilotusError(result)) {
    return { ...snapshot, busy: false };
  }
  const command =
    typeof result.command === "number" ? (result.command as number) : null;
  return {
    ...snapshot,
    busy: false,
    actionError: errorMessage(result),
    commandErrorId: command,
  };
}

/** Read exact links + entry straight from the bridge. */
function readLinks(fid: FunctionId): {
  links: Map<number, number | null>;
  entry: number | null;
} | null {
  const listed = optilotus_listCommands(fid);
  if (isOptilotusError(listed)) return null;
  const info = optilotus_getFunction(fid);
  const entry =
    !isOptilotusError(info) && info.entry !== undefined ? info.entry : null;
  const links = new Map<number, number | null>();
  for (const c of listed.commands) links.set(c.id, c.next ?? null);
  return { links, entry };
}

/** Capture a command's restorable slot from a command list + entry. */
function slotOf(
  commands: readonly CommandSummary[],
  entry: number | null,
  id: CommandId,
): CommandSlot | null {
  const cmd = commands.find((c) => c.id === id);
  if (cmd === undefined) return null;
  return {
    kind: cmd.kind,
    draft: summaryToDraft(cmd),
    prevId: commands.find((c) => c.next === id)?.id ?? null,
    nextId: cmd.next ?? null,
    wasEntry: entry === id,
  };
}

/**
 * Owns the UI projection of the Optilotus package plus the semantic
 * undo history. Optilotus stays authoritative: every mutation goes
 * through the bridge and is followed by a refresh; React keeps
 * selection / layout / transient state only. Undo entries replay
 * inverse bridge operations, so history can never diverge from the
 * runtime into a second source of truth.
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
  deleteFunction: (id: FunctionId) => void;
  addCommand: (fid: FunctionId, draft: CommandDraft) => void;
  replaceCommand: (
    fid: FunctionId,
    oldId: CommandId,
    draft: CommandDraft,
  ) => void;
  deleteCommand: (fid: FunctionId, cmd: CommandId) => void;
  applyLinks: (fid: FunctionId, plan: LinkPlan) => void;
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

  useEffect(() => {
    selectedIdRef.current = snapshot.selectedId;
  }, [snapshot.selectedId]);

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
        let commands: CommandSummary[] = [];
        if (nextSelected !== null) {
          const info = optilotus_getFunction(nextSelected);
          if (!isOptilotusError(info)) {
            selected = info;
            const cmds = optilotus_listCommands(nextSelected);
            if (!isOptilotusError(cmds)) {
              commands = [...cmds.commands];
            }
          }
        }
        setSnapshot((prev) => ({
          ...prev,
          functions,
          selectedId: nextSelected,
          selected,
          commands,
          selectedCommandId:
            prev.selectedCommandId !== null &&
            commands.some((c) => c.id === prev.selectedCommandId)
              ? prev.selectedCommandId
              : null,
          busy: false,
          actionError: "",
          commandErrorId: null,
          // Output always describes the current program: any refresh
          // invalidates the previous run result (its command ids may be
          // gone after the next mutation).
          run: null,
          durationMs: null,
        }));
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

  useEffect(() => {
    if (!active) return;
    load(null);
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
        case "declare":
          return optilotus_declare(
            fid,
            draft.name,
            draft.ty,
            draft.init === "" ? undefined : draft.init,
          );
        case "assign":
          return optilotus_assign(fid, draft.name, draft.expr);
        case "print":
          return optilotus_print(fid, draft.template);
        case "return":
          return optilotus_return(fid, draft.expr);
      }
    },
    [],
  );

  /**
   * Low-level create that leaves the node detached (undoes the runtime
   * tail-append link). Bridge only; caller refreshes. History-free.
   */
  const createDetached = useCallback(
    (fid: FunctionId, draft: CommandDraft): number | null => {
      const created = runBuilder(fid, draft);
      if (isOptilotusError(created)) {
        setSnapshot((prev) => failCommand(prev, created));
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
   * Low-level link plan application. Bridge only; caller refreshes.
   * History-free (used by recording actions and by undo/redo thunks).
   */
  const runLinkPlan = useCallback(
    (fid: FunctionId, plan: LinkPlan): boolean => {
      for (const edit of plan.edits) {
        const link =
          edit.next === null
            ? optilotus_setNext(fid, edit.id)
            : optilotus_setNext(fid, edit.id, edit.next);
        if (isOptilotusError(link)) {
          setSnapshot((prev) => failCommand(prev, link));
          return false;
        }
      }
      if (plan.entry.type === "set") {
        const updated =
          plan.entry.entry === null
            ? optilotus_setEntry(fid, null)
            : optilotus_setEntry(fid, plan.entry.entry);
        if (isOptilotusError(updated)) {
          setSnapshot((prev) => failCommand(prev, updated));
          return false;
        }
      }
      return true;
    },
    [],
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
      const live = new Set(listed.commands.map((c) => c.id));
      const edits: { id: number; next: number | null }[] = [];
      for (const [id, next] of links) {
        if (!live.has(id)) continue;
        if (next !== null && !live.has(next)) continue;
        edits.push({ id, next });
      }
      return runLinkPlan(fid, {
        edits,
        entry: keepEntry ? { type: "keep" } : { type: "set", entry },
      });
    },
    [runLinkPlan],
  );

  /** Insert a draft into a captured slot. History-free. */
  const insertSlot = useCallback(
    (
      fid: FunctionId,
      draft: CommandDraft,
      slot: { prevId: number | null; nextId: number | null; makeEntry: boolean },
    ): number | null => {
      const nid = createDetached(fid, draft);
      if (nid === null) return null;
      const edits: { id: number; next: number | null }[] = [];
      if (slot.prevId !== null) edits.push({ id: slot.prevId, next: nid });
      edits.push({ id: nid, next: slot.nextId });
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

  const createFunction = useCallback(
    (name: string): void => {
      try {
        const trimmed = name.trim();
        if (trimmed === "") return;
        setSnapshot((prev) => ({ ...prev, busy: true }));
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
              return;
            }
            load(selectedIdRef.current);
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const again = optilotus_createFunction(trimmed);
            if (isOptilotusError(again)) {
              setSnapshot((prev) => failCommand(prev, again));
              return;
            }
            box.id = again.id;
            load(again.id);
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
        setSnapshot((prev) => ({ ...prev, busy: true }));
        const info = optilotus_getFunction(id);
        if (isOptilotusError(info)) {
          setSnapshot((prev) => failCommand(prev, info));
          return;
        }
        const cmds = optilotus_listCommands(id);
        const items: { draft: CommandDraft }[] = isOptilotusError(cmds)
          ? []
          : cmds.commands.map((c) => ({ draft: summaryToDraft(c) }));
        const linksBefore = readLinks(id);
        const name = info.name;
        const deleted = optilotus_deleteFunction(id);
        if (isOptilotusError(deleted)) {
          setSnapshot((prev) => failCommand(prev, deleted));
          return;
        }
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
              return;
            }
            box.id = again.id;
            if (linksBefore !== null) {
              const createdIds: number[] = [];
              for (const item of items) {
                const nid = createDetached(again.id, item.draft);
                if (nid === null) break;
                createdIds.push(nid);
              }
              const oldIds = [...linksBefore.links.keys()];
              const remap = new Map<number, number>();
              oldIds.forEach((old, i) => {
                const nid = createdIds[i];
                if (nid !== undefined) remap.set(old, nid);
              });
              const edits: { id: number; next: number | null }[] = [];
              for (const [old, next] of linksBefore.links) {
                const nid = remap.get(old);
                if (nid === undefined) continue;
                edits.push({
                  id: nid,
                  next: next === null ? null : (remap.get(next) ?? null),
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
                        entry: remap.get(oldEntry) ?? null,
                      },
              });
            }
            load(again.id);
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const gone = optilotus_deleteFunction(box.id);
            if (isOptilotusError(gone)) {
              setSnapshot((prev) => failCommand(prev, gone));
              return;
            }
            load(selectedIdRef.current);
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

  const addCommand = useCallback(
    (fid: FunctionId, draft: CommandDraft): void => {
      try {
        setSnapshot((prev) => ({ ...prev, busy: true }));
        const createdId = createDetached(fid, draft);
        if (createdId === null) return;
        const box = { id: createdId };
        load(fid);
        setSnapshot((prev) => ({ ...prev, selectedCommandId: box.id }));
        pushHistory({
          label: `Add ${draft.kind}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            bridgeDelete(fid, box.id);
            load(fid);
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const nid = createDetached(fid, draft);
            if (nid === null) return;
            box.id = nid;
            load(fid);
            setSnapshot((prev) => ({ ...prev, selectedCommandId: nid }));
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [load, createDetached, bridgeDelete, pushHistory],
  );

  const replaceCommand = useCallback(
    (fid: FunctionId, oldId: CommandId, draft: CommandDraft): void => {
      try {
        setSnapshot((prev) => ({ ...prev, busy: true }));
        const ordered = snapshot.commands;
        const info = optilotus_getFunction(fid);
        const entryNow =
          !isOptilotusError(info) && info.entry !== undefined
            ? info.entry
            : null;
        const slot = slotOf(ordered, entryNow, oldId);
        if (slot === null) {
          setSnapshot((prev) => ({
            ...prev,
            busy: false,
            actionError: `Cannot edit: command #${oldId} no longer exists.`,
          }));
          return;
        }
        if (!bridgeDelete(fid, oldId)) return;
        const createdId = insertSlot(fid, draft, {
          prevId: slot.prevId,
          nextId: slot.nextId,
          makeEntry: slot.wasEntry,
        });
        if (createdId === null) {
          load(fid);
          return;
        }
        const box = { id: createdId };
        const oldDraft = slot.draft;
        load(fid);
        setSnapshot((prev) => ({ ...prev, selectedCommandId: box.id }));
        pushHistory({
          label: `Edit ${slot.kind}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            if (!bridgeDelete(fid, box.id)) return;
            const nid = insertSlot(fid, oldDraft, {
              prevId: slot.prevId,
              nextId: slot.nextId,
              makeEntry: slot.wasEntry,
            });
            if (nid === null) {
              load(fid);
              return;
            }
            box.id = nid;
            load(fid);
            setSnapshot((prev) => ({ ...prev, selectedCommandId: nid }));
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            if (!bridgeDelete(fid, box.id)) return;
            const nid = insertSlot(fid, draft, {
              prevId: slot.prevId,
              nextId: slot.nextId,
              makeEntry: slot.wasEntry,
            });
            if (nid === null) {
              load(fid);
              return;
            }
            box.id = nid;
            load(fid);
            setSnapshot((prev) => ({ ...prev, selectedCommandId: nid }));
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [load, snapshot.commands, bridgeDelete, insertSlot, pushHistory],
  );

  const deleteCommand = useCallback(
    (fid: FunctionId, cmd: CommandId): void => {
      try {
        setSnapshot((prev) => ({ ...prev, busy: true }));
        const ordered = snapshot.commands;
        const info = optilotus_getFunction(fid);
        const entryNow =
          !isOptilotusError(info) && info.entry !== undefined
            ? info.entry
            : null;
        const slot = slotOf(ordered, entryNow, cmd);
        if (slot === null) return;
        if (!bridgeDelete(fid, cmd)) return;
        const box = { id: cmd };
        load(fid);
        pushHistory({
          label: `Delete ${slot.kind}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const nid = insertSlot(fid, slot.draft, {
              prevId: slot.prevId,
              nextId: slot.nextId,
              makeEntry: slot.wasEntry,
            });
            if (nid === null) {
              load(fid);
              return;
            }
            box.id = nid;
            load(fid);
            setSnapshot((prev) => ({ ...prev, selectedCommandId: nid }));
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            bridgeDelete(fid, box.id);
            load(fid);
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [load, snapshot.commands, bridgeDelete, insertSlot, pushHistory],
  );

  const applyLinks = useCallback(
    (fid: FunctionId, plan: LinkPlan): void => {
      try {
        const before = readLinks(fid);
        setSnapshot((prev) => ({ ...prev, busy: true }));
        if (!runLinkPlan(fid, plan)) return;
        const after = readLinks(fid);
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
            restoreLinks(fid, beforeLinks, beforeEntry, false);
            load(fid);
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            restoreLinks(fid, afterLinks, afterEntry, false);
            load(fid);
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [runLinkPlan, load, pushHistory, restoreLinks],
  );

  const run = useCallback((): void => {
    try {
      setSnapshot((prev) => ({ ...prev, running: true }));
      const started =
        typeof performance !== "undefined" ? performance.now() : 0;
      const result = optilotus_runProgram();
      const durationMs =
        typeof performance !== "undefined"
          ? Math.max(0, performance.now() - started)
          : 0;
      setSnapshot((prev) => ({
        ...prev,
        running: false,
        run: result,
        durationMs,
        actionError:
          result.status === "error" ? errorMessage(result) : prev.actionError,
        commandErrorId:
          result.status === "error" &&
          typeof result.command === "number"
            ? result.command
            : prev.commandErrorId,
      }));
    } catch (e: unknown) {
      setSnapshot((prev) => failThrown(prev, e));
    }
  }, []);

  const clearRun = useCallback((): void => {
    setSnapshot((prev) => ({ ...prev, run: null, durationMs: null }));
  }, []);

  const dismissError = useCallback((): void => {
    setSnapshot((prev) => ({
      ...prev,
      actionError: "",
      commandErrorId: null,
    }));
  }, []);

  const undo = useCallback((): void => {
    const entry = pastRef.current.pop();
    if (entry === undefined) return;
    try {
      entry.undo();
    } catch (e: unknown) {
      setSnapshot((prev) => failThrown(prev, e));
    }
    futureRef.current.push(entry);
    syncTops();
  }, [syncTops]);

  const redo = useCallback((): void => {
    const entry = futureRef.current.pop();
    if (entry === undefined) return;
    try {
      entry.redo();
    } catch (e: unknown) {
      setSnapshot((prev) => failThrown(prev, e));
    }
    pastRef.current.push(entry);
    syncTops();
  }, [syncTops]);

  return {
    snapshot,
    selectFunction,
    selectCommand,
    refresh,
    createFunction,
    deleteFunction,
    addCommand,
    replaceCommand,
    deleteCommand,
    applyLinks,
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

export type { CommandDraft, CommandKind };
