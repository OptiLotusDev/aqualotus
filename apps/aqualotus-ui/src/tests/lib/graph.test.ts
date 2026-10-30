import { describe, expect, it } from "vitest";
import {
  BRANCH_PORT_FRACTION,
  JOIN_FALLBACK_SIZE,
  JOIN_GAP,
  branchEdgeEnds,
  branchMemberIds,
  branchOwnerOf,
  buildIfShapes,
  chainTailOf,
  columnEdgeEnds,
  countUnconnectedBlocks,
  edgeEnds,
  edgesOf,
  joinDefaultPos,
  mergeEdgesOf,
  mergeJoinRailsOf,
  planChainAll,
  portCenter,
  portEdgeEnds,
  resolveEntry,
  verticalEdgePath,
  visibleBranchMembers,
} from "../../lib/graph";
import type { GraphCommand, IfBodyFrame } from "../../lib/graph";

describe("planChainAll", () => {
  it("chains orphan blocks head-to-tail and establishes the entry", () => {
    const plan = planChainAll(
      [
        { id: 1, next: null },
        { id: 2, next: null },
        { id: 3, next: null },
      ],
      null,
    );
    // The tail already has no successor, so no edit is needed for it.
    expect(plan).toEqual({
      edits: [
        { id: 1, next: 2 },
        { id: 2, next: 3 },
      ],
      entry: { type: "set", entry: 1 },
    });
  });

  it("keeps a live entry and appends the orphans after the tail", () => {
    const plan = planChainAll(
      [
        { id: 1, next: 2 },
        { id: 2, next: null },
        { id: 3, next: null },
      ],
      1,
    );
    expect(plan).toEqual({
      edits: [{ id: 2, next: 3 }],
      entry: { type: "keep" },
    });
  });

  it("skips the commands that belong to an `if` branch", () => {
    // The engine runs a branch member from the `if` itself, so chaining
    // it into the main chain as well would execute it twice.
    const plan = planChainAll(
      [
        { id: 1, next: null },
        {
          id: 2,
          next: null,
          then_body: [3, 4],
          else_body: [],
        },
        { id: 3, next: null },
        { id: 4, next: null },
      ],
      null,
    );
    expect(plan).toEqual({
      edits: [{ id: 1, next: 2 }],
      entry: { type: "set", entry: 1 },
    });
  });

  it("returns null when there is nothing to connect", () => {
    expect(planChainAll([], null)).toBeNull();
    expect(
      planChainAll([{ id: 1, next: null }], 1),
    ).toBeNull();
  });
});

/**
 * The `if` gap: the engine keeps an `if`'s condition in a hidden compute
 * command, so the engine's user-level `next` cannot express "block X is
 * followed by an `if`". The UI remembers the connections it planned and
 * the engine accepted, and keeps them apart from the confirmed ones.
 */
