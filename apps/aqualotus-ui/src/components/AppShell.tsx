import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useInheritPosition } from "../hooks/useInheritPosition";
import { useLayout } from "../hooks/useLayout";
import { useTheme } from "../hooks/useTheme";
import type { RuntimeStatus } from "../hooks/useRuntime";
import type { ProgramSnapshot } from "../hooks/useProgram";
import type { CommandDraft } from "../lib/program";
import { freshName } from "../lib/program";
import type { LinkPlan } from "../lib/graph";
import { planDropLink } from "../lib/graph";
import { findAvailableBlock } from "../lib/blocks";
import type { LayoutMap } from "../lib/layout";
import { LAYOUT_ROW_Y, LAYOUT_START_X } from "../lib/layout";
import type { CommandId, FunctionId } from "../lib/optilotus";
import Inspector from "./Inspector";
import ProjectNavigator from "./ProjectNavigator";
import Runner from "./Runner";
import VisualEditor from "./VisualEditor";
import { breadcrumbPath } from "../lib/workspace";

/**
 * Aqualotus UI release version shown in the status pill. The live
 * bridge version/health stay available on hover for diagnostics.
 */
const APP_VERSION = "0.3.1";
const APP_NAME = "OptiLotus";

interface AppShellProps {
  readonly runtime: RuntimeStatus;
  readonly program: ProgramSnapshot;
  readonly issueSeq: () => number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly undoSeq: number | null;
  readonly redoSeq: number | null;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onSelectFunction: (id: FunctionId | null) => void;
  readonly onSelectCommand: (id: CommandId | null) => void;
  readonly onCreateFunction: (name: string) => void;
  readonly onDeleteFunction: (id: FunctionId) => void;
  readonly onAddCommand: (fid: FunctionId, draft: CommandDraft) => void;
  readonly onDeclareVariable: (fid: FunctionId, name: string) => void;
  readonly onReplaceCommand: (
    fid: FunctionId,
    oldId: CommandId,
    draft: CommandDraft,
  ) => void;
  readonly onDeleteCommand: (fid: FunctionId, cmd: CommandId) => void;
  readonly onApplyLinks: (fid: FunctionId, plan: LinkPlan) => void;
  readonly onClearEntry: (fid: FunctionId) => void;
  readonly onClearPackage: () => void;
  readonly onRun: () => void;
  readonly onDismissError: () => void;
}

/** One view-undo unit: block layout and zoom only, never semantics. */
interface ViewEntry {
  readonly seq: number;
  readonly label: string;
  readonly fid: FunctionId | null;
  readonly posBefore: LayoutMap;
  readonly posAfter: LayoutMap;
  readonly zoomBefore: number;
  readonly zoomAfter: number;
}

/** Default name for function blocks created from the library. */
function nextHelperName(existing: readonly { name: string }[]): string {
  if (!existing.some((f) => f.name === "helper")) return "helper";
  let n = 1;
  while (existing.some((f) => f.name === `helper${n}`)) {
    n += 1;
  }
  return `helper${n}`;
}

/** Compact runner pill text for the collapsed dock. */
function runnerSummary(program: ProgramSnapshot): string {
  if (program.running) return "Running…";
  const run = program.run;
  if (run === null) return "Runner";
  if (run.status === "ok") {
    const ms = program.durationMs;
    return `Completed${ms !== null ? ` · ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` : ""}`;
  }
  return "Run failed";
}

/**
 * Full-bleed canvas shell: the black canvas fills the page while the
 * function/library panel, inspector, runner, and controls float above
 * it as glass. App-bar buttons undo/redo both semantic history (from
 * the program hook) and view history (layout + zoom) through one
 * sequence-ordered pair. On compact viewports the same tree collapses
 * to the drawer / sheet / inline patterns via CSS.
 */
