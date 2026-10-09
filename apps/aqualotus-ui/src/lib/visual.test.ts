import { describe, expect, it } from "vitest";
import { BLOCKS, filterBlocks, findAvailableBlock } from "./blocks";
import {
  edgeEnds,
  edgePath,
  planDropLink,
  planLinkAfter,
  planLinkBefore,
  planMoveToEnd,
  predecessorsOf,
} from "./graph";
import { initialLayout, reconcileLayout } from "./layout";

describe("filterBlocks", () => {
  it("returns everything on an empty query", () => {
    expect(filterBlocks("").length).toBe(BLOCKS.length);
    expect(filterBlocks("   ").length).toBe(BLOCKS.length);
  });

  it("matches labels and aliases exactly", () => {
    expect(filterBlocks("declare variable").some((b) => b.kind === "declare")).toBe(
      true,
    );
    expect(filterBlocks("let").some((b) => b.kind === "declare")).toBe(true);
    expect(filterBlocks("output").some((b) => b.kind === "print")).toBe(true);
    expect(filterBlocks("no-such-block")).toEqual([]);
  });

  it("finds nothing for partial or category-only queries", () => {
    // "function" is an exact label hit; "program" names no block.
    expect(filterBlocks("function").map((b) => b.kind)).toEqual(["function"]);
    expect(filterBlocks("program")).toEqual([]);
    expect(filterBlocks("decl")).toEqual([]);
  });

  it("lists exactly the api.md surface — nothing invented", () => {
    const kinds = BLOCKS.map((b) => b.kind).sort();
    expect(kinds).toEqual(
      ["assign", "call", "declare", "function", "print", "return"].sort(),
    );
  });
});

describe("findAvailableBlock", () => {
  it("resolves every api.md block and nothing else", () => {
    for (const kind of ["declare", "assign", "print", "return", "call", "function"]) {
      expect(findAvailableBlock(kind)?.kind).toBe(kind);
    }
    expect(findAvailableBlock("if")).toBe(null);
    expect(findAvailableBlock("nope")).toBe(null);
  });
});

describe("initialLayout / reconcileLayout", () => {
  it("chains fresh ids left-to-right in one row", () => {
    const layout = initialLayout([1, 2, 3]);
    expect(layout[1]?.x ?? 0).toBeLessThan(layout[2]?.x ?? 0);
    expect(layout[2]?.x ?? 0).toBeLessThan(layout[3]?.x ?? 0);
    expect(layout[1]?.y).toBe(layout[2]?.y);
  });

  it("preserves surviving positions and drops removed ids", () => {
    const prev = {
      1: { x: 10, y: 20 },
      2: { x: 300, y: 20 },
      9: { x: 0, y: 0 },
    };
    const next = reconcileLayout(prev, [1, 2, 3]);
    expect(next[1]).toEqual({ x: 10, y: 20 });
    expect(next[9]).toBeUndefined();
    expect((next[3]?.x ?? 0)).toBeGreaterThan(300);
    expect(next[3]?.y).toBe(20);
  });

  it("places a dropped newcomer at the pending point", () => {
    const next = reconcileLayout({ 1: { x: 5, y: 5 } }, [1, 2], {
      x: 300,
      y: 300,
    });
    expect(next[2]).toEqual({ x: 300, y: 300 });
  });

  it("keeps auto-placed blocks right of the given start", () => {
    const next = reconcileLayout({ 1: { x: 10, y: 20 } }, [1, 2], null, 348);
    expect(next[2]?.x).toBe(348);
    expect(next[2]?.y).toBe(36);
  });
});

describe("edgePath", () => {
  it("produces a cubic path between ports", () => {
    expect(edgePath(0, 0, 0, 100)).toBe("M 0 0 C 0 50, 0 50, 0 100");
  });

  it("bends along x for horizontal links", () => {
    expect(edgePath(0, 0, 100, 0, true)).toBe("M 0 0 C 50 0, 50 0, 100 0");
  });
});

describe("edgeEnds", () => {
  it("routes stacked blocks vertically", () => {
    const ends = edgeEnds(
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 0, y: 200, w: 100, h: 50 },
    );
    expect(ends.horizontal).toBe(false);
    expect([ends.x1, ends.y1]).toEqual([50, 50]);
    expect([ends.x2, ends.y2]).toEqual([50, 200]);
  });

  it("routes side-by-side blocks horizontally", () => {
    const ends = edgeEnds(
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 300, y: 0, w: 100, h: 50 },
    );
    expect(ends.horizontal).toBe(true);
    expect([ends.x1, ends.y1]).toEqual([100, 25]);
    expect([ends.x2, ends.y2]).toEqual([300, 25]);
  });

  it("routes upward links top-to-bottom", () => {
    const ends = edgeEnds(
      { x: 0, y: 200, w: 100, h: 50 },
      { x: 0, y: 0, w: 100, h: 50 },
    );
    expect(ends.horizontal).toBe(false);
    expect([ends.x1, ends.y1]).toEqual([50, 200]);
    expect([ends.x2, ends.y2]).toEqual([50, 50]);
  });
});

