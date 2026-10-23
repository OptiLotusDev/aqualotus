import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useInheritPosition } from "../hooks/useInheritPosition";
import { useFlowGlow } from "../hooks/useFlowGlow";
import { useLayout } from "../hooks/useLayout";
import {
  LIGHT_MODE_UNAVAILABLE_REASON,
  useTheme,
} from "../hooks/useTheme";
import type { RuntimeStatus } from "../hooks/useRuntime";
import type { ProgramSnapshot } from "../hooks/useProgram";
import type { CommandDraft } from "../lib/program";
import { declareEditAffected, freshName } from "../lib/program";
import type { LinkPlan } from "../lib/graph";
import {
  countUnconnectedBlocks,
  planChainAll,
  planDropLink,
  type BlockSide,
  type MergeJoin,
} from "../lib/graph";
import { resolveBranchConnect } from "../lib/branching";
import { findAvailableBlock } from "../lib/blocks";
import { LAYOUT_ROW_Y, LAYOUT_START_X } from "../lib/layout";
import type { CommandId, FunctionId, RunResult } from "../lib/optilotus";
import Inspector from "./Inspector";
import ProjectNavigator from "./ProjectNavigator";
import RevealText from "./RevealText";
import Runner from "./Runner";
import VisualEditor from "./VisualEditor";
import { breadcrumbPath } from "../lib/workspace";

/**
 * Displayed app version: the live engine version once the bridge is
 * ready, else the build-time version read from the engine's
 * `Cargo.toml` — a `Cargo.toml` bump reaches the pill with no UI edit.
 */
function displayVersion(runtimeVersion: string): string {
  if (runtimeVersion !== "") return runtimeVersion;
  try {
    return __OPTILOTUS_VERSION__;
  } catch {
    return "?";
  }
}
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
  readonly onRenameFunction: (id: FunctionId, name: string) => void;
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
  /** Wire a block to an `if` branch (then/else port drop). */
  readonly onAppendIfBranch: (
    fid: FunctionId,
    ifId: CommandId,
    branch: "then" | "else",
    targetId: CommandId,
  ) => boolean;
  /** The expression an `if`'s condition was built from (null on error). */
  readonly onConditionText: (fid: FunctionId, ifId: CommandId) => string | null;
  readonly onClearEntry: (fid: FunctionId) => void;
  readonly onClearPackage: () => void;
  readonly onRun: () => void;
  readonly onDismissError: () => void;
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

