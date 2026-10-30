/**
 * Pure canvas geometry: coordinate conversions, rectangle calculations,
 * and geometric helpers. No React, no DOM, no state — honest pure
 * functions over explicit inputs.
 */

import type { BlockRect, BlockSide } from "./graph_geometry";
import type { Pos } from "./layout";

/**
 * Convert a function-relative block position to world coordinates by
 * adding the function container's origin.
 */
export function blockWorld(
  funcOrigin: Pos,
  relPos: Pos,
): Pos {
  return { x: funcOrigin.x + relPos.x, y: funcOrigin.y + relPos.y };
}

/**
 * Compute the world-space rectangle of a block from its function-relative
 * rect and the function container's origin.
 */
export function blockWorldRect(
  funcOrigin: Pos,
  rect: BlockRect,
): BlockRect {
  return {
    x: funcOrigin.x + rect.x,
    y: funcOrigin.y + rect.y,
    w: rect.w,
    h: rect.h,
  };
}

/**
 * Compute the live position of a merge-join circle, including an
 * in-flight drag offset.
 */
export function joinLivePos(
  base: Pos | null,
  drag: { readonly dx: number; readonly dy: number } | null,
): Pos | null {
  if (base === null) return null;
  if (drag === null) return base;
  return { x: base.x + drag.dx, y: base.y + drag.dy };
}

/**
 * Clamp a position to minimum canvas bounds (blocks cannot leave the
 * top-left corner).
 */
export function clampBlockPos(
  pos: Pos,
  minX: number,
  minY: number,
): Pos {
  return { x: Math.max(minX, pos.x), y: Math.max(minY, pos.y) };
}

/**
 * Determine which branch of which `if` a block belongs to, by scanning
 * the derived if shapes.
 */
export function memberSideOf(
  ifShapes: readonly { readonly branchOf: ReadonlyMap<number, BlockSide> }[],
  id: number,
): BlockSide | undefined {
  for (const shape of ifShapes) {
    const side = shape.branchOf.get(id);
    if (side !== undefined) return side;
  }
  return undefined;
}
