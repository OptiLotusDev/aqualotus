import { describe, expect, it } from "vitest";
import type { BranchCandidate } from "../../lib/flow";
import {
  branchCandidate,
  candidateProven,
  candidateViable,
  chainPrintCount,
  decideBranch,
  FLOW_LINK_MS,
  FLOW_MAX_SWEEP_MS,
  FLOW_MIN_LINK_MS,
  flowDuration,
  flowTimings,
  hasNestedIf,
  literalPrintLine,
  resolveRunPath,
  truncateFlow,
  visibleBranchBody,
  type FlowEdge,
  type FlowState,
} from "../../lib/flow";
import type { CommandSummary } from "../../lib/optilotus";

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

describe("visibleBranchBody", () => {
  const byId = new Map<number, CommandSummary>([
    [3, { id: 3, kind: "print", next: null, template: '"x"' }],
    [4, { id: 4, kind: "print", next: null, template: '"y"' }],
  ]);

  it.each([
    ["missing body returns none", null as readonly number[] | null | undefined, []],
    ["undefined body returns none", undefined as readonly number[] | null | undefined, []],
    ["empty body returns none", [] as readonly number[], []],
    ["drops ids with no command", [1, 3, 99], [{ id: 3, kind: "print", next: null, template: '"x"' }]],
    ["keeps body order", [4, 3], [
      { id: 4, kind: "print", next: null, template: '"y"' },
      { id: 3, kind: "print", next: null, template: '"x"' },
    ]],
  ])("%s", (_name, body, expected) => {
    expect(visibleBranchBody(body, byId)).toEqual(expected);
  });
});

describe("literalPrintLine", () => {
  it.each([
    ['plain quoted literal', '"hello"', "hello"],
    ['no quotes', "hello", null],
    ['single quote', "'hello'", null],
    ['variable template', '"{n}"', null],
    ['escaped text', '"a\\\\b"', null],
    ['empty quoted string', '""', ""],
    ['undefined', undefined, null],
  ])("%s", (_name, template, expected) => {
    expect(literalPrintLine(template as string | undefined)).toBe(expected);
  });
});

describe("chainPrintCount", () => {
  const byId = new Map<number, CommandSummary>([
    [1, { id: 1, kind: "print", next: 2 }],
    [2, { id: 2, kind: "print", next: 3 }],
    [3, { id: 3, kind: "print", next: null }],
    [4, { id: 4, kind: "print", next: 5 }],
    [5, { id: 5, kind: "if", next: null, then_body: [], else_body: [] }],
    [6, { id: 6, kind: "print", next: 6 }],
  ]);

  it.each([
    ["plain chain", 1, 3],
    ["chain into print tail", 2, 2],
    ["missing start", null, 0],
    ["start not a command", 99, 0],
    ["stops at downstream if", 4, null],
    ["cycle never hangs", 6, 1],
  ])("%s", (_name, start, expected) => {
    expect(chainPrintCount(start, byId)).toBe(expected);
  });
});

describe("branchCandidate", () => {
  const byId = new Map<number, CommandSummary>([
    [3, { id: 3, kind: "print", next: null, template: '"a"' }],
    [4, { id: 4, kind: "declare", next: null }],
    [5, { id: 5, kind: "print", next: null, template: '"b"' }],
  ]);

  it("collects visible members and the prints among them", () => {
    const cand = branchCandidate("then", [3, 4, 5], byId);
    expect(cand.side).toBe("then");
    expect(cand.members).toEqual([
      { id: 3, kind: "print", next: null, template: '"a"' },
      { id: 4, kind: "declare", next: null },
      { id: 5, kind: "print", next: null, template: '"b"' },
    ]);
    expect(cand.prints).toEqual([cand.members[0], cand.members[2]]);
  });

  it("empty body yields no members and no prints", () => {
    const cand = branchCandidate("else", [], byId);
    expect(cand.members).toEqual([]);
    expect(cand.prints).toEqual([]);
  });
});