describe("edgesOf", () => {
  it("connects the engine's own chain edges", () => {
    const edges = edgesOf([
      { id: 1, next: 2 },
      { id: 2, next: null },
    ]);
    expect(edges).toEqual([
      { from: 1, to: 2, branch: null, planned: false },
    ]);
  });

  it("connects the edge into an `if` the engine cannot report", () => {
    // The engine reports no successor for the block before the `if`;
    // the UI's plan says the `if` follows it.
    const edges = edgesOf([
      { id: 1, next: 2, planned: true },
      { id: 2, kind: "if", next: null },
    ]);
    expect(edges).toEqual([
      { from: 1, to: 2, branch: null, planned: true },
    ]);
  });

  it("anchors a branch wire at the branch's first visible block", () => {
    // The engine's branch list starts at the branch's first *raw* node.
    // For a cast that node is the hidden compute of the group, so the
    // wire must start at the visible block instead.
    const edges = edgesOf([
      { id: 1, kind: "if", next: null, then_body: [2, 3, 4] },
      { id: 4, kind: "cast", next: null },
    ]);
    expect(edges).toEqual([
      { from: 1, to: 4, branch: "then", planned: false },
    ]);
  });

  it("draws the else wire separately from the then wire", () => {
    const edges = edgesOf([
      { id: 1, kind: "if", next: null, then_body: [2, 3], else_body: [4, 5] },
      { id: 2, kind: "print", next: null },
      { id: 4, kind: "print", next: null },
    ]);
    expect(edges).toEqual([
      { from: 1, to: 2, branch: "then", planned: false },
      { from: 1, to: 4, branch: "else", planned: false },
    ]);
  });

  it("never connects a hidden raw node and never draws an edge twice", () => {
    const edges = edgesOf([
      { id: 1, kind: "if", next: null, then_body: [2, 3] },
      { id: 2, kind: "print", next: null },
    ]);
    // The hidden tail (3) of the print is in the branch list, but it is
    // not a block: no wire starts or ends there.
    for (const edge of edges) {
      expect([1, 2]).toContain(edge.from);
      expect([1, 2]).toContain(edge.to);
    }
    const keys = edges.map((e) => `${e.from}>${e.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the branch member chain out of the main chain", () => {
    // The engine chains the branch members itself (a real `next`), so
    // the member-to-member wire is a normal chain edge.
    const edges = edgesOf([
      { id: 1, kind: "if", next: null, then_body: [2, 3, 4] },
      { id: 2, kind: "print", next: 4 },
      { id: 4, kind: "print", next: null },
    ]);
    expect(edges).toEqual([
      { from: 2, to: 4, branch: null, planned: false },
      { from: 1, to: 2, branch: "then", planned: false },
    ]);
  });
});

describe("visibleBranchMembers", () => {
  it("keeps only the blocks of a branch, in order", () => {
    const cmds = [
      { id: 1, kind: "if", next: null, then_body: [2, 3, 4] },
      { id: 2, kind: "print", next: null },
      { id: 4, kind: "print", next: null },
    ];
    expect(visibleBranchMembers(cmds, [2, 3, 4])).toEqual([2, 4]);
    expect(visibleBranchMembers(cmds, null)).toEqual([]);
    expect(visibleBranchMembers(cmds, [])).toEqual([]);
  });
});

describe("branchMemberIds", () => {
  it("collects every raw id of every branch", () => {
    const members = branchMemberIds([
      { id: 1, kind: "if", next: null, then_body: [2, 3], else_body: [4] },
      { id: 2, kind: "print", next: null },
    ]);
    expect([...members].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });
});

describe("resolveEntry", () => {
  it("keeps an entry the engine names as a block", () => {
    expect(
      resolveEntry([{ id: 1, next: null }, { id: 2, next: null }], 2),
    ).toBe(2);
  });

  it("resolves the hidden entry of a chain headed by an `if`", () => {
    // The engine points the entry at the `if`'s condition compute; the
    // chain still starts at the `if` itself.
    expect(
      resolveEntry([{ id: 4, kind: "if", next: null }], 3),
    ).toBe(4);
  });

  it("names no entry when the hidden entry belongs to no block", () => {
    expect(
      resolveEntry([{ id: 7, kind: "print", next: null }], 3),
    ).toBeNull();
    expect(resolveEntry([], 3)).toBeNull();
    expect(resolveEntry([{ id: 1, next: null }], null)).toBeNull();
  });
});

describe("chainTailOf", () => {
  it("finds the last block of the chain", () => {
    expect(
      chainTailOf(
        [
          { id: 1, next: 2 },
          { id: 2, next: null },
        ],
        1,
      ),
    ).toBe(2);
  });

  it("has no tail without a chain", () => {
    expect(chainTailOf([{ id: 1, next: null }], null)).toBeNull();
    expect(chainTailOf([{ id: 1, next: null }], 9)).toBeNull();
  });
});

/** A small function: an if with one member in each branch and a print
 * after it — the shape the vertical If/Else wire drawing is built on. */
function ifFixture(): readonly GraphCommand[] {
  return [
    { id: 1, kind: "if", next: 5, then_body: [2, 3], else_body: [6] },
    { id: 2, kind: "print", next: 3 },
    { id: 3, kind: "print", next: null },
    { id: 5, kind: "print", next: null },
    { id: 6, kind: "print", next: null },
  ];
}

describe("branchOwnerOf", () => {
  it("maps every visible member to its if and branch", () => {
    const owners = branchOwnerOf(ifFixture());
    expect(owners.size).toBe(3);
    expect(owners.get(2)).toEqual({ ifId: 1, branch: "then" });
    expect(owners.get(3)).toEqual({ ifId: 1, branch: "then" });
    expect(owners.get(6)).toEqual({ ifId: 1, branch: "else" });
    // The if itself and the block after it belong to no branch.
    expect(owners.has(1)).toBe(false);
    expect(owners.has(5)).toBe(false);
  });

  it("never names a hidden raw node", () => {
    // The engine's branch list carries every raw id — a print's hidden
    // tail (3, unknown to the command list) must not claim ownership.
    const owners = branchOwnerOf([
      { id: 1, kind: "if", next: null, then_body: [2, 3, 4] },
      { id: 2, kind: "print", next: null },
      { id: 4, kind: "print", next: null },
    ]);
    expect([...owners.keys()].sort((a, b) => a - b)).toEqual([2, 4]);
  });
});

describe("mergeEdgesOf", () => {
  it("runs each branch's tail back into the block after the if", () => {
    expect(mergeEdgesOf(ifFixture())).toEqual([
      { ifId: 1, from: 3, to: 5 },
      { ifId: 1, from: 6, to: 5 },
    ]);
  });

  it("draws no rail without a visible block after the if", () => {
    // No `next` at all, or a `next` that is no block the canvas draws
    // (the hidden compute of a chained if, id unknown to the commands):
    // the executor may still rejoin at the if's own next, but no wire
    // can name an anchor for it — skip, like the planned-edge gap.
    expect(
      mergeEdgesOf([
        { id: 1, kind: "if", next: null, then_body: [2] },
        { id: 2, kind: "print", next: null },
      ]),
    ).toEqual([]);
    expect(
      mergeEdgesOf([
        { id: 1, kind: "if", next: 4, then_body: [2] },
        { id: 2, kind: "print", next: null },
      ]),
    ).toEqual([]);
  });

  it("draws no rail for an empty branch", () => {
    expect(
      mergeEdgesOf([
        { id: 1, kind: "if", next: 5, then_body: [2], else_body: [6, 7] },
        { id: 2, kind: "print", next: null },
        { id: 5, kind: "print", next: null },
      ]),
    ).toEqual([{ ifId: 1, from: 2, to: 5 }]);
  });
});

describe("mergeJoinRailsOf", () => {
  it("feeds the join circle from each populated branch's tail", () => {
    expect(mergeJoinRailsOf(ifFixture())).toEqual([
      { ifId: 1, branch: "then", from: 3, emptyBranch: false },
      { ifId: 1, branch: "else", from: 6, emptyBranch: false },
    ]);
  });

  it("keeps both rails flowing when the if has no continuation at all", () => {
    // `next: null` — the classic derivation (mergeEdgesOf) draws
    // nothing without a visible successor, but the join circle itself
    // is a valid destination: every branch still feeds it.
    const rails = mergeJoinRailsOf([
      { id: 1, kind: "if", next: null, then_body: [2], else_body: [] },
      { id: 2, kind: "print", next: null },
    ]);
    expect(rails).toEqual([
      { ifId: 1, branch: "then", from: 2, emptyBranch: false },
      { ifId: 1, branch: "else", from: 1, emptyBranch: true },
    ]);
  });

  it("anchors both empty branches' rails to the if card's own ports", () => {
    const rails = mergeJoinRailsOf([
      { id: 3, kind: "print", next: null },
      { id: 1, kind: "if", next: 4, then_body: [], else_body: [] },
      { id: 4, kind: "print", next: null },
    ]);
    expect(rails).toEqual([
      { ifId: 1, branch: "then", from: 1, emptyBranch: true },
      { ifId: 1, branch: "else", from: 1, emptyBranch: true },
    ]);
  });

  it("never names a hidden raw tail as the rail's source", () => {
    // The branch list carries raw ids: 3 is the print's hidden tail
    // (unknown to the command list), 2 is the visible tail the drawn
    // rail may leave from. (Same fixture as `branchOwnerOf` above.)
    const rails = mergeJoinRailsOf([
      { id: 1, kind: "if", next: null, then_body: [2, 3] },
      { id: 2, kind: "print", next: null },
      { id: 4, kind: "print", next: null },
    ]);
    expect(
      rails.filter((rail) => rail.branch === "then"),
    ).toEqual([{ ifId: 1, branch: "then", from: 2, emptyBranch: false }]);
  });
});

describe("BRANCH_PORT_FRACTION", () => {
  it("pins the fractions the canvas CSS mirrors", () => {
    // `.vport-then.vport-bottom { left: 30% }` and
    // `.vport-else.vport-bottom { left: 70% }` must stay in lockstep
    // with these values (index.css), or ports and wires drift apart.
    expect(BRANCH_PORT_FRACTION.then).toBe(0.3);
    expect(BRANCH_PORT_FRACTION.else).toBe(0.7);
  });
});

describe("portCenter", () => {
  const rect = { x: 10, y: 20, w: 100, h: 40 };

  it("anchors the side pair on the vertical midlines at the borders", () => {
    expect(portCenter(rect, "inLeft")).toEqual({
      x: 10,
      y: 40,
      horizontal: true,
    });
    expect(portCenter(rect, "outRight")).toEqual({
      x: 110,
      y: 40,
      horizontal: true,
    });
  });

  it("anchors the vertical pair on the horizontal midline at the borders", () => {
    expect(portCenter(rect, "inTop")).toEqual({
      x: 60,
      y: 20,
      horizontal: false,
    });
    expect(portCenter(rect, "outBottom")).toEqual({
      x: 60,
      y: 60,
      horizontal: false,
    });
  });

  it("sits the TRUE/FALSE ports on the bottom edge at the fractions", () => {
    expect(portCenter(rect, "then")).toEqual({
      x: 10 + 100 * 0.3,
      y: 60,
      horizontal: false,
    });
    expect(portCenter(rect, "else")).toEqual({
      x: 10 + 100 * 0.7,
      y: 60,
      horizontal: false,
    });
  });

  it("reads the join circle through its top-in and right-out ports", () => {
    expect(portCenter(rect, "joinIn")).toEqual({
      x: 60,
      y: 20,
      horizontal: false,
    });
    expect(portCenter(rect, "joinOut")).toEqual({
      x: 110,
      y: 40,
      horizontal: true,
    });
  });
});

describe("portEdgeEnds / edgeEnds", () => {
  it("runs a chain edge from the right out-port to the left in-port", () => {
    const ends = edgeEnds(
      { x: 0, y: 0, w: 80, h: 40 },
      { x: 200, y: 30, w: 70, h: 40 },
    );
    expect(ends).toEqual({
      x1: 80,
      y1: 20,
      x2: 200,
      y2: 50,
      horizontal: true,
    });
  });

  it("reads a top in-port vertically: the vertical body flow enters downward", () => {
    // A top in-port belongs to the vertical body flow (branch heads and
    // column links) — the wire curves downward into it, never sliding
    // horizontally (the `if` card itself takes its input on the LEFT
    // side, which is the horizontal case below).
    const ends = portEdgeEnds(
      { x: 0, y: 0, w: 80, h: 40 },
      { x: 200, y: 0, w: 100, h: 60 },
      "outRight",
      "inTop",
    );
    expect(ends).toEqual({
      x1: 80,
      y1: 20,
      x2: 250,
      y2: 0,
      horizontal: false,
    });
  });

  it("enters the if card's left side port horizontally", () => {
    // The card carries a left in-port (like every other block) — its
    // chain feeding reads left → right, no top dip.
    const ends = edgeEnds(
      { x: 0, y: 0, w: 80, h: 40 },
      { x: 200, y: 0, w: 100, h: 60 },
    );
    expect(ends).toEqual({
      x1: 80,
      y1: 20,
      x2: 200,
      y2: 30,
      horizontal: true,
    });
  });

  it("addresses the join circle through its top and right ports", () => {
    const rail = portEdgeEnds(
      { x: 0, y: 0, w: 80, h: 40 },
      { x: 50, y: 100, w: 168, h: 40 },
      "outBottom",
      "joinIn",
    );
    expect(rail).toEqual({
      x1: 40,
      y1: 40,
      x2: 134,
      y2: 100,
      horizontal: false,
    });
    const out = portEdgeEnds(
      { x: 50, y: 100, w: 168, h: 40 },
      { x: 400, y: 60, w: 80, h: 40 },
      "joinOut",
      "inLeft",
    );
    expect(out).toEqual({
      x1: 218,
      y1: 120,
      x2: 400,
      y2: 80,
      horizontal: true,
    });
  });
});

describe("joinDefaultPos", () => {
  it("sits the join below both frames, centred between the columns", () => {
    const frames: IfBodyFrame[] = [
      { branch: "then", empty: false, rect: { x: 0, y: 0, w: 200, h: 100 } },
      { branch: "else", empty: false, rect: { x: 300, y: 0, w: 200, h: 180 } },
    ];
    // x = the mean of the two column centres − half the fallback pill
    // width; y clears the lowest frame bottom by JOIN_GAP.
    expect(joinDefaultPos(frames)).toEqual({
      x: (100 + 400) / 2 - JOIN_FALLBACK_SIZE.w / 2,
      y: 180 + JOIN_GAP,
    });
  });

  it("centres on the only existing frame when the other branch is empty", () => {
    const frames: IfBodyFrame[] = [
      { branch: "then", empty: false, rect: { x: 0, y: 0, w: 200, h: 100 } },
    ];
    expect(joinDefaultPos(frames)).toEqual({
      x: 100 - JOIN_FALLBACK_SIZE.w / 2,
      y: 100 + JOIN_GAP,
    });
  });

  it("has no auto spot without any frame to sit under", () => {
    expect(joinDefaultPos([])).toBeNull();
  });
});

describe("branchEdgeEnds", () => {
  it("leaves the if's bottom at the branch fraction, enters the head's top", () => {
    const ends = branchEdgeEnds(
      { x: 10, y: 0, w: 100, h: 50 },
      { x: 0, y: 120, w: 80, h: 40 },
      "then",
    );
    expect(ends).toEqual({
      x1: 10 + 100 * 0.3,
      y1: 0 + 50,
      x2: 0 + 80 / 2,
      y2: 120,
      horizontal: false,
    });
  });
});

describe("columnEdgeEnds", () => {
  it("walks a member's bottom to the next member's top, vertically", () => {
    const ends = columnEdgeEnds(
      { x: 10, y: 0, w: 80, h: 40 },
      { x: 30, y: 90, w: 70, h: 30 },
    );
    expect(ends).toEqual({
      x1: 10 + 80 / 2,
      y1: 0 + 40,
      x2: 30 + 70 / 2,
      y2: 90,
      horizontal: false,
    });
  });
});

describe("verticalEdgePath", () => {
  it("draws a cubic that leaves downward and lands on the top edge", () => {
    const d = verticalEdgePath(100, 200, 60, 320);
    expect(d.startsWith("M 100 200 ")).toBe(true);
    expect(d.endsWith("60 320")).toBe(true);
    // Number per position: x1 y1 C x1 cy1, x2 cy2, x2 y2 — every control
    // point pulls the wire downward, never above the source nor below
    // the target.
    const numbers = [...d.matchAll(/[-\d.]+/g)].map((m) => Number(m[0]));
    const y1 = numbers[1] ?? 0;
    const y2 = numbers[7] ?? 0;
    expect(numbers[6] ?? 0).toBe(60);
    expect(y2).toBe(320);
    expect(numbers[3] ?? 0).toBeGreaterThan(y1);
    expect(numbers[5] ?? 0).toBeLessThan(y2);
  });
});

describe("buildIfShapes", () => {
  const rectOf = new Map<number, { x: number; y: number; w: number; h: number }>([
    [2, { x: 10, y: 120, w: 80, h: 40 }],
    [3, { x: 10, y: 180, w: 90, h: 30 }],
    [6, { x: 134, y: 120, w: 80, h: 30 }],
  ]);
  const ifRect = { x: 10, y: 0, w: 100, h: 60 };

  it("derives branches, owners, and the join from the engine's fields", () => {
    const shapes = buildIfShapes(
      ifFixture(),
      (id) => rectOf.get(id),
      (id) => (id === 1 ? ifRect : undefined),
    );
    expect(shapes).toHaveLength(1);
    const shape = shapes[0];
    if (shape === undefined) throw new Error("expected one shape");
    expect(shape.ifId).toBe(1);
    expect(shape.then).toEqual([2, 3]);
    expect(shape.else).toEqual([6]);
    expect([...shape.branchOf.entries()]).toEqual([
      [2, "then"],
      [3, "then"],
      [6, "else"],
    ]);
    expect(shape.join).toBe(5);
  });

  it("frames a branch around its members' union plus padding", () => {
    const shapes = buildIfShapes(
      ifFixture(),
      (id) => rectOf.get(id),
      (id) => (id === 1 ? ifRect : undefined),
    );
    const frames = shapes[0]?.frames ?? [];
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      branch: "then",
      empty: false,
      // Union of both members' rects plus BRANCH_FRAME_PAD (14) and the
      // extra 8 top/bottom room for the label.
      rect: { x: -4, y: 98, w: 118, h: 134 },
    });
    expect(frames[1]).toEqual({
      branch: "else",
      empty: false,
      rect: { x: 120, y: 98, w: 108, h: 74 },
    });
  });

  it("falls back to a placeholder frame beside the if when a branch is empty", () => {
    const shapes = buildIfShapes(
      [
        { id: 1, kind: "if", next: null, then_body: [2], else_body: [] },
        { id: 2, kind: "print", next: null },
      ],
      (id) => rectOf.get(id),
      (id) => (id === 1 ? ifRect : undefined),
    );
    const frames = shapes[0]?.frames ?? [];
    expect(frames[0]?.empty).toBe(false);
    expect(frames[1]).toEqual({
      branch: "else",
      empty: true,
      rect: { x: 10 + 100 + 24, y: 0 + 60 + 40, w: 216, h: 76 },
    });
  });

  it("shapes no frames without a placed if", () => {
    const shapes = buildIfShapes(
      ifFixture(),
      (id) => rectOf.get(id),
      () => undefined,
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.frames).toEqual([]);
  });
});

describe("countUnconnectedBlocks", () => {
  /** Shorthand: block({ id, kind?, next?, then?, else?, planned? }). */
  function block(overrides: {
    id: number;
    next?: number | null;
    kind?: string;
    then_body?: number[];
    else_body?: number[] | null;
    planned?: boolean;
  }): GraphCommand {
    return {
      id: overrides.id,
      next: overrides.next ?? null,
      ...(overrides.kind !== undefined ? { kind: overrides.kind } : {}),
      ...(overrides.then_body !== undefined
        ? { then_body: overrides.then_body }
        : {}),
      ...(overrides.else_body !== undefined
        ? { else_body: overrides.else_body }
        : {}),
      ...(overrides.planned === true ? { planned: true } : {}),
    } as GraphCommand;
  }

  it("counts a fully connected chain as zero orphans", () => {
    const cmds = [
      block({ id: 1, kind: "declare", next: 2 }),
      block({ id: 2, kind: "print", next: 3 }),
      block({ id: 3, kind: "print", next: null }),
    ];
    expect(countUnconnectedBlocks(cmds, 1)).toEqual({ total: 3, orphans: 0 });
  });

  it("counts blocks the entry chain cannot reach", () => {
    const cmds = [
      block({ id: 1, kind: "declare", next: 2 }),
      block({ id: 2, kind: "print", next: null }),
      block({ id: 3, kind: "print", next: null }),
    ];
    expect(countUnconnectedBlocks(cmds, 1)).toEqual({ total: 3, orphans: 1 });
  });

  it("does not count branch members the if executes", () => {
    const cmds = [
      block({ id: 1, kind: "declare", next: 2 }),
      block({ id: 2, kind: "if", next: 5, then_body: [3, 4], else_body: [] }),
      block({ id: 3, kind: "print", next: 4 }),
      block({ id: 4, kind: "print", next: null }),
      block({ id: 5, kind: "print", next: null }),
    ];
    expect(countUnconnectedBlocks(cmds, 1)).toEqual({ total: 5, orphans: 0 });
  });

  it("follows planned edges into an if the engine cannot report", () => {
    const cmds = [
      block({ id: 1, kind: "declare", next: 2, planned: true }),
      block({ id: 2, kind: "if", next: 3, then_body: [], else_body: null }),
      block({ id: 3, kind: "print", next: null }),
    ];
    expect(countUnconnectedBlocks(cmds, 1)).toEqual({ total: 3, orphans: 0 });
  });

  it("counts every non-member when there is no entry", () => {
    const cmds = [
      block({ id: 1, kind: "declare", next: null }),
      block({ id: 2, kind: "if", next: null, then_body: [3], else_body: null }),
      block({ id: 3, kind: "print", next: null }),
    ];
    expect(countUnconnectedBlocks(cmds, null)).toEqual({ total: 3, orphans: 2 });
  });

  it("stops the walk on a cycle instead of looping forever", () => {
    const cmds = [
      block({ id: 1, kind: "print", next: 2 }),
      block({ id: 2, kind: "print", next: 1 }),
      block({ id: 3, kind: "print", next: null }),
    ];
    expect(countUnconnectedBlocks(cmds, 1)).toEqual({ total: 3, orphans: 1 });
  });

  it("is empty for an empty function", () => {
    expect(countUnconnectedBlocks([], 1)).toEqual({ total: 0, orphans: 0 });
  });
});
