import { describe, expect, it } from "vitest";
import {
  FLOW_LINK_MS,
  FLOW_MAX_SWEEP_MS,
  FLOW_MIN_LINK_MS,
  flowDuration,
  flowTimings,
  resolveRunPath,
  truncateFlow,
  type FlowEdge,
  type FlowState,
} from "./flow";
import type { CommandSummary } from "./optilotus";

type CmdSeed = Partial<CommandSummary> & { id: number; next?: number | null };

function cmds(...entries: readonly CmdSeed[]): readonly CommandSummary[] {
  return entries.map((entry) => ({
    kind: "print",
    next: null,
    template: "\"x\"",
    ...entry,
  })) as readonly CommandSummary[];
}

function state(edges: FlowState["edges"]): FlowState {
  const timings = flowTimings(edges.length);
  return { runId: 1, edges, ...timings };
}

describe("resolveRunPath", () => {
  it("travels a straight chain in execution order", () => {
    const edges = resolveRunPath(
      cmds({ id: 1, next: 2 }, { id: 2, next: 3 }, { id: 3, next: null }),
      1,
      0,
      ["x", "x"],
    );
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "chain" },
    ]);
  });

  it("stops at a broken chain instead of hanging", () => {
    expect(
      resolveRunPath(cmds({ id: 1, next: 9 }), 1, 0, []),
    ).toEqual([]);
    expect(resolveRunPath(cmds({ id: 1, next: 2 }), null, 0, [])).toEqual([]);
  });

  it("decides the branch whose print count the window confirms", () => {
    // then: one print member; else: none. The window carries one extra
    // line before the join, so only `then` is consistent — the glow
    // enters the taken branch and merges back after it.
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 5, then_body: [3], else_body: [] },
      { id: 3, kind: "print", next: null, template: '"hello"' },
      { id: 5, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["hello", "x"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "branch-head" },
      { fid: 0, from: 3, to: 5, kind: "merge" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("decides the other branch the same way", () => {
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 5, then_body: [], else_body: [4] },
      { id: 4, kind: "print", next: null, template: '"no"' },
      { id: 5, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["no", "x"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 4, kind: "branch-head" },
      { fid: 0, from: 4, to: 5, kind: "merge" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("glows a multi-member branch: wire, columns and merge", () => {
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 6, then_body: [3, 4], else_body: [] },
      { id: 3, kind: "print", next: null, template: '"a"' },
      { id: 4, kind: "print", next: null, template: '"b"' },
      { id: 6, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["a", "b", "x"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "branch-head" },
      { fid: 0, from: 3, to: 4, kind: "chain" },
      { fid: 0, from: 4, to: 6, kind: "merge" },
      { fid: 0, from: 2, to: 6, kind: "chain" },
    ]);
  });

  it("never decides on a tie with no literal evidence", () => {
    // Identical variable templates in both branches: the envelope
    // cannot name the taken branch, so the glow travels the chain and
    // the `if`→join edge only — never both branches, never one.
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 5, then_body: [3], else_body: [4] },
      { id: 3, kind: "print", next: null, template: '"{n}"' },
      { id: 4, kind: "print", next: null, template: '"{n}"' },
      { id: 5, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["5", "x"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("uses literal matching when both branch counts would fit", () => {
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 5, then_body: [3], else_body: [4] },
      { id: 3, kind: "print", next: null, template: '"true side"' },
      { id: 4, kind: "print", next: null, template: '"false side"' },
      { id: 5, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["false side", "x"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 4, kind: "branch-head" },
      { fid: 0, from: 4, to: 5, kind: "merge" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("stays undecided when a branch holds a nested if", () => {
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 7, then_body: [3, 4], else_body: [] },
      { id: 3, kind: "if", next: 6, then_body: [5], else_body: undefined },
      { id: 5, kind: "print", next: null, template: '"inner"' },
      { id: 6, kind: "print", next: null, template: '"after inner"' },
      { id: 7, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["inner", "after inner", "x"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 7, kind: "chain" },
    ]);
  });

  it("stops deciding after the first undecided if", () => {
    // The first `if` is a count tie the literals cannot split; the
    // second one runs later with a provable window but must stay
    // undecided too — the position after an undecided `if` is not
    // bankable.
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 5, then_body: [3], else_body: [4] },
      { id: 3, kind: "print", next: null, template: '"{n}"' },
      { id: 4, kind: "print", next: null, template: '"{n}"' },
      { id: 5, kind: "print", next: 6 },
      { id: 6, kind: "if", next: 9, then_body: [7], else_body: [] },
      { id: 7, kind: "print", next: null, template: '"late"' },
      { id: 9, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["5", "x", "late", "x"]);
    expect(edges.filter((e) => e.kind !== "chain")).toEqual([]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
      { fid: 0, from: 5, to: 6, kind: "chain" },
      { fid: 0, from: 6, to: 9, kind: "chain" },
    ]);
  });

  it("stays undecided without a printed window (pending or failed run)", () => {
    // Envelope-free runs (a run still pending, or a run failed before
    // printing) travel the chain and the `if`→join edges — never a
    // branch claimed without the engine's own words.
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 5, then_body: [3], else_body: [] },
      { id: 3, kind: "print", next: null, template: '"hello"' },
      { id: 5, kind: "print", next: null },
    );
    expect(resolveRunPath(graph, 1, 0, [])).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("drops the edge into a decided empty branch rather than inventing geometry", () => {
    // A decided branch with no visible member has no wire to travel:
    // the count exclusion decided it, and the sweep continues on the
    // chain as the engine would.
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 5, then_body: [], else_body: [4] },
      { id: 4, kind: "print", next: null, template: '"no"' },
      { id: 5, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["no", "x"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 4, kind: "branch-head" },
      { fid: 0, from: 4, to: 5, kind: "merge" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("splits an unprovable tie with the engine's own literal condition", () => {
    // Identical variable templates on both sides: the envelope alone
    // stays undecided (the tie test above). The engine itself, however,
    // holds a constant condition — reported truthfully at the run's
    // freeze — so the branch it names is not a guess. Both values are
    // read honestly: a literal `true` names THEN, a literal `false`
    // names ELSE.
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 5, then_body: [3], else_body: [4] },
      { id: 3, kind: "print", next: null, template: '"{n}"' },
      { id: 4, kind: "print", next: null, template: '"{n}"' },
      { id: 5, kind: "print", next: null },
    );
    const thenEdges = resolveRunPath(
      graph,
      1,
      0,
      ["5", "x"],
      new Map<number, boolean>([[2, true]]),
    );
    expect(thenEdges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "branch-head" },
      { fid: 0, from: 3, to: 5, kind: "merge" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
    const elseEdges = resolveRunPath(
      graph,
      1,
      0,
      ["5", "x"],
      new Map<number, boolean>([[2, false]]),
    );
    expect(elseEdges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 4, kind: "branch-head" },
      { fid: 0, from: 4, to: 5, kind: "merge" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("never overrides a window-proven branch with the literal", () => {
    // The window proves FALSE ran: its literal print reappeared at the
    // exact position and TRUE's would have contradicted it. A stale or
    // wrong literal condition must never outvote the envelope's own
    // words — the literal only breaks dead ties.
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 5, then_body: [3], else_body: [4] },
      { id: 3, kind: "print", next: null, template: '"true side"' },
      { id: 4, kind: "print", next: null, template: '"false side"' },
      { id: 5, kind: "print", next: null },
    );
    const edges = resolveRunPath(
      graph,
      1,
      0,
      ["false side", "x"],
      new Map<number, boolean>([[2, true]]),
    );
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 4, kind: "branch-head" },
      { fid: 0, from: 4, to: 5, kind: "merge" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("a literal condition does not rescue a nested if", () => {
    // The nested walk order is unknowable from the envelope, and the
    // literal answers only *which side of one `if` ran* — never how an
    // outer branch prints. The outer `if` stays undecided even when the
    // engine names its condition.
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: 7, then_body: [3, 4], else_body: [] },
      { id: 3, kind: "if", next: 6, then_body: [5], else_body: undefined },
      { id: 5, kind: "print", next: null, template: '"inner"' },
      { id: 6, kind: "print", next: null, template: '"after inner"' },
      { id: 7, kind: "print", next: null },
    );
    const edges = resolveRunPath(
      graph,
      1,
      0,
      ["inner", "after inner", "x"],
      new Map<number, boolean>([[2, true]]),
    );
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 7, kind: "chain" },
    ]);
  });
  it("travels a decided branch of a terminal if (no successor)", () => {
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: null, then_body: [3], else_body: [4] },
      { id: 3, kind: "print", next: null, template: '"true side"' },
      { id: 4, kind: "print", next: null, template: '"false side"' },
    );
    const edges = resolveRunPath(graph, 1, 0, ["true side"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "branch-head" },
    ]);
  });

  it("leaves a terminal undecided if without a successor edge", () => {
    const graph = cmds(
      { id: 1, kind: "declare", next: 2 },
      { id: 2, kind: "if", next: null, then_body: [3], else_body: [4] },
      { id: 3, kind: "print", next: null, template: '"{n}"' },
      { id: 4, kind: "print", next: null, template: '"{n}"' },
    );
    const edges = resolveRunPath(graph, 1, 0, ["5"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
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
  const edges: FlowEdge[] = [
    { fid: 0, from: 1, to: 2, kind: "chain" },
    { fid: 0, from: 2, to: 3, kind: "chain" },
    { fid: 0, from: 3, to: 4, kind: "chain" },
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
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "chain" },
    ]);
    expect(flowDuration(flow)).toBe(2 * flow.linkMs);
    expect(flowDuration(state([]))).toBe(0);
  });
});
