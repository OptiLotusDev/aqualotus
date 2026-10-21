import { describe, expect, it } from "vitest";
import {
  chainEdges,
  FLOW_LINK_MS,
  FLOW_MAX_SWEEP_MS,
  FLOW_MIN_LINK_MS,
  flowDuration,
  flowTimings,
  truncateFlow,
  type FlowState,
} from "./flow";
import type { CommandSummary } from "./optilotus";

function cmds(
  ...entries: readonly (readonly [number, number | null])[]
): readonly CommandSummary[] {
  return entries.map(([id, next]) => ({
    id,
    kind: "print",
    next,
    template: "\"x\"",
  })) as readonly CommandSummary[];
}

function state(edges: FlowState["edges"]): FlowState {
  const timings = flowTimings(edges.length);
  return { runId: 1, edges, ...timings };
}

describe("chainEdges", () => {
  it("returns the executed chain in execution order", () => {
    const edges = chainEdges(cmds([1, 2], [2, 3], [3, null]), 1, 0);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2 },
      { fid: 0, from: 2, to: 3 },
    ]);
  });

  it("stops at a broken chain instead of hanging", () => {
    expect(chainEdges(cmds([1, 9]), 1, 0)).toEqual([]);
    expect(chainEdges(cmds([1, 2]), null, 0)).toEqual([]);
  });

  it("stops on a cycle", () => {
    // The walk stops at the command it already saw: a malformed graph
    // ends the sweep instead of hanging it.
    expect(chainEdges(cmds([1, 2], [2, 1]), 1, 0)).toEqual([
      { fid: 0, from: 1, to: 2 },
      { fid: 0, from: 2, to: 1 },
    ]);
  });
});

describe("flowTimings", () => {
  it("gives every connection the guide's travel time", () => {
    // The design guide: 300ms per link.
    expect(flowTimings(1)).toEqual({ linkMs: FLOW_LINK_MS });
    expect(flowTimings(4)).toEqual({ linkMs: FLOW_LINK_MS });
  });

  it("shortens a long chain, but never below the floor", () => {
    // While the chain fits the sweep budget, the guide's timing applies.
    const medium = flowTimings(8);
    expect(medium.linkMs).toBe(FLOW_LINK_MS);
    expect(medium.linkMs * 8).toBeLessThanOrEqual(FLOW_MAX_SWEEP_MS);
    // A very long chain shortens to the floor, never below it.
    const long = flowTimings(40);
    expect(long.linkMs).toBe(FLOW_MIN_LINK_MS);
    expect(long.linkMs).toBeGreaterThanOrEqual(FLOW_MIN_LINK_MS);
    expect(long.linkMs).toBeLessThanOrEqual(FLOW_LINK_MS);
  });
});

describe("truncateFlow", () => {
  const edges = [
    { fid: 0, from: 1, to: 2 },
    { fid: 0, from: 2, to: 3 },
    { fid: 0, from: 3, to: 4 },
  ];

  it("keeps the connections that reached the failed command", () => {
    const truncated = truncateFlow(state(edges), 3);
    expect(truncated.edges).toEqual([edges[0], edges[1]]);
  });

  it("keeps every connection when the last command failed", () => {
    const truncated = truncateFlow(state(edges), 4);
    expect(truncated.edges).toEqual(edges);
  });

  it("drops every connection when the chain head failed", () => {
    // The head never reached its successor: no connection of the chain
    // carried anything, so none of them may glow.
    const truncated = truncateFlow(state(edges), 1);
    expect(truncated.edges).toEqual([]);
  });

  it("leaves the flow untouched for an error outside the chain", () => {
    const before = state(edges);
    expect(truncateFlow(before, 99)).toBe(before);
  });
});

describe("flowDuration", () => {
  it("covers the whole sweep, one link after another", () => {
    const flow = state([
      { fid: 0, from: 1, to: 2 },
      { fid: 0, from: 2, to: 3 },
    ]);
    expect(flowDuration(flow)).toBe(2 * flow.linkMs);
    expect(flowDuration(state([]))).toBe(0);
  });
});
