/**
 * Visual layout state (P17): `CommandId → {x, y}` in canvas coordinates.
 * UI-only; never influences program semantics. Pure functions so the
 * reconciliation policy is unit-testable without React.
 *
 * Blocks auto-place in a horizontal row (Excalidraw-style chains run
 * left → right, one in-port on the left, one out-port on the right).
 */

export interface Pos {
  readonly x: number;
  readonly y: number;
}

export type LayoutMap = Record<number, Pos>;

export const LAYOUT_START_X = 48;
export const LAYOUT_ROW_Y = 36;
export const LAYOUT_STEP_X = 264;
/** Fresh horizontal row for a function with no saved positions. */
export function initialLayout(ids: readonly number[]): LayoutMap {
  const out: Record<number, Pos> = {};
  ids.forEach((id, index) => {
    out[id] = { x: LAYOUT_START_X + index * LAYOUT_STEP_X, y: LAYOUT_ROW_Y };
  });
  return out;
}

/**
 * Reconcile saved positions against the authoritative command list:
 * keep positions for surviving ids, chain new ids to the right of the
 * rightmost known block (or at the pending drop point for the first
 * newcomer), and drop ids that no longer exist. Matching is by stable
 * id only. `startX` keeps auto-placed blocks clear of overlaid UI;
 * `minY` is the row height for auto-placed blocks.
 */
export function reconcileLayout(
  prev: Readonly<Record<number, Pos>>,
  ids: readonly number[],
  pending?: Pos | null,
  startX: number = LAYOUT_START_X,
  minY: number = LAYOUT_ROW_Y,
): LayoutMap {
  const out: Record<number, Pos> = {};
  let rightX = startX - LAYOUT_STEP_X;
  let anchorY = minY;
  for (const id of ids) {
    const kept = prev[id];
    if (kept !== undefined) {
      out[id] = kept;
      if (kept.x > rightX) {
        rightX = kept.x;
        anchorY = kept.y;
      }
    }
  }
  let newcomer = 0;
  for (const id of ids) {
    if (out[id] !== undefined) continue;
    if (newcomer === 0 && pending !== undefined && pending !== null) {
      out[id] = { x: pending.x, y: pending.y };
    } else {
      rightX += LAYOUT_STEP_X;
      out[id] = { x: Math.max(rightX, startX), y: anchorY };
    }
    newcomer += 1;
  }
  return out;
}