/** Compact runner pill dot state for the collapsed dock. */
function pillState(running: boolean, run: RunResult | null): string {
  if (running) return "busy";
  if (run === null) return "idle";
  return run.status === "ok" ? "ready" : "error";
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
  const { runtime, program } = props;
  const compact = useIsMobile();
  const { theme, toggle: toggleTheme, lightModeAvailable } = useTheme();
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [leftOpen, setLeftOpen] = useState<boolean>(false);
  const [inspOpen, setInspOpen] = useState<boolean>(false);
  const [runOpen, setRunOpen] = useState<boolean>(false);
  // Runs shelved by the collapse arrow: the panel stays hidden for this
  // exact result until a new run arrives. Without this, auto-opening the
  // panel on every run would make the ▾ collapse button a no-op.
  const [shelvedRun, setShelvedRun] = useState<RunResult | null>(null);
  // Execution-flow visualisation: the run action freezes the executed
  // chain and the canvas animates it. The engine call is untouched.
  const { flow, startFlow } = useFlowGlow(program);

  const fid = program.selectedId;
  const commandIds = useMemo(
    () => program.commands.map((c) => c.id),
    [program.commands],
  );
  // Block positions are relative to their function container (the
  // hierarchy owns world layout), so auto-placement chains blocks in a
  // horizontal row matching the left → right ports.
  const layout = useLayout(fid, commandIds, LAYOUT_START_X, LAYOUT_ROW_Y);
  const { moveBlockIn } = layout;

  // Edited blocks keep their position: Apply-edit recreates the command
  // under a fresh id, and the capture below hands the old position to
  // the newcomer once it appears in the refreshed projection. Undo/redo
  // recreations (fresh ids too) reclaim their remembered spot via the
  // armed restore in `undoAll`/`redoAll` below.
  const { capturePositions, armRestore } = useInheritPosition(
    program.commandsByFunction,
    program.busy,
    moveBlockIn,
    layout.allPositions,
  );

  /** Apply-edit wrapper that preserves the edited blocks' positions. */
  function replaceWithPosition(
    target: FunctionId,
    oldId: CommandId,
    draft: CommandDraft,
  ): void {
    const cmds = program.commandsByFunction[target] ?? [];
    // A declare type/name edit also rebuilds its dependent assigns (same
    // variable: their engine types must follow the declaration), so every
    // affected block hands its spot to its own recreation, in order.
    const oldCmd = cmds.find((c) => c.id === oldId) ?? null;
    // A declare-to-declare edit recreates exactly `declareEditAffected`
    // (the declare, its bound assigns, ref-holding blocks on rename), so
    // capture spots for that same set, in command order. Anything not
    // recreated simply never consumes its spot.
    const affectedIds =
      oldCmd !== null &&
      oldCmd.kind === "declare" &&
      draft.kind === "declare"
        ? declareEditAffected(cmds, oldId, draft.name)
        : cmds.some((c) => c.id === oldId)
          ? [oldId]
          : [];
    const allPos = layout.allPositions[target] ?? {};
    capturePositions(
      target,
      affectedIds.map(
        (id) => allPos[id] ?? { x: LAYOUT_START_X, y: LAYOUT_ROW_Y },
      ),
      cmds.map((c) => c.id),
    );
    props.onReplaceCommand(target, oldId, draft);
  }

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

  // Undo/redo is blocks-only: layout drags, pan, and zoom are visual
  // state with no undo entries — the buttons replay semantic history
  // (add / delete / edit / rewire) and nothing else.
  const undoAll = useCallback((): void => {
    // Semantic undo recreates blocks under fresh ids: arm the position
    // memory so the restored block reappears where it was, not at the
    // row end.
    armRestore();
    props.onUndo();
  }, [props, armRestore]);

  const redoAll = useCallback((): void => {
    armRestore();
    props.onRedo();
  }, [props, armRestore]);

  const canUndoAll = props.canUndo;
  const canRedoAll = props.canRedo;
  const undoTitle =
    props.undoLabel !== null ? `Undo ${props.undoLabel}` : "Nothing to undo";
  const redoTitle =
    props.redoLabel !== null ? `Redo ${props.redoLabel}` : "Nothing to redo";

  /**
   * Run the program and start the flow visualisation. The engine call
   * is unchanged — the flow only reads the graph it already produced.
   */
  const runAll = useCallback((): void => {
    startFlow();
    props.onRun();
  }, [props, startFlow]);

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
        runAll();
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
  }, [props, fid, program.selectedCommandId, undoAll, redoAll, deleteBlock, runAll]);

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
    // a literal template, and a neutral return value. Assigns and calls
    // target the most recently declared variable (the one the user most
    // likely just created); otherwise the runtime error names the fix
    // ("declare it first"). The bridge still validates everything; the
    // inspector refines afterwards.
    const targetCommands =
      target === fid ? program.commands : (program.commandsByFunction[target] ?? []);
    const taken = targetCommands.flatMap((c) =>
      c.var === undefined ? [] : [c.var],
    );
    const lastVar =
      [...targetCommands].reverse().find((c) => c.kind === "declare")?.var ??
      null;
    const draft = def.draft;
    let filled: CommandDraft = draft;
    if (draft.kind === "declare") {
      filled = { ...draft, name: freshName(taken, "x") };
    } else if (draft.kind === "assign") {
      // Calls target the most recently declared variable (the callee
      // name is edited in the inspector); plain assigns keep a typed
      // name.
      const name =
        def.kind === "call"
          ? (lastVar ?? "result")
          : draft.name !== ""
            ? draft.name
            : (lastVar ?? "x");
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
  // Shelved-run state (above) and the manual merge-join state of the
  // If/Else boards: which `if` shows the "End of If Block" join point
  // and where the user dragged it. Function-container coordinates,
  // keyed by the globally unique `if` id. UI state only — never engine
  // semantics, never history: toggling and dragging are immediately
  // presentation, so undo/redo of the program leaves them alone.
  const [mergeJoins, setMergeJoins] = useState<Record<number, MergeJoin>>({});

  /** Toggle an `if`'s join point; repeated activation is idempotent. */
  function setMergeJoin(ifId: CommandId, next: MergeJoin): void {
    setMergeJoins((prev) => {
      const before = prev[ifId];
      if (
        before !== undefined &&
        before.on === next.on &&
        before.pos?.x === next.pos?.x &&
        before.pos?.y === next.pos?.y
      ) {
        return prev;
      }
      return { ...prev, [ifId]: next };
    });
  }

  function reconnect(
    target: FunctionId,
    sourceId: CommandId,
    targetId: CommandId | null,
    where: "after" | "before" | "end",
    side?: BlockSide,
  ): boolean {
    // Branch wiring for an `if` works from both ends of the wire:
    // - dragging from one of the if's bottom TRUE/FALSE ports (side =
    //   the dragged port) appends the drop target into that branch of
    //   the source `if`;
    // - releasing a wire inside a TRUE/FALSE body frame (target =
    //   that `if`) appends the dragged block into that branch.
    // The engine call decides what actually happens: a branch can hold
    // plain compute commands only, so wiring an `if` (else-if chains,
    // nesting) or a `return` is rejected honestly right here.
    if (targetId !== null && (side === "then" || side === "else")) {
      const cmds = program.commandsByFunction[target] ?? [];
      const sourceCmd = cmds.find((c) => c.id === sourceId);
      if (sourceCmd?.kind === "if") {
        return props.onAppendIfBranch(target, sourceId, side, targetId);
      }
      const targetCmd = cmds.find((c) => c.id === targetId);
      if (targetCmd?.kind === "if") {
        return props.onAppendIfBranch(target, targetId, side, sourceId);
      }
    }
    const cmds = program.commandsByFunction[target] ?? [];
    // Branch membership resolution (see `lib/branching.ts`): a wire
    // whose source runs inside a branch appends the drop target into
    // that same branch (auto branch membership) instead of re-splicing
    // the chain, and a drop on a member is refused with the planner
    // that would fabricate a second predecessor.
    const resolved = resolveBranchConnect(cmds, sourceId, targetId);
    if (resolved.kind === "reject") return false;
    if (resolved.kind === "append") {
      if (targetId === null) return false;
      return props.onAppendIfBranch(
        target,
        resolved.ifId,
        resolved.branch,
        targetId,
      );
    }
    const entry = target === fid ? program.entry : null;
    const planned = planDropLink(cmds, entry, sourceId, targetId, where);
    if (planned === null) return false;
    props.onApplyLinks(target, planned);
    return true;
  }

  /** One-click wiring: chain every block head-to-tail in list order and
   * establish the entry point, so a canvas of orphan blocks becomes
   * runnable without hand-dragging every wire. No-op when there is
   * nothing to connect. */
  function connectInOrder(): void {
    if (fid === null) return;
    const cmds = program.commandsByFunction[fid] ?? [];
    const entry = program.entry;
    // The full summaries are passed (not just id/next): the planner
    // skips the commands that belong to an `if` branch, because the
    // engine runs those from the `if` itself.
    const planned = planChainAll(
      cmds.map((c) => ({
        id: c.id,
        next: c.next ?? null,
        then_body: c.then_body,
        else_body: c.else_body,
      })),
      entry,
    );
    if (planned === null) return;
    props.onApplyLinks(fid, planned);
  }

  /** Select a block and bring it into view (run-error handoff). */
  function showBlock(id: CommandId): void {
    // The runner hands over a **resolved** target, but the graph may
    // have changed between the failure and the click (the block was
    // deleted, or the program was reset). Only a block the canvas
    // really knows can be shown — a stale id must not become a
    // selection that leads nowhere.
    const owner = ownerOf(id);
    if (owner === null) return;
    if (owner !== fid) {
      props.onSelectFunction(owner);
    }
    props.onSelectCommand(id);
    if (compact) {
      setSheetOpen(true);
      return;
    }
    setInspOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(`vblock-${owner}-${id}`);
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

  // The runner panel opens for errors AND for runs without a sync
  // effect: visibility derives during render from the manual toggle, a
  // live error, or an unshelved run result (a successful run must show
  // its printed output, while the ▾ arrow can still shelve it away
  // until the next run).
  const runnerVisible =
    runOpen ||
    program.running ||
    (program.run !== null && program.run !== shelvedRun) ||
    program.actionError !== "";

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
      onRenameFunction={props.onRenameFunction}
      libraryBusy={program.busy || fid === null}
      onAddBlock={addLibraryBlock}
      onClearPackage={props.onClearPackage}
      onDropToCanvas={(kind, clientX, clientY) => {
        dropHandlerRef.current?.(kind, clientX, clientY);
      }}
    />
  );

  /**
   * The function that owns a block id — or `null` when no block has it.
   *
   * A failure inside a called helper is reported with a node id of the
   * helper, so the owner is looked up across **all** functions, not
   * just the selected one.
   */
  function ownerOf(blockId: CommandId | null): FunctionId | null {
    if (blockId === null) return null;
    for (const fn of program.functions) {
      if ((program.commandsByFunction[fn.id] ?? []).some((c) => c.id === blockId)) {
        return fn.id;
      }
    }
    return null;
  }

  /**
   * The block the current failure points at, and the function that
   * owns it.
   *
   * The projection resolved the engine's internal node id against the
   * visible graph, so `errorBlockId` is never a hidden node. It is
   * checked against the graph **again** here: a target whose block was
   * deleted since the failure must not keep a navigation button or a
   * highlight. A failure that resolves to nothing highlights no block
   * at all rather than an arbitrary one.
   */
  const errorTargetExists =
    program.errorBlockId !== null &&
    program.errorFunctionId !== null &&
    (program.commandsByFunction[program.errorFunctionId] ?? []).some(
      (c) => c.id === program.errorBlockId,
    );
  const errorBlockId: CommandId | null = errorTargetExists
    ? program.errorBlockId
    : null;
  const errorFunctionId: FunctionId | null = errorTargetExists
    ? program.errorFunctionId
    : null;

  const inspector = (
    <Inspector
      func={program.selected}
      entry={program.entry}
      selected={selectedCommand}
      busy={program.busy}
      recoveryVar={program.recoveryVar}
      onDeclareVariable={
        fid !== null ? (name) => props.onDeclareVariable(fid, name) : undefined
      }
      onReplace={(id, draft) =>
        fid !== null ? replaceWithPosition(fid, id, draft) : undefined
      }
      commands={program.commands}
      onConditionText={(ifId) =>
        fid !== null ? props.onConditionText(fid, ifId) : null
      }
      onDeleteBlock={(id) => deleteBlock(id)}
      onDeleteFunction={() => {
        if (fid !== null) props.onDeleteFunction(fid);
      }}
      onClearEntry={() => {
        if (fid !== null) props.onClearEntry(fid);
      }}
      onRenameFunction={(name) => {
        if (fid !== null) props.onRenameFunction(fid, name);
      }}
      merge={
        selectedCommand?.kind === "if" && fid !== null
          ? {
              on: mergeJoins[selectedCommand.id]?.on === true,
              onToggle: (on: boolean) => {
                const before = mergeJoins[selectedCommand.id];
                setMergeJoin(selectedCommand.id, {
                  on,
                  pos: before?.pos ?? null,
                });
                // Unmerge is atomic: the join circle goes away **and**
                // the branch flow's continuation detaches — the merge
                // wires exist only where the join does, so leaving the
                // engine's `if.next` attached would draw a continuation
                // the "Unmerge branches" action just removed. The detach
                // is an undoable "Rewire blocks" step; the block that
                // used to run after the `if` stays on canvas (an orphan,
                // ready to be re-wired anyway the user wants).
                if (!on && (selectedCommand.next ?? null) !== null) {
                  props.onApplyLinks(fid, {
                    edits: [{ id: selectedCommand.id, next: null }],
                    entry: { type: "keep" },
                  });
                }
              },
            }
          : undefined
      }
    />
  );

  // Blocks outside the entry chain never execute: with several
  // disconnected rows only the connected chain prints, and with no entry
  // point the run is a flat no-op. Offer one-click wiring in list order
  // instead of leaving users to discover port-dragging.
  //
  // The walk follows the **logical** chain: the engine's own `next`
  // edges plus the connections the UI planned and the engine accepted
  // but cannot report (the edge into an `if`, whose hidden condition
  // compute hides it — see `lib/graph.ts`). Without those, a connected
  // `if` was counted as an orphan.
  const entry = program.entry;
  // Blocks the engine runs *from* an `if` (its branch members) are not
  // orphans: the `if` executes them. The walk itself lives in
  // `lib/graph.ts` (`countUnconnectedBlocks`) so the counting is a pure,
  // engine-mirroring projection with no second semantics — the same
  // function both the notice and the tests read.
  const { orphans } = countUnconnectedBlocks(program.commands, entry);
  const orphanCount = orphans;
  const entryNotice =
    fid !== null &&
    program.selected !== null &&
    orphanCount > 0 &&
    !program.running ? (
      <div className="notice" role="status">
        <div className="notice-title">
          {entry === null
            ? "Blocks aren't connected"
            : `${orphanCount} of ${program.commands.length} blocks aren't connected`}
        </div>
        <div>
          {entry === null
            ? "No entry point — the blocks run in list order once connected."
            : "Only the connected chain runs — the rest never print."}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ marginTop: 8 }}
          disabled={program.busy}
          onClick={connectInOrder}
        >
          Connect blocks in order
        </button>
      </div>
    ) : null;

  const runner = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {errorNotice}
      {entryNotice}
      <Runner
        run={program.run}
        running={program.running}
        durationMs={program.durationMs}
        errorId={errorBlockId}
        busy={program.busy}
        canRun={fid !== null}
        onShowBlock={showBlock}
        onRun={runAll}
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
        aria-label={
          lightModeAvailable
            ? theme === "night"
              ? "Switch to light mode"
              : "Switch to night mode"
            : LIGHT_MODE_UNAVAILABLE_REASON
        }
        aria-pressed={theme === "light"}
        aria-disabled={lightModeAvailable ? undefined : true}
        disabled={!lightModeAvailable}
        onClick={toggleTheme}
        title={
          lightModeAvailable
            ? theme === "night"
              ? "Light mode"
              : "Night mode"
            : LIGHT_MODE_UNAVAILABLE_REASON
        }
      >
        {theme === "night" ? "○" : "●"}
      </button>
    </>
  );

  return (
    <div className="shell">
      <header className="appbar enter-down enter-delay-toolbar">
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
          <div className="appbar-title">
            Aqualotus <span className="appbar-version">v{__AQUALOTUS_VERSION__}</span>
          </div>
          <div className="appbar-sub">
            <RevealText
              text={
                program.selected !== null
                  ? breadcrumbPath(program.selected.name)
                  : "Visual programming"
              }
              delay={1150}
              stagger={45}
            />
          </div>
        </div>
        <div className="appbar-spacer" />
        <span
          className="status-dot enter-up enter-delay-status"
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
            ? `${APP_NAME} ${displayVersion(runtime.version)}`
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
              className="btn btn-primary btn-sm enter-up enter-delay-action"
              disabled={program.busy || program.running || fid === null}
              onClick={runAll}
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
              className="btn btn-primary btn-sm enter-up enter-delay-action"
              disabled={program.busy || program.running || fid === null}
              onClick={runAll}
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
                <h2 className="enter-up enter-delay-heading">
                  {program.selected.name}()
                </h2>
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
                selectedFunctionId={program.selectedId}
                selectedCommandId={program.selectedCommandId}
                errorId={errorBlockId}
                errorFunctionId={errorFunctionId}
                busy={program.busy}
                onSelectFunction={props.onSelectFunction}
                onSelectCommand={selectCommandWithPanel}
                onReconnect={reconnect}
                onMoveBlock={moveBlockIn}
                mergeJoins={mergeJoins}
                onMoveJoin={(ifId, pos) => {
                  setMergeJoin(ifId, { on: true, pos });
                }}
                onDropBlock={(target, kind, pos) => {
                  layout.placeNextAt(pos);
                  addLibraryBlockFor(target, kind);
                }}
                onRegisterDrop={registerDrop}
                onRegisterZoom={registerZoom}
                conditionTextFor={props.onConditionText}
                flow={flow}
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
              <aside
                className="pane float-left enter-panel"
                aria-label="Library and functions"
              >
                {leftPanel}
              </aside>
            ) : null}
            {inspOpen ? (
              <aside
                className="pane float-right enter-panel"
                aria-label="Inspector"
              >
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
              <section
                className="pane float-runner enter-panel"
                aria-label="Runner"
              >
                <div className="pane-head float-head">
                  <h2 className="pane-title">Runner</h2>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setShelvedRun(program.run);
                      setRunOpen(false);
                    }}
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
                className="float-pill enter-up enter-delay-meta"
                onClick={() => setRunOpen(true)}
                aria-label="Expand runner"
              >
                <span
                  className="status-dot"
                  data-state={pillState(program.running, program.run)}
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
