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

/* Vertical If/Else presentation geometry (UI-only, mirrors the engine's
 * branch semantics: bodies run top → bottom in two columns). Used by the
 * canvas (`graph.ts` frames, `VisualEditor` auto-place after a branch
 * wire) and unit-tested standalone. */
/** Gap between an `if` card's bottom edge and its first body frame. */
export const BRANCH_PAD_Y = 40;
/** Extra width between the TRUE and FALSE body columns. */
export const BRANCH_COLUMN_GAP = 24;
/** Frame padding around a branch's member blocks. */
export const BRANCH_FRAME_PAD = 14;
/** Minimum height of a body frame (and of the drop-target placeholder). */
export const BRANCH_MIN_H = 76;
/** Width of the placeholder frame for a branch without members yet. */
export const BRANCH_GHOST_W = 216;
/** Vertical gap between two members stacked in one body column. */
export const BRANCH_STACK_GAP = 24;
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

/**
 * Where an appended branch member auto-places: under the last member of
 * its own body column (execution order names the tail), left-aligned so
 * the column reads top → bottom. An empty branch anchors its first
 * member to the frame placeholder directly below the `if` card.
 *
 * Pure presentation (P17): the call sites hand in the **relative**
 * rectangles and the function only answers where the frame put the
 * member — branch membership itself always comes from the engine's own
 * `then_body`/`else_body` lists, here and everywhere.
 */
export function branchDropPos(params: {
  readonly branch: "then" | "else";
  readonly ifRect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** The branch's current member rects, execution order. */
  /** The branch's current member rects, execution order: (y, h) per
   * member — x is ignored, the column is fixed. */
  readonly memberRects: readonly (readonly [number, number])[];
}): Pos {
  const x =
    params.branch === "then"
      ? params.ifRect.x
      : params.ifRect.x + params.ifRect.w + BRANCH_COLUMN_GAP;
  const rects = params.memberRects;
  if (rects.length === 0) {
    return { x, y: params.ifRect.y + params.ifRect.h + BRANCH_PAD_Y };
  }
  const last = rects[rects.length - 1] as readonly [number, number];
  return { x, y: last[0] + last[1] + BRANCH_STACK_GAP };
}
