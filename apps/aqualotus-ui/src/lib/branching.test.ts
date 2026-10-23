import { describe, expect, it } from "vitest";
import { resolveBranchConnect } from "./branching";
import type { GraphCommand } from "./graph";

/**
 * The connect-into-branch resolver: what happens to a wire drop whose
 * source or target runs inside an `if` branch. Every answer must come
 * from the engine's own branch lists (no second semantics), and every
 * refusal must name the reason to the user *before* any bridge call.
 */

/** One if with a THEN column of two prints and no ELSE members. */
function fixtures(): readonly GraphCommand[] {
  return [
    { id: 1, kind: "declare", next: 2 },
    { id: 2, kind: "if", next: 5, then_body: [3, 4], else_body: [] },
    { id: 3, kind: "print", next: 4 },
    { id: 4, kind: "print", next: null },
    { id: 5, kind: "print", next: null },
  ];
}

/** A wider board: members on both sides, a second `if`, and a return. */
function wide(): readonly GraphCommand[] {
  return [
    { id: 1, kind: "declare", next: 2 },
    { id: 2, kind: "if", next: 6, then_body: [3], else_body: [4, 5] },
    { id: 3, kind: "print", next: null },
    { id: 4, kind: "print", next: 5 },
    { id: 5, kind: "print", next: null },
    { id: 6, kind: "print", next: null },
    { id: 7, kind: "if", next: 9, then_body: [8], else_body: [] },
    { id: 8, kind: "print", next: null },
    { id: 9, kind: "print", next: null },
    { id: 10, kind: "return", next: null },
    { id: 20, kind: "declare", next: null },
  ];
}

describe("resolveBranchConnect", () => {
  it("lets an ordinary drop between two non-members through", () => {
    expect(resolveBranchConnect(fixtures(), 1, 5)).toEqual({ kind: "none" });
    expect(resolveBranchConnect(fixtures(), 20, 1)).toEqual({ kind: "none" });
  });

  it("appends a drop that lands the source branch's continuation", () => {
    // The source is a member and the target runs outside every branch:
    // `if_append` joins the target into the source's branch (and its
    // own detaching never tears the chain).
    expect(resolveBranchConnect(fixtures(), 3, 5)).toEqual({
      kind: "append",
      ifId: 2,
      branch: "then",
    });
    expect(resolveBranchConnect(fixtures(), 4, 1)).toEqual({
      kind: "append",
      ifId: 2,
      branch: "then",
    });
    expect(resolveBranchConnect(wide(), 5, 20)).toEqual({
      kind: "append",
      ifId: 2,
      branch: "else",
    });
  });

  it("never gives a member two wire entry points", () => {
    // Dropping on a member would fabricate a second predecessor — the
    // executor walks one linear chain, so the canvas refuses first.
    expect(resolveBranchConnect(fixtures(), 1, 3)).toEqual({
      kind: "reject",
      reason: "That block already runs inside an If/Else branch.",
    });
  });

  it("declines a drop that might sever the body chain into empty canvas", () => {
    expect(resolveBranchConnect(wide(), 4, null)).toEqual({
      kind: "reject",
      reason: "That block's successor stays inside the branch.",
    });
  });

  it("lets the branch tail end on empty canvas (no-op)", () => {
    // The tail already has no successor: releasing there detaches
    // nothing — an ordinary "already last" drop.
    expect(resolveBranchConnect(wide(), 5, null)).toEqual({ kind: "none" });
  });

  it("refuses a wire back into the member's own if card", () => {
    expect(resolveBranchConnect(wide(), 3, 2)).toEqual({
      kind: "reject",
      reason: "The branch already ends at its If's join point.",
    });
  });

  it("keeps same-branch reorder to the ordinary planners", () => {
    // Both ends run in one branch body: the body is a linear chain, so
    // the drop is an ordinary reorder, not a membership change.
    expect(resolveBranchConnect(wide(), 4, 5)).toEqual({ kind: "chain" });
    expect(resolveBranchConnect(wide(), 3, 3)).toEqual({ kind: "chain" });
  });

  it("refuses a wire across the branches of one if", () => {
    expect(resolveBranchConnect(wide(), 3, 5)).toEqual({
      kind: "reject",
      reason: "That block runs in the other branch of this If.",
    });
  });

  it("refuses a wire across two ifs' branches", () => {
    expect(resolveBranchConnect(wide(), 3, 8)).toEqual({
      kind: "reject",
      reason: "That block already belongs to another If's branch.",
    });
  });

  it("refuses moving an if or a return into a branch", () => {
    // The engine refuses these targets later anyway; telling here
    // spares the bridge round-trip and keeps the wire from lying.
    expect(resolveBranchConnect(wide(), 3, 7)).toEqual({
      kind: "reject",
      reason: "If and Return blocks cannot run inside a branch.",
    });
    expect(resolveBranchConnect(wide(), 5, 10)).toEqual({
      kind: "reject",
      reason: "If and Return blocks cannot run inside a branch.",
    });
  });

  it("answers a plain member-to-if drop against its own if too", () => {
    // The `if` card carries the merge point the branch tails already
    // rejoin at: the resolver refuses before `if_append` would.
    expect(resolveBranchConnect(wide(), 5, 2)).toEqual({
      kind: "reject",
      reason: "The branch already ends at its If's join point.",
    });
  });
});
