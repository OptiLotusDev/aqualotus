import type { CSSProperties } from "react";
import type { CommandSummary } from "./optilotus";

/** Style bag that also carries CSS custom properties. */
export type FlowStyle = CSSProperties & Record<`--${string}`, string | number>;

/**
 * Execution-flow visualisation model (presentation only).
 *
 * The engine runs `main` and walks its `next` chain from the entry
 * command, one command at a time. That chain is the only execution
 * order the UI can state truthfully: there is no per-step trace in the
 * bridge, so the flow view animates the connections of that chain and
 * nothing else. Blocks inside called functions are not animated — the
 * UI cannot know whether or when a callee ran.
 */

/** One connection of the executed chain. */
export interface FlowEdge {
  /** Function the connection belongs to. */
  readonly fid: number;
  /** Source command id. */
  readonly from: number;
  /** Target command id. */
  readonly to: number;
}

/** A running flow visualisation. */
export interface FlowState {
  /** Bumped per run so the animation restarts instead of stacking. */
  readonly runId: number;
  /** Connections to glow, in execution order. */
  readonly edges: readonly FlowEdge[];
  /** Travel time of one glow segment, in milliseconds. */
  readonly segmentMs: number;
  /** Delay between two consecutive segments, in milliseconds. */
  readonly staggerMs: number;
}

/** Travel time of a single glow along one connection. */
export const FLOW_SEGMENT_MS = 220;

/** Upper bound for the whole sweep, so long chains stay responsive. */
export const FLOW_MAX_SWEEP_MS = 1800;

/** Tightest stagger between two segments: long chains overlap. */
const FLOW_MIN_STAGGER_MS = 45;

/**
 * Connections of the chain that starts at `entry`, in execution order.
 * Cycle-safe: a malformed graph stops the walk instead of hanging.
 */
export function chainEdges(
  cmds: readonly CommandSummary[],
  entry: number | null,
  fid: number,
): readonly FlowEdge[] {
  if (entry === null) return [];
  const byId = new Map<number, CommandSummary>();
  for (const cmd of cmds) byId.set(cmd.id, cmd);

  const edges: FlowEdge[] = [];
  const seen = new Set<number>();
  let current: number | null = entry;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const cmd = byId.get(current);
    if (cmd === undefined) break;
    const next = cmd.next;
    if (next === null || next === undefined) break;
    if (!byId.has(next)) break;
    edges.push({ fid, from: cmd.id, to: next });
    current = next;
  }
  return edges;
}

/**
 * Segment timing. The travel time per connection stays constant; the
 * stagger between connections shrinks for long chains, so the sweep
 * never outlasts its welcome — long chains overlap instead of
 * queueing.
 */
export function flowTimings(count: number): {
  readonly segmentMs: number;
  readonly staggerMs: number;
} {
  if (count <= 1) return { segmentMs: FLOW_SEGMENT_MS, staggerMs: 0 };
  const staggerMs = Math.min(
    FLOW_SEGMENT_MS,
    Math.max(
      FLOW_MIN_STAGGER_MS,
      Math.floor(FLOW_MAX_SWEEP_MS / count),
    ),
  );
  return { segmentMs: FLOW_SEGMENT_MS, staggerMs };
}

/**
 * Stop the visualisation at the command the engine reported as failed:
 * the connections up to it ran, the ones after it did not. An error
 * that belongs to another function leaves the flow untouched.
 */
export function truncateFlow(
  state: FlowState,
  failedCommandId: number,
): FlowState {
  const index = state.edges.findIndex((edge) => edge.to === failedCommandId);
  if (index < 0) return state;
  const edges = state.edges.slice(0, index + 1);
  if (edges.length === state.edges.length) return state;
  return { ...state, edges };
}

/** Total lifetime of the sweep, in milliseconds. */
export function flowDuration(state: FlowState): number {
  if (state.edges.length === 0) return 0;
  return (
    state.edges.length * state.staggerMs +
    state.segmentMs +
    // A short tail so the last segment can leave the path.
    80
  );
}
