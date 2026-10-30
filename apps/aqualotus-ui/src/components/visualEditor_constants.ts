export interface Size {
  readonly w: number;
  readonly h: number;
}

import type { Pos } from "../lib/layout";
import { LAYOUT_START_X, LAYOUT_STEP_X, LAYOUT_ROW_Y } from "../lib/layout";

export const FALLBACK_SIZE: Size = { w: 216, h: 104 };

/** Overscan (world units) around the viewport for smooth panning. */
export const VIEW_OVERSCAN = 800;

/** Program-model geometry (world coordinates, before zoom). */
export const WORLD_SIZE = 40000;
export const WORLD_CENTER = WORLD_SIZE / 2;
/** Package drag clamp keeps the package inside the world. */
export const DRAG_LIMIT = WORLD_SIZE / 2 - 4000;

export function clampDrag(v: number): number {
  return Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, v));
}

export const PKG_HEAD = 0;
export const PKG_PAD = 40;
export const STRUCT_HEAD = 0;
export const STRUCT_PAD = 30;
export const FUNC_MIN_WIDTH = 600;
export const FUNC_MIN_HEIGHT = 200;
export const FUNC_GAP = 28;
export const BLOCK_MIN_Y = 36;

/** Stretch animation of a freshly created connection, in milliseconds. */
export const EDGE_DRAW_MS = 110;

/** Shared empty set for the "currently drawing" edges. */
export const EMPTY_EDGE_KEYS: ReadonlySet<string> = new Set<string>();

export function fallbackPos(index: number): Pos {
  return { x: LAYOUT_START_X + index * LAYOUT_STEP_X, y: LAYOUT_ROW_Y };
}