describe("hasNestedIf", () => {
  const byId = new Map<number, CommandSummary>([
    [3, { id: 3, kind: "print", next: null, template: '"a"' }],
    [4, { id: 4, kind: "if", next: null, then_body: [], else_body: [] }],
  ]);

  it("detects a nested if among the members", () => {
    expect(hasNestedIf(branchCandidate("then", [3, 4], byId))).toBe(true);
    expect(hasNestedIf(branchCandidate("else", [3], byId))).toBe(false);
  });
});

describe("candidateViable", () => {
  const byId = new Map<number, CommandSummary>([
    [3, { id: 3, kind: "print", next: null, template: '"a"' }],
    [4, { id: 4, kind: "print", next: null, template: '"b"' }],
  ]);

  it("literals must reappear at their walk position", () => {
    const cand = branchCandidate("then", [3], byId);
    expect(candidateViable(cand, 0, ["a", "x"], 1)).toBe(true);
    expect(candidateViable(cand, 0, ["z", "x"], 1)).toBe(false);
  });

  it("variable templates are tolerated (cannot be verified)", () => {
    const cand: BranchCandidate = {
      side: "then",
      members: [
        { id: 3, kind: "print", next: null, template: '"a"' },
        { id: 4, kind: "print", next: null, template: '"{n}"' },
      ],
      prints: [
        { id: 3, kind: "print", next: null, template: '"a"' },
        { id: 4, kind: "print", next: null, template: '"{n}"' },
      ],
    };
    // joinCount null: no count to exclude; the variable print is skipped.
    expect(candidateViable(cand, 0, ["a", "anything"], null)).toBe(true);
  });

  it("count exclusion decides the other side", () => {
    const cand = branchCandidate("then", [3], byId);
    // joinCount=1: one more print sits after the join, so the window is
    // one line short of this candidate's full envelope.
    expect(candidateViable(cand, 0, ["a"], 1)).toBe(false);
  });
});

describe("candidateProven", () => {
  const byId = new Map<number, CommandSummary>([
    [3, { id: 3, kind: "print", next: null, template: '"a"' }],
    [4, { id: 4, kind: "print", next: null, template: '"{n}"' }],
  ]);

  it("requires every print to be a literal reappearing in place", () => {
    const lit = branchCandidate("then", [3], byId);
    expect(candidateProven(lit, 0, ["a"])).toBe(true);
    expect(candidateProven(lit, 0, ["z"])).toBe(false);
  });

  it("a variable print disqualifies proof", () => {
    const templ = branchCandidate("then", [4], byId);
    expect(candidateProven(templ, 0, ["anything"])).toBe(false);
  });

  it("a branch with no prints is never proven", () => {
    const empty = branchCandidate("then", [], byId);
    expect(candidateProven(empty, 0, [])).toBe(false);
  });
});

describe("decideBranch", () => {
  const byId = new Map<number, CommandSummary>([
    [3, { id: 3, kind: "print", next: null, template: '"a"' }],
    [4, { id: 4, kind: "print", next: null, template: '"b"' }],
    [5, { id: 5, kind: "print", next: null }],
  ]);

  function cmd(ifId: number, thenBody: readonly number[], elseBody: readonly number[], next: number): CommandSummary {
    return {
      id: ifId,
      kind: "if",
      next,
      then_body: thenBody.length === 0 ? undefined : thenBody,
      else_body: elseBody.length === 0 ? undefined : elseBody,
    } as CommandSummary;
  }

  const conditions = new Map<number, boolean>([[2, true]]);

  it.each([
    ["window proves then", cmd(2, [3], [4], 5), 0, ["a", "x"], undefined, "then"],
    ["window proves else", cmd(2, [4], [3], 5), 0, ["a", "x"], undefined, "else"],
    ["tie with no literal evidence stays undecided", cmd(2, [3], [4], 5), 0, ["5", "x"], undefined, null],
    ["tie broken by engine literal true", cmd(2, [3], [4], 5), 0, ["5", "x"], conditions, "then"],
    ["tie broken by engine literal false", cmd(2, [3], [4], 5), 0, ["5", "x"], new Map([[2, false]]), "else"],
    ["window-proven branch beats a wrong literal", cmd(2, [3], [4], 5), 0, ["b", "x"], conditions, "else"],
    ["empty envelope stays undecided", cmd(2, [3], [4], 5), 0, [], undefined, null],
  ])("%s", (_name, c, offset, printed, conditions, expected) => {
    expect(decideBranch(c, offset, printed, byId, conditions)).toBe(expected);
  });

  it("a literal condition does not rescue a branch holding a nested if", () => {
    const nested = {
      id: 3,
      kind: "if",
      next: null,
      then_body: [],
      else_body: undefined,
    } as CommandSummary;
    const byIdNested = new Map<number, CommandSummary>([...byId, [3, nested]]);
    const outer = {
      id: 2,
      kind: "if",
      next: 5,
      then_body: [3],
      else_body: [4],
    } as CommandSummary;
    expect(
      decideBranch(outer, 0, ["a", "x"], byIdNested, conditions),
    ).toBe(null);
  });
});

