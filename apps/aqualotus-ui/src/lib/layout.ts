/**
 * Visual layout state (P17): `CommandId → {x, y}` in canvas coordinates.
 * UI-only; never influences program semantics. Pure functions so the
 * reconciliation policy is unit-testable without React.
 */

export interface Pos {
  readonly x: number;
  readonly y: number;
}

export type LayoutMap = Record<number, Pos>;

export const LAYOUT_START_X = 180;
export const LAYOUT_START_Y = 72;
export const LAYOUT_STEP_Y = 156;
/** Fresh vertical stack for a function with no saved positions. */
export function initialLayout(ids: readonly number[]): LayoutMap {
  const out: Record<number, Pos> = {};
  ids.forEach((id, index) => {
    out[id] = { x: LAYOUT_START_X, y: LAYOUT_START_Y + index * LAYOUT_STEP_Y };
  });
  return out;
}

/**
 * Reconcile saved positions against the authoritative command list:
 * keep positions for surviving ids, stack new ids below the lowest
 * known block (or at the pending drop point for the first newcomer),
 * and drop ids that no longer exist. Matching is by stable id only.
 * `startX` keeps auto-placed blocks clear of overlaid UI (the floating
 * library panel covers the left of the canvas on wide layouts);
 * `minY` keeps them below the floating toolbar pill.
 */
export function reconcileLayout(
  prev: Readonly<Record<number, Pos>>,
  ids: readonly number[],
  pending?: Pos | null,
  startX: number = LAYOUT_START_X,
  minY: number = LAYOUT_START_Y,
): LayoutMap {
  const out: Record<number, Pos> = {};
  let lowestY = minY - LAYOUT_STEP_Y;
  let anchorX = startX;
  for (const id of ids) {
    const kept = prev[id];
    if (kept !== undefined) {
      out[id] = kept;
      if (kept.y > lowestY) {
        lowestY = kept.y;
        anchorX = Math.max(kept.x, startX);
      }
    }
  }
  let newcomer = 0;
  for (const id of ids) {
    if (out[id] !== undefined) continue;
    if (newcomer === 0 && pending !== undefined && pending !== null) {
      out[id] = { x: pending.x, y: pending.y };
    } else {
      lowestY += LAYOUT_STEP_Y;
      out[id] = { x: anchorX, y: lowestY };
    }
    newcomer += 1;
  }
  return out;
}
