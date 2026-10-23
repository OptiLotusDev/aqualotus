import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSnapshot } from "./useProgram";
import type { CommandSummary } from "../lib/optilotus";
import { optilotus_getFunction, optilotus_if_condition } from "../lib/optilotus";
import { isOptilotusError } from "../lib/program";
import { resolveEntry } from "../lib/graph";
import {
  flowDuration,
  flowTimings,
  resolveRunPath,
  truncateFlow,
  type FlowState,
} from "../lib/flow";

/** Entry command of a function, read from the engine (read-only). */
function entryOf(fid: number): number | null {
  try {
    const info = optilotus_getFunction(fid);
    return info.status === "ok" ? info.entry : null;
  } catch {
    // The runtime is not ready (or the call failed): no chain, no glow.
    return null;
  }
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
    runIdRef.current += 1;
    setFrozen({
      runId: runIdRef.current,
      fid: main.id,
      cmds,
      entry: resolveEntry(cmds, entryOf(main.id)),
      literals,
    });
  }, []);

  // The travelled connections derive from the frozen graph and the run
  // the user just started. The bridge runs synchronously, so the first
  // render after the run already carries the finished envelope; if a
  // run is still pending (`run === null`), the sweep shows the chain and
  // the resolver's undecided-`if` path until the result lands.
  const flow = useMemo((): FlowState | null => {
    if (frozen === null) return null;
    const printed =
      program.run?.status === "ok" ? program.run.printed : ([] as const);
    const edges = resolveRunPath(
      frozen.cmds,
      frozen.entry,
      frozen.fid,
      printed,
      frozen.literals,
    );
    if (edges.length === 0) return null;
    const { linkMs } = flowTimings(edges.length);
    let state: FlowState = { runId: frozen.runId, edges, linkMs };
    // A failed run stops at the block the failure resolves to (see
    // `truncateFlow`): the connections up to it ran, the ones after it
    // did not. An unresolved failure leaves the sweep alone — stopping
    // it at an invented position would be a lie.
    if (program.errorBlockId !== null) {
      state = truncateFlow(state, program.errorBlockId);
    }
    return state;
  }, [frozen, program.run, program.errorBlockId]);

  // Drop the freeze once the sweep is over: the connections are back
  // to their normal appearance and nothing is left animating.
  useEffect(() => {
    if (flow === null) return;
    const timer = window.setTimeout(() => {
      setFrozen((prev) =>
        prev !== null && prev.runId === flow.runId ? null : prev,
      );
    }, flowDuration(flow));
    return () => window.clearTimeout(timer);
  }, [flow]);

  return { flow, startFlow };
}
