/**
 * Branch frames and `if` subtree shapes: the drawn containers around the
 * blocks an `if`'s branch runs, and where the manual merge join circle
 * sits. Purely presentational — derived from the engine's branch lists
 * once per edit, never fed back into engine state. */

import type { BlockRect } from "./graph_geometry";
import { visibleBranchMembers, type BranchSide, type GraphCommand } from "./graph_topology";
import {
  BRANCH_COLUMN_GAP,
  BRANCH_FRAME_PAD,
  BRANCH_GHOST_W,
  BRANCH_MIN_H,
  BRANCH_PAD_Y,
} from "./layout";
import type { Pos } from "./layout";

/** One vertical If/Else body container: the drawn frame around the
 * blocks an `if`'s branch runs. `empty` marks a branch the engine
 * reports no body for (no members yet) — the canvas still draws a
 * faint frame so the branch's port has somewhere to drop onto; the
 * frame stays clearly a placeholder, not a body the engine owns. */
export interface IfBodyFrame {
  readonly branch: BranchSide;
  readonly rect: BlockRect;
  readonly empty: boolean;
}

/** One `if`'s derived vertical subtree shape.
 *
 * `then`/`else` are the branch's *visible* member ids in execution
 * order; `branchOf` maps every visible member to its branch; `frames`
 * carry the container rectangles (member-derived; falls back to a
 * placeholder frame beside the `if` card when the branch is empty);
 * `join` is the merge target's id when the engine reports one. */
export interface IfShape {
  readonly ifId: number;
  readonly then: readonly number[];
  readonly else: readonly number[];
  readonly branchOf: ReadonlyMap<number, BranchSide>;
  readonly frames: readonly IfBodyFrame[];
  readonly join: number | null;
}

/** Gap between the branch frames' bottom edge and the join circle. */
export const JOIN_GAP = 52;

/** Fallback join-circle box, until the real DOM size is observed. */
export const JOIN_FALLBACK_SIZE = { w: 168, h: 40 } as const;

/**
 * The manual merge join of one `if` ("End of If Block").
 *
 * Purely presentational mirror of a real engine fact: the engine
 * executes the join block once after *either* branch (`select_if_body`
 * continues at the `if`'s own `next` when the body walk stops).
 * Turning the merge on draws that fact the way the user thinks of it —
 * both branch tails flow into one visible join point, and the
 * continuation leaves it — without touching a single pointer. */
export interface MergeJoin {
  /** The join circle is shown and the wires flow through it. */
  readonly on: boolean;
  /** Stored top-left in function-container coordinates; `null` = auto. */
  readonly pos: Pos | null;
}

/**
 * Where the join circle sits by default: below **both** branch frames,
 * centered between the two columns. `null` when neither frame exists
 * (no `if` card was laid out yet). */
export function joinDefaultPos(
  frames: readonly IfBodyFrame[],
): Pos | null {
  const then = frames.find((f) => f.branch === "then")?.rect;
  const otherwise = frames.find((f) => f.branch === "else")?.rect;
  if (then === undefined && otherwise === undefined) return null;
  const centers = [then, otherwise].filter(
    (r): r is BlockRect => r !== undefined,
  );
  const x =
    centers.reduce((sum, r) => sum + r.x + r.w / 2, 0) /
      Math.max(1, centers.length) -
    JOIN_FALLBACK_SIZE.w / 2;
  const bottom = Math.max(
    ...centers.map((r) => r.y + r.h),
  );
  return { x, y: bottom + JOIN_GAP };
}

/**
 * Derive every `if`'s vertical subtree shape from one function's
 * command summaries — presentation truth only: the engine's own
 * `next`, `then_body`, and `else_body` fields, projected once per edit
 * so the canvas (containers, vertical edges, merge rails) never
 * re-derives membership ad hoc. `rectOf`/`ifRectOf` supply the
 * *relative* block rectangles (function-container coordinates); a
 * derived frame must never feed back into engine state. */
export function buildIfShapes(
  cmds: readonly GraphCommand[],
  rectOf: (id: number) => BlockRect | undefined,
  ifRectOf: (id: number) => BlockRect | undefined,
): readonly IfShape[] {
  const shapes: IfShape[] = [];
  for (const cmd of cmds) {
    if (cmd.kind !== "if") continue;
    const then = visibleBranchMembers(cmds, cmd.then_body);
    const otherwise = visibleBranchMembers(cmds, cmd.else_body);
    const branchOf = new Map<number, BranchSide>();
    for (const id of then) branchOf.set(id, "then");
    for (const id of otherwise) branchOf.set(id, "else");
    const ifRect = ifRectOf(cmd.id);
    const frames: IfBodyFrame[] = [];
    if (ifRect !== undefined) {
      const thenRect = frameRect(then, rectOf);
      frames.push({
        branch: "then",
        rect:
          thenRect ??
          {
            x: ifRect.x,
            y: ifRect.y + ifRect.h + BRANCH_PAD_Y,
            w: BRANCH_GHOST_W,
            h: BRANCH_MIN_H,
          },
        empty: then.length === 0,
      });
      frames.push({
        branch: "else",
        rect:
          frameRect(otherwise, rectOf) ??
          {
            x: ifRect.x + ifRect.w + BRANCH_COLUMN_GAP,
            y: ifRect.y + ifRect.h + BRANCH_PAD_Y,
            w: BRANCH_GHOST_W,
            h: BRANCH_MIN_H,
          },
        empty: otherwise.length === 0,
      });
    }
    shapes.push({
      ifId: cmd.id,
      then,
      else: otherwise,
      branchOf,
      frames,
      join: cmd.next ?? null,
    });
  }
  return shapes;
}

/**
 * Union of the members' rectangles (frame padding included). `null`
 * when the branch has no visible member to frame.
 *
 * Exported for the auto-place diff (an off-gesture membership gain must
 * be measured against the frame *before* the gain — see the canvas
 * `branchMembersSeen` effect): the newcomer's own stale spot must
 * neither grow the frame that decides "already placed" nor anchor the
 * newcomer to itself. */
export function frameRect(
  members: readonly number[],
  rectOf: (id: number) => BlockRect | undefined,
): BlockRect | null {
  const rects: BlockRect[] = [];
  for (const id of members) {
    const r = rectOf(id);
    if (r !== undefined) rects.push(r);
  }
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x)) - BRANCH_FRAME_PAD;
  const y = Math.min(...rects.map((r) => r.y)) - BRANCH_FRAME_PAD - 8;
  const w =
    Math.max(...rects.map((r) => r.x + r.w)) - x + BRANCH_FRAME_PAD;
  const h =
    Math.max(...rects.map((r) => r.y + r.h)) - y + BRANCH_FRAME_PAD + 8;
  return { x, y, w, h };
}