describe("resolveRunPath ambiguous / boundary cases", () => {
  it("cycle safety: a self-looping chain never hangs", () => {
    const graph = cmds(
      { id: 1, kind: "print", next: 1 },
      { id: 2, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["x"]);
    // The walk travels the self-loop edge once, then stops because the
    // current command was already seen — it never hangs.
    expect(edges).toEqual([{ fid: 0, from: 1, to: 1, kind: "chain" }]);
  });

  it("missing successor leaves the chain as far as it goes", () => {
    const graph = cmds(
      { id: 1, kind: "print", next: 99 },
      { id: 2, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["x"]);
    expect(edges).toEqual([]);
  });

  it("an if whose next is missing travels its decided branch and stops", () => {
    const graph = cmds(
      { id: 1, kind: "if", next: null, then_body: [3], else_body: [] },
      { id: 3, kind: "print", next: null, template: '"a"' },
    );
    const edges = resolveRunPath(graph, 1, 0, ["a"]);
    expect(edges).toEqual([{ fid: 0, from: 1, to: 3, kind: "branch-head" }]);
  });

  it("an undecided if with no successor drops its edges entirely", () => {
    const graph = cmds(
      { id: 1, kind: "if", next: null, then_body: [3], else_body: [4] },
      { id: 3, kind: "print", next: null, template: '"{n}"' },
      { id: 4, kind: "print", next: null, template: '"{n}"' },
    );
    const edges = resolveRunPath(graph, 1, 0, ["a"]);
    // Variable templates on both sides: viable tie, nothing proven, no
    // literal condition, no successor — nothing glows.
    expect(edges).toEqual([]);
  });

  it("multiple outgoing edges from one command all travel in order", () => {
    const graph = cmds(
      { id: 1, kind: "print", next: 2 },
      { id: 2, kind: "print", next: 3 },
      { id: 3, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["x", "x", "x"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "chain" },
    ]);
  });

  it("an unresolved branch leaves the `if`→join chain edge and no branch", () => {
    const graph = cmds(
      { id: 1, kind: "if", next: 5, then_body: [3], else_body: [4] },
      { id: 3, kind: "print", next: null, template: '"{n}"' },
      { id: 4, kind: "print", next: null, template: '"{n}"' },
      { id: 5, kind: "print", next: null },
    );
    const edges = resolveRunPath(graph, 1, 0, ["5", "x"]);
    expect(edges).toEqual([
      { fid: 0, from: 1, to: 5, kind: "chain" },
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

  it("keeps the travelled path when a join has multiple incoming edges", () => {
    const multi: FlowEdge[] = [
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 5, kind: "merge" },
      { fid: 0, from: 1, to: 5, kind: "chain" },
    ];
    const truncated = truncateFlow(state(multi), 5);
    // The travelled merge edge is kept; the redundant chain edge after
    // the join is dropped by path-aware traversal.
    expect(truncated.edges).toEqual([multi[0], multi[1]]);
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
