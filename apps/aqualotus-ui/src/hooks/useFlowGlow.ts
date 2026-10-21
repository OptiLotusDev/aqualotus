import { useCallback, useEffect, useRef, useState } from "react";
import type { ProgramSnapshot } from "./useProgram";
import { optilotus_getFunction } from "../lib/optilotus";
import {
  chainEdges,
  flowDuration,
  flowTimings,
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

/**
 * Owns the execution-flow visualisation (P10): presentation state only,
 * kept out of the program model and the run result.
 *
 * A run freezes the connections of the chain the engine walks — `main`'s
 * entry chain — and animates them in that order. The snapshot is taken
 * when the run starts, so an edit made afterwards can never make an
 * unrelated connection glow. The sweep is bounded: it ends with the
 * last segment and the snapshot is dropped.
 */
export function useFlowGlow(program: ProgramSnapshot): {
  readonly flow: FlowState | null;
  readonly startFlow: () => void;
} {
  const [flow, setFlow] = useState<FlowState | null>(null);
  const runIdRef = useRef<number>(0);
  const programRef = useRef<ProgramSnapshot>(program);

  // Keep the latest snapshot for the run handler (an event callback,
  // never a render-time read).
  useEffect(() => {
    programRef.current = program;
  }, [program]);

  /** Freeze the executed chain and start the sweep. */
  const startFlow = useCallback((): void => {
    const snapshot = programRef.current;
    const main = snapshot.functions.find((fn) => fn.isMain);
    if (main === undefined) {
      setFlow(null);
      return;
    }
    const cmds = snapshot.commandsByFunction[main.id] ?? [];
    const edges = chainEdges(cmds, entryOf(main.id), main.id);
    if (edges.length === 0) {
      setFlow(null);
      return;
    }
    const { segmentMs, staggerMs } = flowTimings(edges.length);
    runIdRef.current += 1;
    setFlow({ runId: runIdRef.current, edges, segmentMs, staggerMs });
  }, []);

  // Drop the snapshot once the sweep is over: the connections are back
  // to their normal appearance and nothing is left animating.
  useEffect(() => {
    if (flow === null) return;
    const timer = window.setTimeout(() => {
      setFlow((prev) => (prev !== null && prev.runId === flow.runId ? null : prev));
    }, flowDuration(flow));
    return () => window.clearTimeout(timer);
  }, [flow]);

  // A failed run stops at the command the engine blamed: the
  // connections up to it ran, the ones after it did not.
  const visible =
    flow === null || program.commandErrorId === null
      ? flow
      : truncateFlow(flow, program.commandErrorId);
  return { flow: visible, startFlow };
}
