/**
 * Connect-into-branch resolution (pure).
 *
 * When the user drags a wire whose **source or drop target belongs to an
 * `if` branch**, the ordinary chain planners (`planDropLink`) are the
 * wrong tool: re-splicing a member with `set_next` would strand blocks
 * the engine runs from the branch (the executor's body walk stops the
 * moment `next` leaves branch membership), and a second predecessor is
 * a lie the canvas can already warn about. This module resolves the
 * drop against the engine's own branch lists **before** any planner
 * runs and answers with one of:
 *
 * - `"append"`: the dropped block should join the member's branch via
 *   the engine's `if_append` (which detaches the block from wherever it
 *   currently chains — every predecessor adopts its old `next` — so an
 *   append can never tear the old chain). The engine is still
 *   authoritative: anything it rejects resurfaces as a typed error.
 * - `"chain"`: both wire ends are members of the *same* branch. The
 *   branch body is an ordinary linear chain of members, so the ordinary
 *   planners handle the reorder.
 * - `"none"`: no branch is involved — the ordinary planners apply.
 * - `"reject"`: the drop is refused with a user-facing reason, before
 *   any bridge call: dropping onto a member (would fabricate a second
 *   predecessor), across `if` boundaries, back onto the branch's own
 *   `if`, releasing a mid-branch member's wire into empty canvas
 *   (severs the body chain), and merging an `if`/`return` into a branch
 *   (the engine refuses those later anyway).
 *
 * Presentation-free on purpose: membership comes from `branchOwnerOf`,
 * which is itself derived from the engine summaries — never a second
 * source of truth.
 */

import {
  branchOwnerOf,
  type BranchSide,
  type GraphCommand,
} from "./graph";

/** How a connection drop interacts with If/Else branch membership. */
export type BranchConnect =
  | /** The target joins the source branch (engine `if_append`). */
    {
      readonly kind: "append";
      readonly ifId: number;
      readonly branch: BranchSide;
    }
  /** Both ends are members of one branch: ordinary chain planners. */
  | { readonly kind: "chain" }
  /** No branch involved: the ordinary chain planners apply. */
  | { readonly kind: "none" }
  /** Refused before any bridge call, with the user-facing reason. */
  | { readonly kind: "reject"; readonly reason: string };

export function resolveBranchConnect(
  cmds: readonly GraphCommand[],
  sourceId: number,
  targetId: number | null,
): BranchConnect {
  const owners = branchOwnerOf(cmds);
  const srcOwner = owners.get(sourceId);
  const dstOwner = targetId === null ? undefined : owners.get(targetId);

  // Source outside all branches: only a drop **onto** a member is the
  // special case. Wiring a wire into a member would give that block two
  // predecessors (its branch tail and this drop) — a block the engine's
  // one-linear-chain walk can never reach twice honestly, so the canvas
  // refuses instead of drawing a connection that never runs.
  if (srcOwner === undefined) {
    if (dstOwner !== undefined) {
      return {
        kind: "reject",
        reason: "That block already runs inside an If/Else branch.",
      };
    }
    return { kind: "none" };
  }

  // Source is a branch member.
  if (targetId === null) {
    // Empty canvas: the branch tail may reasonably end there (no-op),
    // but a mid-branch member's wire would sever its in-branch chain —
    // the successor must stay reachable from the branch head.
    const src = cmds.find((c) => c.id === sourceId);
    const next = src?.next ?? null;
    const nextOwner = next === null ? undefined : owners.get(next);
    if (
      nextOwner !== undefined &&
      nextOwner.ifId === srcOwner.ifId &&
      nextOwner.branch === srcOwner.branch
    ) {
      return {
        kind: "reject",
        reason: "That block's successor stays inside the branch.",
      };
    }
    return { kind: "none" };
  }

  // Drop target is the source member's own `if` card (or a connection
  // that resolves through it): a wire from the body back into the merge
  // point the branch already runs is meaningless — the tails already
  // rejoin there, and `if_append` answers "itself" with the same refusal.
  if (targetId === srcOwner.ifId) {
    return {
      kind: "reject",
      reason: "The branch already ends at its If's join point.",
    };
  }

  if (dstOwner !== undefined) {
    if (dstOwner.ifId === srcOwner.ifId) {
      if (dstOwner.branch === srcOwner.branch) return { kind: "chain" };
      // Same if, other branch: the engine moves members across branches
      // only when the move is sourced from the member itself, not from
      // a wire dragged between two members of different branches.
      return {
        kind: "reject",
        reason: "That block runs in the other branch of this If.",
      };
    }
    return {
      kind: "reject",
      reason: "That block already belongs to another If's branch.",
    };
  }

  // Outside target that cannot join a branch (engine refuses `if` and
  // `return` members — told here instead of after the bridge call).
  const target = cmds.find((c) => c.id === targetId);
  if (target?.kind === "if" || target?.kind === "return") {
    return {
      kind: "reject",
      reason: "If and Return blocks cannot run inside a branch.",
    };
  }

  return { kind: "append", ifId: srcOwner.ifId, branch: srcOwner.branch };
}
