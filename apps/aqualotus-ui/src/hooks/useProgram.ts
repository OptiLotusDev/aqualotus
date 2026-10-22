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
   * runs the branch instead of failing on a dangling condition.
   */
  const runLinkPlan = useCallback(
    (fid: FunctionId, plan: LinkPlan): boolean => {
      const remap = remapRef.current;
      const linked = new Set<number>();
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
        if (next !== null) linked.add(next);
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
        if (entry !== null) linked.add(entry);
      }
      if (linked.size === 0) return true;
      const listed = optilotus_listCommands(fid);
      if (isOptilotusError(listed)) return true;
      for (const cmd of listed.commands) {
        if (cmd.kind !== "if") continue;
        if (!linked.has(cmd.id)) continue;
        if (!repairIfCondition(fid, cmd.id)) return false;
      }
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
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
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
            const ok = bridgeDelete(fid, remapRef.current.resolve(box.id));
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
          const before = readLinks(fid);
          let candidate: number | null = null;
          if (isSameNameDeclare) {
            if (!bridgeDelete(fid, oldId)) {
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
            if (!bridgeDelete(fid, oldId)) {
              bridgeDelete(fid, built);
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
            const entryNow =
              !isOptilotusError(infoNow) && infoNow.entry !== undefined
                ? infoNow.entry
                : null;
            const depSlot = slotOf(listed.commands, entryNow, dep.id);
            if (depSlot === null) {
              load(fid);
              return;
            }
            if (!bridgeDelete(fid, dep.id)) {
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
          const after = readLinks(fid);
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
                if (!bridgeDelete(fid, remap.resolve(b.id))) {
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
                if (!bridgeDelete(fid, remap.resolve(b.id))) {
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
      restoreLinks,
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
   * Wire a block into an `if` branch (then/else port drop). The engine
   * call is authoritative for branch membership; undo/redo replay the
   * captured `next`-edge state so the wires revert, though membership
   * stays (the bridge exposes no branch-list reverse operation —
   * documented limitation, never a silent divergence).
   */
  const applyIfAppend = useCallback(
    (
      fid: FunctionId,
      ifId: CommandId,
      branch: "then" | "else",
      targetId: CommandId,
    ): boolean => {
      try {
        const before = readLinks(fid);
        setSnapshot((prev) => ({
          ...prev,
          busy: true,
          actionError: "",
          commandErrorId: null,
          recoveryVar: null,
        }));
        const result = optilotus_if_append(fid, ifId, branch, targetId);
        if (isOptilotusError(result)) {
          setSnapshot((prev) => failCommand(prev, result));
          load(fid);
          return false;
        }
        const after = readLinks(fid);
        load(fid);
        if (before !== null && after !== null) {
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
    [load, pushHistory, restoreLinks],
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
          // The allocator restarts, so every remembered id mapping is
          // stale (reused ids would otherwise resolve to wrong blocks).
          remapRef.current.clear();
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
