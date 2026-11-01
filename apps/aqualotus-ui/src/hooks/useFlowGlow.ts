import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ProgramSnapshot } from "./useProgram";
import type { CommandSummary } from "../lib/optilotus";
import { optilotus_getFunction, optilotus_if_condition } from "../lib/optilotus";
import { isOptilotusError } from "../lib/program";
import { resolveEntry } from "../lib/graph";
import {
  flowDuration,
  flowTimings,
  branchHintsForPause,
  resolveRunPath,
  truncateFlow,
  type BranchSide,
  type FlowState,
} from "../lib/flow";

/** The engine's entry command of a function, read from the engine (read-only). */
function entryOf(fid: number): number | null {
  try {
    const info = optilotus_getFunction(fid);
    return info.status === "ok" ? info.entry : null;
  } catch {
    // The runtime is not ready (or the call failed): no chain, no glow.
    return null;
  }
}

/** Infer the entry for visualization when the engine doesn't report one.
 * The engine runs from the first command by default, but may not report
 * the entry explicitly. For flow visualization we mirror this default. */
function inferEntry(cmds: readonly CommandSummary[]): number | null {
  if (cmds.length === 0) return null;
  return cmds[0].id;
}

/** The graph the run froze at its start: uneditable by later edits. */
interface FrozenRun {
  readonly runId: number;
  readonly fid: number;
  readonly cmds: readonly CommandSummary[];
  readonly entry: number | null;
  /**
   * Literal conditions (`"true"` / `"false"` exactly) the engine
   * reported per `if`, read at the same freeze — the tie-break the
   * envelope needs when both branches print identical lines.
   */
  readonly literals: ReadonlyMap<number, boolean>;
  /**
   * Which sides the run's own pauses proved (`ifId → side`), engine
   * truth from every input command the run reached inside a branch.
   * Kept across the whole run so the pause walk and the final envelope
   * walk make the same decisions.
   */
  readonly hints: ReadonlyMap<number, BranchSide>;
  /** The input command the run waits on right now, `null` otherwise. */
  readonly pauseCommand: number | null;
  /**
   * The input command the run last reached. Kept after the wait ends so
   * a cancelled or cleared session can terminate the sweep at the block
   * the engine actually stopped at, never past it.
   */
  readonly lastStopCommand: number | null;
}

/**
 * Owns the execution-flow visualisation (P10): presentation state only,
 * kept out of the program model and the run result.
 *
 * A run freezes the graph the engine walks — `main`'s snapshot plus its
 * resolved entry — the moment the run starts, so an edit made
 * afterwards can never make an unrelated connection glow. The travelled
 * connections are then **derived from the run's own envelope** (see
 * `resolveRunPath`): the sweep starts as the chain the engine walks and,
 * where the engine's output proves a branch was taken, follows that
 * branch and its merge — never an `if` both ways. Literal conditions are
 * read from the engine itself at the same moment, so the one case the
 * envelope cannot decide (identical branch prints) still follows what
 * the engine's own condition states. A failed run stops at the block the
 * failure resolves to. The sweep is bounded: it ends with the last
 * segment and the freeze is dropped.
 *
 * Resumable runs: the engine pauses at an `input` command and reports it
 * (`pendingInput`). The walk then ends at the connection that enters that
 * input block (`flow.pause`) — execution stops there, before the block —
 * and the indicator stands at its entry side for as long as the run
 * waits. Nothing else has run, so nothing past the input travels: not on
 * the wait's first frame, not after any number of animation frames, and
 * not via any other timer. A pause inside an `if` branch proves the
 * branch was taken (the engine is sitting in it),
 * `branchHintsForPause`; the proof is kept for the run so the wait's
 * walk and the final envelope walk decide the same branches. When the
 * input is accepted the same sweep continues: the connection out of the
 * input travels with the same rhythm, as if the pause never occurred.
 * When the wait ends in a failure or a cancellation, the sweep ends at
 * the input command the engine had reached — the same way it ends at the
 * block a failure resolves to.
 */
