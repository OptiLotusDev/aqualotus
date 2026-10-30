/**
 * Program hook — composition layer.
 *
 * Owns the single authoritative program snapshot (`ProgramSnapshot`) and
 * all history/ref state. Feature modules (`program_editing.ts`,
 * `program_functions.ts`, `program_commands.ts`, `program_replace.ts`,
 * `program_execution.ts`, `program_package.ts`) receive a typed
 * `ProgramMutationContext` and perform operations against it; they never
 * own state themselves.
 *
 * One state owner. No competing snapshot. No competing history.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CommandId,
  FunctionId,
} from "../lib/optilotus";
import {
  optilotus_getFunction,
  optilotus_if_condition,
  optilotus_listCommands,
  optilotus_listFunctions,
  optilotus_setEntry,
} from "../lib/optilotus";
import { HistoryIdMap, type HistoryEntry } from "../lib/history";
import type { ProgramSnapshot } from "./program_state";
import {
  EMPTY,
  clearFailure,
  failCommand,
  failThrown,
  withResolvedTarget,
} from "./program_state";
import {
  plannedLinksOf,
  withPlannedLinks,
} from "./program_links";
import type { CommandDraft } from "../lib/program";
import { isOptilotusError } from "../lib/program";
import { collapseCasting, resolveCastingEntry } from "../lib/casting";
import { resolveEntry, type LinkPlan } from "../lib/graph";
import {
  createDetached,
  runLinkPlan as runLinkPlanOp,
  restoreLinks as restoreLinksOp,
  insertSlot as insertSlotOp,
  deleteVisibleCommand as deleteVisibleCommandOp,
  appendIntoBranch as appendIntoBranchOp,
  readLinks as readLinksOp,
} from "./program_editing";
import {
  createFunction as createFunctionOp,
  deleteFunction as deleteFunctionOp,
  renameFunction as renameFunctionOp,
} from "./program_functions";
import {
  addCommand as addCommandOp,
  declareVariable as declareVariableOp,
  deleteCommand as deleteCommandOp,
} from "./program_commands";
import { replaceCommand as replaceCommandOp } from "./program_replace";
import { run as runOp, clearRun as clearRunOp, dismissError as dismissErrorOp } from "./program_execution";
import { clearPackage as clearPackageOp } from "./program_package";
import type { ProgramMutationContext } from "./program_ops";

export type { ProgramSnapshot };
export { withPlannedLinks } from "./program_links";

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
  applyIfAppend: (
    fid: FunctionId,
    ifId: CommandId,
    branch: "then" | "else",
    targetId: CommandId,
  ) => boolean;
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
  const remapRef = useRef<HistoryIdMap>(new HistoryIdMap());
  const selectedIdRef = useRef<FunctionId | null>(null);
  const plannedRef = useRef<Map<number, Map<number, number>>>(new Map());

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

  useEffect(() => {
    selectedIdRef.current = snapshot.selectedId;
  }, [snapshot.selectedId]);

  // ------------------------------------------------------------------
  // Engine synchronization
  // ------------------------------------------------------------------

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
        let commands: readonly import("../lib/program").UiCommand[] = [];
        let entry: number | null = null;
        const commandsByFunction: Record<number, readonly import("../lib/program").UiCommand[]> = {};
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
            entry = resolveCastingEntry(
              (raw) => resolveEntry(commands, raw),
              collapsed.redirects,
              info.entry ?? null,
            );
            selected = { ...info, commandCount: commands.length };
          }
        }
        setSnapshot((prev) =>
          withResolvedTarget({
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
              run: null,
              durationMs: null,
            }),
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

  // ------------------------------------------------------------------
  // Selection
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // History
  // ------------------------------------------------------------------

  const pushHistory = useCallback(
    (entry: Omit<HistoryEntry, "seq">): void => {
      pastRef.current.push({ ...entry, seq: issueSeq() });
      futureRef.current = [];
      syncTops();
    },
    [issueSeq, syncTops],
  );

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

  // ------------------------------------------------------------------
  // Feature module context (memoized so callbacks stay stable)
  // ------------------------------------------------------------------

  const ctxRef = useRef<ProgramMutationContext | undefined>(undefined);

  const ctx = useMemo<ProgramMutationContext>(() => ({
    snapshot,
    setSnapshot,
    remapRef,
    plannedRef,
    selectedIdRef,
    pastRef,
    futureRef,
    syncTops,
    pushHistory,
    load,
    createDetached: (fid: FunctionId, draft: CommandDraft) =>
      createDetached(ctxRef.current!, fid, draft),
    runLinkPlan: (fid: FunctionId, plan: LinkPlan) =>
      runLinkPlanOp(ctxRef.current!, fid, plan),
    restoreLinks: (
      fid: FunctionId,
      links: ReadonlyMap<number, number | null>,
      entry: number | null,
      keepEntry: boolean,
    ) => restoreLinksOp(ctxRef.current!, fid, links, entry, keepEntry),
    insertSlot: (
      fid: FunctionId,
      draft: CommandDraft,
      slot: { prevId: number | null; nextId: number | null; makeEntry: boolean },
      restoresId?: number,
    ) => insertSlotOp(ctxRef.current!, fid, draft, slot, restoresId),
    deleteVisibleCommand: (fid: FunctionId, id: CommandId) =>
      deleteVisibleCommandOp(ctxRef.current!, fid, id),
    appendIntoBranch: (
      fid: FunctionId,
      ifId: CommandId,
      branch: "then" | "else",
      targetId: CommandId,
      record?: boolean,
    ) => appendIntoBranchOp(ctxRef.current!, fid, ifId, branch, targetId, record),
  }), [
    snapshot, setSnapshot, remapRef, plannedRef, selectedIdRef,
    pastRef, futureRef, syncTops, pushHistory, load,
  ]);

  // Publish the latest ctx so callbacks (which capture ctxRef, not ctx)
  // always read the current render's values. Set after render via effect.
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  // ------------------------------------------------------------------
  // Public API (delegates to feature modules)
  // ------------------------------------------------------------------

  const createFunction = useCallback(
    (name: string): void => createFunctionOp(ctxRef.current!, name),
    [],
  );

  const renameFunction = useCallback(
    (id: FunctionId, name: string): void => renameFunctionOp(ctxRef.current!, id, name),
    [],
  );

  const deleteFunction = useCallback(
    (id: FunctionId): void => deleteFunctionOp(ctxRef.current!, id),
    [],
  );

  const addCommand = useCallback(
    (fid: FunctionId, draft: CommandDraft): void => addCommandOp(ctxRef.current!, fid, draft),
    [],
  );

  const declareVariable = useCallback(
    (fid: FunctionId, name: string): void => declareVariableOp(ctxRef.current!, fid, name),
    [],
  );

  const replaceCommand = useCallback(
    (fid: FunctionId, oldId: CommandId, draft: CommandDraft): void =>
      replaceCommandOp(ctxRef.current!, fid, oldId, draft),
    [],
  );

  const deleteCommand = useCallback(
    (fid: FunctionId, cmd: CommandId): void => deleteCommandOp(ctxRef.current!, fid, cmd),
    [],
  );

  const applyLinks = useCallback(
    (fid: FunctionId, plan: LinkPlan): void => {
      try {
        const before = readLinksOp(
          fid,
          plannedLinksOf(plannedRef.current, fid),
        );
        setSnapshot((prev) => ({
          ...clearFailure(prev),
          busy: true,
          recoveryVar: null,
        }));
        if (!runLinkPlanOp(ctxRef.current!, fid, plan)) {
          load(fid);
          return;
        }
        const after = readLinksOp(
          fid,
          plannedLinksOf(plannedRef.current, fid),
        );
        load(fid);
        if (before === null || after === null) return;
        pushHistory({
          label: "Rewire blocks",
          undo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const ok = restoreLinksOp(ctxRef.current!, fid, before.links, before.entry, false);
            load(fid);
            return ok;
          },
          redo: () => {
            setSnapshot((prev) => ({ ...prev, busy: true }));
            const ok = restoreLinksOp(ctxRef.current!, fid, after.links, after.entry, false);
            load(fid);
            return ok;
          },
        });
      } catch (e: unknown) {
        setSnapshot((prev) => failThrown(prev, e));
      }
    },
    [load, pushHistory],
  );

  const applyIfAppend = useCallback(
    (
      fid: FunctionId,
      ifId: CommandId,
      branch: "then" | "else",
      targetId: CommandId,
    ): boolean => appendIntoBranchOp(ctxRef.current!, fid, ifId, branch, targetId),
    [],
  );

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

  const clearPackage = useCallback((): void => clearPackageOp(ctxRef.current!), []);

  const run = useCallback((): void => runOp(ctxRef.current!), []);
  const clearRun = useCallback((): void => clearRunOp(ctxRef.current!), []);
  const dismissError = useCallback((): void => dismissErrorOp(ctxRef.current!), []);

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
