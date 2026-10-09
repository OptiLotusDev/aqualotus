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
  optilotus_clearPackage,
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
import { HistoryIdMap, type HistoryEntry } from "../lib/history";
import {
  errorMessage,
  isOptilotusError,
  summaryToDraft,
} from "../lib/program";
import type { CommandDraft } from "../lib/program";
import type { LinkPlan } from "../lib/graph";

/** Immutable program projection owned by `useProgram` (P10). */
export interface ProgramSnapshot {
  readonly functions: readonly FunctionSummary[];
  readonly selectedId: FunctionId | null;
  readonly selected: (FunctionInfo & { status: "ok" }) | null;
  readonly commands: readonly CommandSummary[];
  /** All functions' commands, keyed by FunctionId (for the workspace canvas). */
  readonly commandsByFunction: Readonly<
    Record<number, readonly CommandSummary[]>
  >;
  readonly selectedCommandId: CommandId | null;
  readonly run: RunResult | null;
  readonly running: boolean;
  /** UI-measured bridge round-trip of the last run (not runtime CPU time). */
  readonly durationMs: number | null;
  readonly busy: boolean;
  readonly actionError: string;
  readonly commandErrorId: CommandId | null;
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
  commands: [],
  commandsByFunction: {},
  selectedCommandId: null,
  run: null,
  running: false,
  durationMs: null,
  busy: false,
  actionError: "",
  commandErrorId: null,
  recoveryVar: null,
};

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
    recoveryVar: null,
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
        let commands: CommandSummary[] = [];
        const commandsByFunction: Record<number, readonly CommandSummary[]> =
          {};
        for (const fn of functions) {
          const cmds = optilotus_listCommands(fn.id);
          if (!isOptilotusError(cmds)) {
            commandsByFunction[fn.id] = [...cmds.commands];
          } else {
            commandsByFunction[fn.id] = [];
          }
        }
        if (nextSelected !== null) {
          const info = optilotus_getFunction(nextSelected);
          if (!isOptilotusError(info)) {
            selected = info;
            commands = [...(commandsByFunction[nextSelected] ?? [])];
          }
        }
        setSnapshot((prev) => ({
          ...prev,
          functions,
          selectedId: nextSelected,
          selected,
          commands,
          commandsByFunction,
          selectedCommandId:
            prev.selectedCommandId !== null &&
            commands.some((c) => c.id === prev.selectedCommandId)
              ? prev.selectedCommandId
              : null,
          busy: false,
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
        case "declare":
          // `init` is optional per the bridge/runtime (Issue 7): an empty
          // editor field means "omitted" (engine default), never a
          // fabricated zero. A genuinely typed empty string for
          // `string` variables still parses as a valid empty literal in
          // the engine, so no UI special-casing is needed beyond this.
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
   * Low-level link plan application. Bridge only; caller refreshes.
   * History-free (used by recording actions and by undo/redo thunks).
   * Ids resolve through the central remapper; unknown ids fail honestly
   * (the runtime rejects them and the error surfaces) — callers that
   * tolerate dead ids (e.g. `restoreLinks`) filter them beforehand.
   */
  const runLinkPlan = useCallback(
    (fid: FunctionId, plan: LinkPlan): boolean => {
      const remap = remapRef.current;
      for (const edit of plan.edits) {
        const id = remap.resolve(edit.id);
        const next =
          edit.next === null ? null : remap.resolve(edit.next);
        const link =
          next === null
            ? optilotus_setNext(fid, id)
            : optilotus_setNext(fid, id, next);
        if (isOptilotusError(link)) {
          setSnapshot((prev) => failCommand(prev, link));
          return false;
        }
      }
      if (plan.entry.type === "set") {
        const entry =
          plan.entry.entry === null
            ? null
            : remap.resolve(plan.entry.entry);
        const updated =
          entry === null
            ? optilotus_setEntry(fid, null)
            : optilotus_setEntry(fid, entry);
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

  const createFunction = useCallback(
    (name: string): void => {
      try {
        const trimmed = name.trim();
        if (trimmed === "") return;
        setSnapshot((prev) => ({
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
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
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
          recoveryVar: null,
        }));
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

  const addCommand = useCallback(
    (fid: FunctionId, draft: CommandDraft): void => {
      try {
        setSnapshot((prev) => ({
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
          recoveryVar: null,
        }));
        const createdId = createDetached(fid, draft);
        if (createdId === null) {
          // Validation failed: nothing was created, the error (plus a
          // recovery hint for undeclared variables) stays visible and
          // no history entry is recorded. The user's draft is NOT
          // deleted — it never left the caller's editor.
          load(fid);
          return;
        }
        const box = { id: createdId };
        load(fid);
        setSnapshot((prev) => ({ ...prev, selectedCommandId: box.id }));
        pushHistory({
          label: `Add ${draft.kind}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const ok = bridgeDelete(fid, remapRef.current.resolve(box.id));
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
    [load, createDetached, bridgeDelete, pushHistory],
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
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
          recoveryVar: null,
        }));
        const created = optilotus_declare(fid, trimmed, "int32");
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
            const ok = bridgeDelete(fid, remapRef.current.resolve(box.id));
            load(fid);
            return ok;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const again = optilotus_declare(fid, trimmed, "int32");
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
    [load, bridgeDelete, pushHistory],
  );

  const replaceCommand = useCallback(
    (fid: FunctionId, oldId: CommandId, draft: CommandDraft): void => {
      try {
        setSnapshot((prev) => ({
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
          recoveryVar: null,
        }));
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
        // Validate first (Issue 6): build the replacement detached
        // BEFORE deleting the original, so a validation failure (e.g.
        // assign to an undeclared variable) leaves the user's block
        // exactly where it was instead of silently deleting it.
        const candidate = createDetached(fid, draft);
        if (candidate === null) {
          load(fid);
          return;
        }
        // Candidate is live but detached; now remove the original and
        // splice the candidate into its slot.
        if (!bridgeDelete(fid, oldId)) {
          // Original could not be removed: drop the candidate to avoid
          // duplicating the block, keep the error, restore the view.
          bridgeDelete(fid, candidate);
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
        const box = { id: candidate };
        const oldDraft = slot.draft;
        const oldKind = slot.kind;
        load(fid);
        setSnapshot((prev) => ({ ...prev, selectedCommandId: box.id }));
        pushHistory({
          label: `Edit ${oldKind}`,
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            if (!bridgeDelete(fid, remap.resolve(box.id))) {
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
            load(fid);
            setSnapshot((prev) => ({ ...prev, selectedCommandId: nid }));
            return true;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            if (!bridgeDelete(fid, remap.resolve(box.id))) {
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
      bridgeDelete,
      insertSlot,
      createDetached,
      runLinkPlan,
      pushHistory,
    ],
  );

  const deleteCommand = useCallback(
    (fid: FunctionId, cmd: CommandId): void => {
      try {
        setSnapshot((prev) => ({
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
          recoveryVar: null,
        }));
        const ordered = snapshot.commands;
        const info = optilotus_getFunction(fid);
        const entryNow =
          !isOptilotusError(info) && info.entry !== undefined
            ? info.entry
            : null;
        const slot = slotOf(ordered, entryNow, cmd);
        if (slot === null) return;
        if (!bridgeDelete(fid, cmd)) {
          load(fid);
          return;
        }
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
            const ok = bridgeDelete(fid, remapRef.current.resolve(box.id));
            load(fid);
            return ok;
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
        setSnapshot((prev) => ({
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
          recoveryVar: null,
        }));
        if (!runLinkPlan(fid, plan)) {
          // Rewire failed (e.g. stale id): the runtime rejected it, the
          // error persists, and no history entry is recorded. Refresh
          // so the canvas shows the authoritative graph.
          load(fid);
          return;
        }
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
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
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
        ...prev,
        busy: true,
        actionError: "",
        commandErrorId: null,
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
        const ordered = isOptilotusError(cmds) ? [] : [...cmds.commands];
        backups.push({
          name: info.name,
          isMain: info.isMain,
          items: ordered.map((c) => ({ draft: summaryToDraft(c) })),
          links: ordered.map(
            (c) => [c.id, c.next ?? null] as const,
          ),
          entry: info.entry ?? null,
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
        // A fresh execution supersedes the previous error display: runs
        // are explicit user actions, so success clears and failure
        // replaces the action error (Issue 3: explicit clearing event).
        actionError:
          result.status === "error" ? errorMessage(result) : "",
        commandErrorId:
          result.status === "error" &&
          typeof result.command === "number"
            ? result.command
            : null,
        recoveryVar: null,
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
    deleteFunction,
    addCommand,
    declareVariable,
    replaceCommand,
    deleteCommand,
    applyLinks,
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