export function useFlowGlow(program: ProgramSnapshot): {
  readonly flow: FlowState | null;
  readonly startFlow: () => void;
} {
  const [frozen, setFrozen] = useState<FrozenRun | null>(null);
  const runIdRef = useRef<number>(0);
  const programRef = useRef<ProgramSnapshot>(program);

  // Keep the latest snapshot for the run handler (an event callback,
  // never a render-time read).
  useEffect(() => {
    programRef.current = program;
  }, [program]);

  /** Freeze the walked graph and its run id; the sweep derives later. */
const startFlow = useCallback((): void => {
    const snapshot = programRef.current;
    const main = snapshot.functions.find((fn) => fn.isMain);
    if (main === undefined) {
      setFrozen(null);
      return;
    }
    const cmds = snapshot.commandsByFunction[main.id] ?? [];
    // Literal conditions, read from the engine at the same freeze:
    // exactly `"true"` / `"false"` — nothing folded, nothing guessed.
    const literals = new Map<number, boolean>();
    for (const cmd of cmds) {
      if (cmd.kind !== "if") continue;
      try {
        const condition = optilotus_if_condition(main.id, cmd.id);
        if (isOptilotusError(condition)) continue;
        if (condition.expr === "true") literals.set(cmd.id, true);
        else if (condition.expr === "false") literals.set(cmd.id, false);
      } catch {
        // The bridge is unavailable: the envelope decides alone.
      }
    }
    // The engine's entry can point at a hidden node (an `if`'s condition
    // compute): resolve it to the block the chain starts at.
    // If the engine doesn't report an entry, infer it for visualization.
    const engineEntry = entryOf(main.id);
    const entry = engineEntry !== null
      ? resolveEntry(cmds, engineEntry)
      : inferEntry(cmds);
    runIdRef.current += 1;
    setFrozen({
      runId: runIdRef.current,
      fid: main.id,
      cmds,
      entry,
      literals,
      // A fresh run decides its branches from its own pauses only: the
      // previous run's branch truths never leak into a new sweep.
      hints: new Map(),
      pauseCommand: null,
      lastStopCommand: null,
    });
  }, []);

  // The run's own pause lifecycle, read off the engine's status: a
  // waiting session carries the input command it paused on
  // (`pendingInput`), and every pause proves which branch took it when
  // the command sits inside one. The freeze is the run's picture of
  // the engine — synced after the snapshot so the corrected walk paints
  // together with the state that caused it.
  useLayoutEffect(() => {
    setFrozen((prev) => {
      if (prev === null) return null;
      const pauseCommand = program.pendingInput?.command ?? null;
      if (pauseCommand === null) {
        if (prev.pauseCommand === null) return prev;
        // The wait ended (the input was accepted and the run went on,
        // finished, or failed — or the session was cancelled): engine
        // truth past the input stays in the walk (`lastStopCommand`,
        // `hints`).
        return { ...prev, pauseCommand: null };
      }
      if (prev.pauseCommand === pauseCommand) return prev;
      const hints = new Map(prev.hints);
      for (const [ifId, side] of branchHintsForPause(prev.cmds, pauseCommand)) {
        hints.set(ifId, side);
      }
      return { ...prev, pauseCommand, lastStopCommand: pauseCommand, hints };
    });
  }, [program.pendingInput]);

  // The travelled connections derive from the frozen graph and the run
  // the user just started. The bridge runs synchronously, so the first
  // render after the run already carries the finished envelope; if a
  // run is still pending (`run === null`), the sweep shows the chain and
  // the resolver's undecided-`if` path until the result lands.
  const flow = useMemo((): FlowState | null => {
    if (frozen === null) return null;
    const pause = program.pendingInput?.command ?? null;
    // A run that ended without an envelope and without a failure was
    // cancelled or cleared by the user, or the bridge threw mid-session:
    // the sweep stops at the input command the engine had reached, and
    // travels no execution that never happened.
    const terminal =
      pause === null &&
      program.run === null &&
      program.error === null &&
      program.running === false
        ? frozen.lastStopCommand
        : null;
    const printed =
      program.run?.status === "ok" ? program.run.printed : ([] as const);
    const edges = resolveRunPath(
      frozen.cmds,
      frozen.entry,
      frozen.fid,
      printed,
      frozen.literals,
      pause ?? terminal,
      frozen.hints,
    );
    if (edges.length === 0) return null;
    const { linkMs } = flowTimings(edges.length);
    let state: FlowState = {
      runId: frozen.runId,
      edges,
      linkMs,
      pause,
    };
    // A failed run stops at the block the failure resolves to (see
    // `truncateFlow`): the connections up to it ran, the ones after it
    // did not. An unresolved failure leaves the sweep alone — stopping
    // it at an invented position would be a lie.
    if (program.errorBlockId !== null) {
      state = truncateFlow(state, program.errorBlockId);
    }
    return state;
  }, [
    frozen,
    program.run,
    program.errorBlockId,
    program.pendingInput,
    program.error,
    program.running,
  ]);

  // Drop the freeze once the sweep is over: the connections are back
  // to their normal appearance and nothing is left animating. While the
  // run waits for input nothing is wound down: the sweep stays paused
  // exactly as long as the engine is, however long the user takes.
  useEffect(() => {
    if (flow === null) return;
    if (flow.pause !== null) return;
    // Ensure a minimum visible duration so the sweep is perceptible even
    // for very short chains. The design guide specifies 300ms per link,
    // but we enforce a floor of 1500ms total to account for the time
    // between startFlow() and the first paint of the travelling dot.
    const minDuration = 1500;
    const duration = Math.max(flowDuration(flow), minDuration);
    const timer = window.setTimeout(() => {
      setFrozen((prev) =>
        prev !== null && prev.runId === flow.runId ? null : prev,
      );
    }, duration);
    return () => window.clearTimeout(timer);
  }, [flow]);

  return { flow, startFlow };
}
