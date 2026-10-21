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
  /** Travel time of one connection, in milliseconds. */
  readonly linkMs: number;
}

/**
 * Travel time of a single connection, in milliseconds. The OptiLotus
 * design guide sets the travelling indicator at 300ms per link.
 */
export const FLOW_LINK_MS = 300;

/**
 * Floor for the per-connection travel time: a long chain keeps every
 * link visible instead of turning into a blur.
 */
export const FLOW_MIN_LINK_MS = 120;

/**
 * Upper bound for the whole sweep, so long chains stay responsive.
 */
export const FLOW_MAX_SWEEP_MS = 2400;

/**
 * Segment timing. The design guide travels one link at a time, in
 * order: each connection gets the reference duration, and only a long
 * chain shortens it — never below the floor, never above the guide.
 */
export function flowTimings(count: number): {
  readonly linkMs: number;
} {
  if (count <= 1) return { linkMs: FLOW_LINK_MS };
  const linkMs = Math.max(
    FLOW_MIN_LINK_MS,
    Math.min(FLOW_LINK_MS, Math.floor(FLOW_MAX_SWEEP_MS / count)),
  );
  return { linkMs };
}

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
 * Stop the visualisation at the command the engine reported as failed:
 * the connections up to it ran, the ones after it did not. An error
 * that belongs to another function leaves the flow untouched.
 *
 * Two cases, because the engine walks the chain one command at a time:
 * - the failed command was reached through a connection, so that
 *   connection carried flow into it and everything after it did not run;
 * - the failed command is the head of the chain, so it never reached its
 *   own successor: no connection of the chain ran at all.
 */
export function truncateFlow(
  state: FlowState,
  failedCommandId: number,
): FlowState {
  const into = state.edges.findIndex((edge) => edge.to === failedCommandId);
  if (into >= 0) {
    const edges = state.edges.slice(0, into + 1);
    if (edges.length === state.edges.length) return state;
    return { ...state, edges };
  }
  const out = state.edges.findIndex((edge) => edge.from === failedCommandId);
  if (out >= 0) {
    const edges = state.edges.slice(0, out);
    if (edges.length === state.edges.length) return state;
    return { ...state, edges };
  }
  return state;
}

/** Total lifetime of the sweep, in milliseconds: one link after another. */
export function flowDuration(state: FlowState): number {
  return state.edges.length * state.linkMs;
}
