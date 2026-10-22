import { useCallback, useEffect, useRef, useState } from "react";
import type { ProgramSnapshot } from "./useProgram";
import { optilotus_getFunction } from "../lib/optilotus";
import { resolveEntry } from "../lib/graph";
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
    // The engine's entry can point at a hidden node (an `if`'s condition
    // compute): resolve it to the block the chain starts at. The chain
    // itself is the logical one (the engine's `next` edges plus the
    // connections the engine accepted but cannot report), so the glow
    // travels into an `if` exactly like the runtime runs it.
    const edges = chainEdges(
      cmds,
      resolveEntry(cmds, entryOf(main.id)),
      main.id,
    );
    if (edges.length === 0) {
      setFlow(null);
      return;
    }
    const { linkMs } = flowTimings(edges.length);
    runIdRef.current += 1;
    setFlow({ runId: runIdRef.current, edges, linkMs });
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

  // A failed run stops at the block the failure points at: the
  // connections up to it ran, the ones after it did not.
  //
  // The target is the **resolved visible block** (`errorBlockId`), not
  // the id the engine reported: the engine names the internal node
  // that failed, which is often a hidden node the animation must never
  // stop at. A failure that resolves to no block leaves the sweep
  // alone — stopping it at an invented position would be a lie.
  const visible =
    flow === null || program.errorBlockId === null
      ? flow
      : truncateFlow(flow, program.errorBlockId);
  return { flow: visible, startFlow };
}