export default function AppShell(props: AppShellProps): ReactElement {
  const { runtime, program, issueSeq } = props;
  const compact = useIsMobile();
  const { theme, toggle: toggleTheme } = useTheme();
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [leftOpen, setLeftOpen] = useState<boolean>(false);
  const [inspOpen, setInspOpen] = useState<boolean>(false);
  const [runOpen, setRunOpen] = useState<boolean>(false);

  const fid = program.selectedId;
  const commandIds = useMemo(
    () => program.commands.map((c) => c.id),
    [program.commands],
  );
  // Block positions are relative to their function container (the
  // hierarchy owns world layout), so auto-placement chains blocks in a
  // horizontal row matching the left → right ports.
  const layout = useLayout(fid, commandIds, LAYOUT_START_X, LAYOUT_ROW_Y);
  const { moveBlockIn, replaceAll } = layout;

  // Edited blocks keep their position: Apply-edit recreates the command
  // under a fresh id, and the capture below hands the old position to
  // the newcomer once it appears in the refreshed projection.
  const { captureInherit } = useInheritPosition(
    program.commandsByFunction,
    program.busy,
    moveBlockIn,
  );

  /** Apply-edit wrapper that preserves the edited block's position. */
  function replaceWithPosition(
    target: FunctionId,
    oldId: CommandId,
    draft: CommandDraft,
  ): void {
    const cmds = program.commandsByFunction[target] ?? [];
    captureInherit(
      target,
      layout.allPositions[target]?.[oldId] ?? {
        x: LAYOUT_START_X,
        y: LAYOUT_ROW_Y,
      },
      cmds.map((c) => c.id),
    );
    props.onReplaceCommand(target, oldId, draft);
  }

  // View-undo stacks (layout + zoom), stored in refs with synced tops
  // so renders never read refs. Sequenced against semantic history so
  // one undo/redo pair serves the newest action first.
  const viewPastRef = useRef<ViewEntry[]>([]);
  const viewFutureRef = useRef<ViewEntry[]>([]);
  const [viewTops, setViewTops] = useState<{
    undoLabel: string | null;
    redoLabel: string | null;
    undoSeq: number | null;
    redoSeq: number | null;
  }>({ undoLabel: null, redoLabel: null, undoSeq: null, redoSeq: null });

  const syncViewTops = useCallback((): void => {
    const past = viewPastRef.current;
    const future = viewFutureRef.current;
    setViewTops({
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

  const pushView = useCallback(
    (
      target: FunctionId | null,
      label: string,
      posBefore: LayoutMap,
      posAfter: LayoutMap,
      zoomBefore: number,
      zoomAfter: number,
    ): void => {
      viewPastRef.current.push({
        seq: issueSeq(),
        label,
        fid: target,
        posBefore,
        posAfter,
        zoomBefore,
        zoomAfter,
      });
      viewFutureRef.current = [];
      syncViewTops();
    },
    [issueSeq, syncViewTops],
  );
  const zoomCtlRef = useRef<{
    getZoom: () => number;
    setZoom: (z: number) => void;
  } | null>(null);

  const registerZoom = useCallback(
    (ctl: { getZoom: () => number; setZoom: (z: number) => void } | null): void => {
      zoomCtlRef.current = ctl;
    },
    [],
  );

  // Zoom-aware canvas drop conversion, registered by VisualEditor.
  const dropHandlerRef = useRef<
    ((kind: string, clientX: number, clientY: number) => void) | null
  >(null);
  const registerDrop = useCallback(
    (
      handler:
        | ((kind: string, clientX: number, clientY: number) => void)
        | null,
    ): void => {
      dropHandlerRef.current = handler;
    },
    [],
  );

  // Drawer/sheet visibility derives from the viewport during render
  // (no sync effect): on desktop the compact overlays never show.
  const navVisible = compact && navOpen;
  const sheetVisible = compact && sheetOpen;

  const undoView = useCallback(
    (entry: ViewEntry, dir: "undo" | "redo"): void => {
      if (entry.fid !== null) {
        replaceAll(
          entry.fid,
          dir === "undo" ? entry.posBefore : entry.posAfter,
        );
      }
      zoomCtlRef.current?.setZoom(
        dir === "undo" ? entry.zoomBefore : entry.zoomAfter,
      );
    },
    [replaceAll],
  );

  const undoAll = useCallback((): void => {
    const past = viewPastRef.current;
    const vTop = past.length > 0 ? past[past.length - 1] : undefined;
    if (
      vTop !== undefined &&
      (props.undoSeq === null || vTop.seq > props.undoSeq)
    ) {
      past.pop();
      undoView(vTop, "undo");
      viewFutureRef.current.push(vTop);
      syncViewTops();
      return;
    }
    props.onUndo();
  }, [props, undoView, syncViewTops]);

  const redoAll = useCallback((): void => {
    const future = viewFutureRef.current;
    const vTop = future.length > 0 ? future[future.length - 1] : undefined;
    if (
      vTop !== undefined &&
      (props.redoSeq === null || vTop.seq > props.redoSeq)
    ) {
      future.pop();
      undoView(vTop, "redo");
      viewPastRef.current.push(vTop);
      syncViewTops();
      return;
    }
    props.onRedo();
  }, [props, undoView, syncViewTops]);

  const canUndoAll = props.canUndo || viewTops.undoSeq !== null;
  const canRedoAll = props.canRedo || viewTops.redoSeq !== null;
  const undoTitle =
    viewTops.undoLabel !== null &&
    (props.undoSeq === null ||
      (viewTops.undoSeq ?? 0) > props.undoSeq)
      ? `Undo ${viewTops.undoLabel}`
      : props.undoLabel !== null
        ? `Undo ${props.undoLabel}`
        : "Nothing to undo";
  const redoTitle =
    viewTops.redoLabel !== null &&
    (props.redoSeq === null ||
      (viewTops.redoSeq ?? 0) > props.redoSeq)
      ? `Redo ${viewTops.redoLabel}`
      : props.redoLabel !== null
        ? `Redo ${props.redoLabel}`
        : "Nothing to redo";

  /** Deleting the selected block closes the inspector with it. */
  const deleteBlock = useCallback(
    (id: CommandId): void => {
      if (fid === null) return;
      props.onDeleteCommand(fid, id);
      if (!compact && id === program.selectedCommandId) {
        setInspOpen(false);
      }
    },
    [fid, props, compact, program.selectedCommandId],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as Element | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        props.onRun();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          undoAll();
          return;
        }
        if (key === "z" && e.shiftKey) {
          e.preventDefault();
          redoAll();
          return;
        }
        if (key === "y") {
          e.preventDefault();
          redoAll();
          return;
        }
      }
      if (e.key === "Escape") {
        setNavOpen(false);
        setSheetOpen(false);
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !typing &&
        fid !== null &&
        program.selectedCommandId !== null
      ) {
        e.preventDefault();
        deleteBlock(program.selectedCommandId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props, fid, program.selectedCommandId, undoAll, redoAll, deleteBlock]);

  const selectedCommand =
    program.selectedCommandId !== null
      ? (program.commands.find((c) => c.id === program.selectedCommandId) ??
        null)
      : null;

  /** Add a library block: create the real entity, auto-place its node. */
  function addLibraryBlockFor(target: FunctionId, kind: string): void {
    const def = findAvailableBlock(kind);
    if (def === null) return;
    if (def.action === "create-function") {
      props.onCreateFunction(nextHelperName(program.functions));
      return;
    }
    if (def.draft === undefined) return;
    // Friendly defaults keep click-to-add valid: fresh variable names,
    // a literal template, and a neutral return value. Calls reuse the
    // first declared variable when one exists; otherwise the runtime
    // error names the fix ("declare it first"). The bridge still
    // validates everything; the inspector refines afterwards.
    const targetCommands =
      target === fid ? program.commands : (program.commandsByFunction[target] ?? []);
    const taken = targetCommands.flatMap((c) =>
      c.var === undefined ? [] : [c.var],
    );
    const firstVar =
      targetCommands.find((c) => c.kind === "declare")?.var ?? null;
    const draft = def.draft;
    let filled: CommandDraft = draft;
    if (draft.kind === "declare") {
      filled = { ...draft, name: freshName(taken, "x") };
    } else if (draft.kind === "assign") {
      // Calls target the first declared variable (the callee name is
      // edited in the inspector); plain assigns keep a typed name.
      const name =
        def.kind === "call"
          ? (firstVar ?? "result")
          : draft.name !== ""
            ? draft.name
            : (firstVar ?? "x");
      filled = {
        ...draft,
        name,
        expr: draft.expr !== "" ? draft.expr : `{${name}}`,
      };
    } else if (draft.kind === "print" && draft.template === "") {
      filled = { ...draft, template: '"hello"' };
    } else if (draft.kind === "return" && draft.expr === "") {
      filled = { ...draft, expr: "0" };
    }
    props.onAddCommand(target, filled);
  }

  function addLibraryBlock(kind: string): void {
    if (fid === null) return;
    addLibraryBlockFor(fid, kind);
  }

  /** Connection drop: plan minimal edits, apply only when meaningful. */
  function reconnect(
    target: FunctionId,
    sourceId: CommandId,
    targetId: CommandId | null,
    where: "after" | "before" | "end",
  ): boolean {
    const cmds = program.commandsByFunction[target] ?? [];
    const entry =
      target === fid ? (program.selected?.entry ?? null) : null;
    const planned = planDropLink(cmds, entry, sourceId, targetId, where);
    if (planned === null) return false;
    props.onApplyLinks(target, planned);
    return true;
  }

  /** Select a block and bring it into view (run-error handoff). */
  function showBlock(id: CommandId): void {
    // Run failures name a command id; locate its owning function so the
    // canvas focuses the right container (execution is `main`-rooted
    // but callee frames report their own command ids).
    let owner: FunctionId | null = fid;
    if (
      owner === null ||
      !(program.commandsByFunction[owner] ?? []).some((c) => c.id === id)
    ) {
      owner = null;
      for (const fn of program.functions) {
        if ((program.commandsByFunction[fn.id] ?? []).some((c) => c.id === id)) {
          owner = fn.id;
          break;
        }
      }
    }
    if (owner !== null && owner !== fid) {
      props.onSelectFunction(owner);
    }
    props.onSelectCommand(id);
    if (compact) {
      setSheetOpen(true);
      return;
    }
    setInspOpen(true);
    const ownerId = owner;
    requestAnimationFrame(() => {
      const el =
        ownerId !== null
          ? document.getElementById(`vblock-${ownerId}-${id}`)
          : null;
      const fallback =
        el ?? document.getElementById(`vblock-${id}`);
      if (fallback instanceof HTMLElement && typeof fallback.scrollIntoView === "function") {
        fallback.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

  /** Canvas selection drives the inspector: select opens it,
   *  deselect (empty space or toggle) closes it again. */
  function selectCommandWithPanel(id: CommandId | null): void {
    props.onSelectCommand(id);
    if (!compact) {
      setInspOpen(id !== null);
    }
  }

  const errorNotice =
    program.actionError !== "" ? (
      <div className="notice notice-error" role="alert">
        <div className="notice-title">Something needs attention</div>
        <div>{program.actionError}</div>
        {program.recoveryVar !== null &&
        program.recoveryVar !== "" &&
        fid !== null ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: 8 }}
            disabled={program.busy}
            onClick={() =>
              props.onDeclareVariable(fid, program.recoveryVar as string)
            }
          >
            Declare &ldquo;{program.recoveryVar}&rdquo; (int32)
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          onClick={props.onDismissError}
        >
          Dismiss
        </button>
      </div>
    ) : null;

  // The runner panel opens for errors without a sync effect: visibility
  // derives during render from the manual toggle OR a live error.
  const runnerVisible = runOpen || program.actionError !== "";

  /** Block drag commit with view-undo recording. */
  const moveBlockWithHistory = useCallback(
    (target: FunctionId, id: CommandId, pos: { x: number; y: number }): void => {
      const before = layout.allPositions[target] ?? {};
      moveBlockIn(target, id, pos);
      const ctl = zoomCtlRef.current;
      const z = ctl?.getZoom() ?? 1;
      pushView(target, "Move block", before, { ...before, [id]: pos }, z, z);
    },
    [layout.allPositions, moveBlockIn, pushView],
  );

  /** Discrete zoom commit with view-undo recording. */
  const zoomSettled = useCallback(
    (before: number, after: number): void => {
      pushView(
        fid,
        "Zoom",
        { ...layout.positions },
        { ...layout.positions },
        before,
        after,
      );
    },
    [pushView, layout.positions, fid],
  );

  const leftPanel = (
    <ProjectNavigator
      functions={program.functions}
      selectedId={program.selectedId}
      busy={program.busy}
      onSelect={(id) => {
        props.onSelectFunction(id);
        setNavOpen(false);
      }}
      onDelete={props.onDeleteFunction}
      libraryBusy={program.busy || fid === null}
      onAddBlock={addLibraryBlock}
      onClearPackage={props.onClearPackage}
      onDropToCanvas={(kind, clientX, clientY) => {
        dropHandlerRef.current?.(kind, clientX, clientY);
      }}
    />
  );

  // Owning function of the reported error command, if it is still live.
  const errorFunctionId: FunctionId | null =
    program.commandErrorId === null
      ? null
      : (program.functions.find((fn) =>
          (program.commandsByFunction[fn.id] ?? []).some(
            (c) => c.id === program.commandErrorId,
          ),
        )?.id ?? fid);

  const inspector = (
    <Inspector
      func={program.selected}
      selected={selectedCommand}
      busy={program.busy}
      recoveryVar={program.recoveryVar}
      onDeclareVariable={
        fid !== null ? (name) => props.onDeclareVariable(fid, name) : undefined
      }
      onReplace={(id, draft) =>
        fid !== null ? replaceWithPosition(fid, id, draft) : undefined
      }
      onDeleteBlock={(id) => deleteBlock(id)}
      onDeleteFunction={() => {
        if (fid !== null) props.onDeleteFunction(fid);
      }}
      onClearEntry={() => {
        if (fid !== null) props.onClearEntry(fid);
      }}
    />
  );

  const runner = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {errorNotice}
      <Runner
        run={program.run}
        running={program.running}
        durationMs={program.durationMs}
        errorId={program.commandErrorId}
        busy={program.busy}
        canRun={fid !== null}
        onShowBlock={showBlock}
        onRun={props.onRun}
      />
    </div>
  );

  const undoRedoTheme = (extraClass: string): ReactElement => (
    <>
      <button
        type="button"
        className={`btn btn-ghost btn-sm icon-btn ${extraClass}`}
        disabled={!canUndoAll}
        onClick={undoAll}
        title={undoTitle}
        aria-label={undoTitle}
      >
        ⮪
      </button>
      <button
        type="button"
        className={`btn btn-ghost btn-sm icon-btn ${extraClass}`}
        disabled={!canRedoAll}
        onClick={redoAll}
        title={redoTitle}
        aria-label={redoTitle}
      >
        ⮫
      </button>
      <button
        type="button"
        className={`btn btn-ghost btn-sm icon-btn ${extraClass}`}
        aria-label={theme === "night" ? "Switch to light mode" : "Switch to night mode"}
        aria-pressed={theme === "light"}
        onClick={toggleTheme}
        title={theme === "night" ? "Light mode" : "Night mode"}
      >
        {theme === "night" ? "○" : "●"}
      </button>
    </>
  );

  return (
    <div className="shell">
      <header className="appbar">
        {compact ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm icon-btn"
            aria-label="Open blocks panel"
            onClick={() => setNavOpen(true)}
          >
            ☰
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-panel btn-sm"
            aria-label="Toggle blocks panel"
            aria-pressed={leftOpen}
            onClick={() => setLeftOpen((v) => !v)}
          >
            ☰ Blocks
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="appbar-title">Aqualotus</div>
          <div className="appbar-sub">
            {program.selected !== null
              ? breadcrumbPath(program.selected.name)
              : "Visual programming"}
          </div>
        </div>
        <div className="appbar-spacer" />
        <span
          className="status-dot"
          data-state={runtime.phase === "ready" ? "ready" : "error"}
          role="status"
          title={
            runtime.phase === "ready"
              ? `Optilotus runtime ${runtime.version || "?"} · ${runtime.health || "?"}`
              : undefined
          }
        >
          <i aria-hidden="true" />
          {runtime.phase === "ready"
            ? `${APP_NAME} ${APP_VERSION}`
            : runtime.phase === "loading"
              ? "Connecting…"
              : "Runtime unavailable"}
        </span>
        {undoRedoTheme("hide-compact")}
        {compact ? (
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSheetOpen(true)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={program.busy || program.running || fid === null}
              onClick={props.onRun}
              aria-label="Run program"
            >
              ▶
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-panel btn-sm"
              aria-label="Toggle inspector"
              aria-pressed={inspOpen}
              onClick={() => setInspOpen((v) => !v)}
            >
              Inspector ◧
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={program.busy || program.running || fid === null}
              onClick={props.onRun}
              title="Run (Ctrl/Cmd + Enter)"
            >
              ▶ Run
            </button>
          </>
        )}
      </header>

      <div className="workspace">
        <section className="pane pane-editor" aria-label="Visual editor">
          <div className="pane-head editor-head">
            {program.selected !== null ? (
              <div className="fn-header">
                <h2>{program.selected.name}()</h2>
                {program.selected.isMain ? (
                  <span className="main-badge">MAIN</span>
                ) : null}
              </div>
            ) : (
              <h2 className="pane-title">Editor</h2>
            )}
          </div>
          <div className="pane-body editor-body">
            {program.selected === null || fid === null ? (
              <div className="empty">
                <strong>No function selected</strong>
                <span>Pick a function to start editing.</span>
              </div>
            ) : (
              <VisualEditor
                functions={program.functions}
                commandsByFunction={program.commandsByFunction}
                layoutStore={layout.allPositions}
                chromeLeft={!compact && leftOpen ? 300 : 0}
                selectedFunctionId={program.selectedId}
                selectedCommandId={program.selectedCommandId}
                errorId={program.commandErrorId}
                errorFunctionId={errorFunctionId}
                busy={program.busy}
                onSelectFunction={props.onSelectFunction}
                onSelectCommand={selectCommandWithPanel}
                onReconnect={reconnect}
                onMoveBlock={moveBlockWithHistory}
                onDropBlock={(target, kind, pos) => {
                  layout.placeNextAt(pos);
                  addLibraryBlockFor(target, kind);
                }}
                onRegisterDrop={registerDrop}
                onRegisterZoom={registerZoom}
                onZoomSettled={zoomSettled}
                toolbarExtra={undoRedoTheme("")}
                onRequestLibrary={() => {
                  if (compact) {
                    setNavOpen(true);
                  } else {
                    setLeftOpen(true);
                  }
                }}
              />
            )}
          </div>
          {compact ? (
            <div className="runner-inline" aria-label="Runner">
              {runner}
            </div>
          ) : null}
        </section>

        {compact ? null : (
          <>
            {leftOpen ? (
              <aside className="pane float-left" aria-label="Library and functions">
                {leftPanel}
              </aside>
            ) : null}
            {inspOpen ? (
              <aside className="pane float-right" aria-label="Inspector">
                <div className="pane-head float-head">
                  <h2 className="pane-title">Inspector</h2>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setInspOpen(false)}
                    aria-label="Hide inspector"
                  >
                    ✕
                  </button>
                </div>
                <div className="pane-body insp-body">{inspector}</div>
              </aside>
            ) : null}
            {runnerVisible ? (
              <section className="pane float-runner" aria-label="Runner">
                <div className="pane-head float-head">
                  <h2 className="pane-title">Runner</h2>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRunOpen(false)}
                    aria-label="Collapse runner"
                  >
                    ▾
                  </button>
                </div>
                <div className="pane-body">{runner}</div>
              </section>
            ) : (
              <button
                type="button"
                className="float-pill"
                onClick={() => setRunOpen(true)}
                aria-label="Expand runner"
              >
                <span
                  className="status-dot"
                  data-state={
                    program.running
                      ? "busy"
                      : program.run === null
                        ? "idle"
                        : program.run.status === "ok"
                          ? "ready"
                          : "error"
                  }
                >
                  <i aria-hidden="true" />
                  {runnerSummary(program)}
                </span>
              </button>
            )}
          </>
        )}
      </div>

      {navVisible ? (
        <>
          <div
            className="scrim"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
          <nav className="drawer" aria-label="Blocks and functions">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h2 className="pane-title">Blocks</h2>
              <div className="appbar-spacer" />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setNavOpen(false)}
                aria-label="Close block library"
              >
                ✕
              </button>
            </div>
            <div style={{ marginBottom: 4 }}>{leftPanel}</div>
          </nav>
        </>
      ) : null}

      {sheetVisible ? (
        <>
          <div
            className="scrim"
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Inspector"
          >
            <div className="sheet-grip" aria-hidden="true" />
            {inspector}
            <button
              type="button"
              className="btn"
              style={{ marginTop: 16, width: "100%" }}
              onClick={() => setSheetOpen(false)}
            >
              Done
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