describe("planLinkAfter", () => {
  // Chain: 1 -> 2 -> 3, entry 1. Detached 4.
  const cmds = [
    { id: 1, next: 2 },
    { id: 2, next: 3 },
    { id: 3, next: null },
    { id: 4, next: null },
  ];

  it("moves only the touched links, leaving detached blocks alone", () => {
    // Move detached 4 after 1: only 1->4 and 4->2 change.
    expect(planLinkAfter(cmds, 1, 1, 4)).toEqual({
      edits: [
        { id: 1, next: 4 },
        { id: 4, next: 2 },
      ],
      entry: { type: "keep" },
    });
  });

  it("bridges the gap left behind and fixes the entry", () => {
    // Move entry 1 after 3 in 1->2->3: 3->1, 1->null; nothing pointed
    // at 1, so no bridge edit; entry follows to the surviving head 2.
    const plan = planLinkAfter(cmds, 1, 3, 1);
    expect(plan).toEqual({
      edits: [
        { id: 3, next: 1 },
        { id: 1, next: null },
      ],
      entry: { type: "set", entry: 2 },
    });
  });

  it("rejects self-loops, unknown ids, and adjacent no-ops", () => {
    expect(planLinkAfter(cmds, 1, 2, 2)).toBe(null);
    expect(planLinkAfter(cmds, 1, 1, 9)).toBe(null);
    expect(planLinkAfter(cmds, 1, 1, 2)).toBe(null);
  });
});

describe("planLinkBefore", () => {
  const cmds = [
    { id: 1, next: 2 },
    { id: 2, next: 3 },
    { id: 3, next: null },
  ];

  it("inserts before the source, reaching the front", () => {
    expect(planLinkBefore(cmds, 1, 1, 3)).toEqual({
      edits: [
        { id: 3, next: 1 },
        { id: 2, next: null },
      ],
      entry: { type: "set", entry: 3 },
    });
  });

  it("moves the entry head along when splicing mid-chain", () => {
    // Move 1 before 3 in 1->2->3: result 2->1->3, entry follows to 2.
    expect(planLinkBefore(cmds, 1, 3, 1)).toEqual({
      edits: [
        { id: 1, next: 3 },
        { id: 2, next: 1 },
      ],
      entry: { type: "set", entry: 2 },
    });
  });

  it("rejects adjacent and invalid drops", () => {
    expect(planLinkBefore(cmds, 1, 2, 1)).toBe(null);
    expect(planLinkBefore(cmds, 1, 2, 2)).toBe(null);
    expect(planLinkBefore(cmds, 1, 2, 9)).toBe(null);
  });
});

describe("planMoveToEnd", () => {
  const cmds = [
    { id: 1, next: 2 },
    { id: 2, next: 3 },
    { id: 3, next: null },
  ];

  it("detaches the target into a tail, bridging the gap", () => {
    expect(planMoveToEnd(cmds, 1, 2)).toEqual({
      edits: [
        { id: 2, next: null },
        { id: 1, next: 3 },
      ],
      entry: { type: "keep" },
    });
  });

  it("fixes the entry when it moves away", () => {
    expect(planMoveToEnd(cmds, 1, 1)).toEqual({
      edits: [
        { id: 1, next: null },
      ],
      entry: { type: "set", entry: 2 },
    });
  });

  it("rejects tails and unknown ids", () => {
    expect(planMoveToEnd(cmds, 1, 3)).toBe(null);
    expect(planMoveToEnd(cmds, 1, 9)).toBe(null);
  });
});

describe("planDropLink", () => {
  // The reported flow: fresh declare(1), assign(2), print(3) chained by
  // successive out-port → in-port drags must come out 1 -> 2 -> 3.

  it("chains a detached source before a detached target", () => {
    const cmds = [
      { id: 1, next: null },
      { id: 2, next: null },
      { id: 3, next: null },
    ];
    expect(planDropLink(cmds, null, 1, 2, "before")).toEqual({
      edits: [{ id: 1, next: 2 }],
      entry: { type: "set", entry: 1 },
    });
  });

  it("appends to a chained source without tearing the chain down", () => {
    const cmds = [
      { id: 1, next: 2 },
      { id: 2, next: null },
      { id: 3, next: null },
    ];
    expect(planDropLink(cmds, 1, 2, 3, "before")).toEqual({
      edits: [
        { id: 2, next: 3 },
        { id: 3, next: null },
      ],
      entry: { type: "keep" },
    });
  });

  it("prepends a detached source before the entry head", () => {
    const cmds = [
      { id: 1, next: 2 },
      { id: 2, next: null },
      { id: 4, next: null },
    ];
    expect(planDropLink(cmds, 1, 4, 1, "before")).toEqual({
      edits: [{ id: 4, next: 1 }],
      entry: { type: "set", entry: 4 },
    });
  });

  it("appends a detached target after a chained source", () => {
    const cmds = [
      { id: 1, next: 2 },
      { id: 2, next: null },
      { id: 4, next: null },
    ];
    expect(planDropLink(cmds, 1, 2, 4, "before")).toEqual({
      edits: [
        { id: 2, next: 4 },
        { id: 4, next: null },
      ],
      entry: { type: "keep" },
    });
  });

  it("keeps body drops on legacy move semantics", () => {
    const cmds = [
      { id: 1, next: 2 },
      { id: 2, next: 3 },
      { id: 3, next: null },
      { id: 4, next: null },
    ];
    expect(planDropLink(cmds, 1, 1, 4, "after")).toEqual(
      planLinkAfter(cmds, 1, 1, 4),
    );
  });

  it("rejects self-drops, unknown ids, and no-ops", () => {
    const cmds = [
      { id: 1, next: 2 },
      { id: 2, next: null },
    ];
    expect(planDropLink(cmds, 1, 1, 1, "before")).toBe(null);
    expect(planDropLink(cmds, 1, 1, 9, "before")).toBe(null);
    expect(planDropLink(cmds, 1, 9, 1, "before")).toBe(null);
    // Already 1 -> 2: re-dropping the same wire is a no-op.
    expect(planDropLink(cmds, 1, 1, 2, "before")).toBe(null);
  });
});

describe("predecessorsOf", () => {
  it("maps successors to predecessors", () => {
    expect(
      predecessorsOf([
        { id: 1, next: 2 },
        { id: 2, next: null },
      ]).get(2),
    ).toBe(1);
  });
});
