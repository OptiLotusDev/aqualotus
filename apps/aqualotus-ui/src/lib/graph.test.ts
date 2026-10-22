import { describe, expect, it } from "vitest";
import {
  branchMemberIds,
  chainTailOf,
  edgesOf,
  planChainAll,
  resolveEntry,
  visibleBranchMembers,
} from "./graph";

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
