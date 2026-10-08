/**
 * Generic SVG edge helpers plus minimal topological link planning.
 *
 * A connection drop must only touch the blocks involved: the moved
 * target, its old predecessor, and the source (plus entry when the
 * head changes). Re-linking the whole list would drag unrelated
 * detached blocks into the chain, so planners return exact edits.
 * Edges themselves are derived from semantic `next` pointers elsewhere.
 */

export interface LinkEdit {
  readonly id: number;
  readonly next: number | null;
}

export type EntryUpdate =
  | { readonly type: "keep" }
  | { readonly type: "set"; readonly entry: number | null };

export interface LinkPlan {
  readonly edits: readonly LinkEdit[];
  readonly entry: EntryUpdate;
}

interface Linked {
  readonly id: number;
  readonly next: number | null;
}

function linksOf(cmds: readonly Linked[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const c of cmds) out.set(c.id, c.next ?? null);
  return out;
}

/** Successor → predecessor (first wins; chains are linear). */
export function predecessorsOf(
  cmds: readonly Linked[],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of cmds) {
    if (c.next !== null && c.next !== undefined && !out.has(c.next)) {
      out.set(c.next, c.id);
    }
  }
  return out;
}

/** Walk predecessors to the chain head. Cycle-safe. */
function headOf(
  preds: ReadonlyMap<number, number>,
  startId: number,
): number {
  let head = startId;
  const seen = new Set<number>([startId]);
  for (;;) {
    const p = preds.get(head);
    if (p === undefined || seen.has(p)) return head;
    seen.add(p);
    head = p;
  }
}

/** Post-edit predecessor map: apply forward edits, then read backwards. */
function predsAfter(
  cmds: readonly Linked[],
  edits: readonly LinkEdit[],
): Map<number, number> {
  const forward = linksOf(cmds);
  for (const e of edits) forward.set(e.id, e.next);
  const preds = new Map<number, number>();
  for (const [id, next] of forward) {
    if (next !== null && !preds.has(next)) preds.set(next, id);
  }
  return preds;
}

/**
 * "Target runs right after source". Returns the exact link edits plus
 * the entry update, or null when invalid (unknown ids, self-loop) or a
 * no-op (already immediately after).
 */
export function planLinkAfter(
  cmds: readonly Linked[],
  entry: number | null,
  sourceId: number,
  targetId: number,
): LinkPlan | null {
  const links = linksOf(cmds);
  if (
    !links.has(sourceId) ||
    !links.has(targetId) ||
    sourceId === targetId
  ) {
    return null;
  }
  if (links.get(sourceId) === targetId) return null;
  const sOld = links.get(sourceId) ?? null;
  const preds = predecessorsOf(cmds);
  const p = preds.get(targetId) ?? null;
  const edits: LinkEdit[] = [{ id: sourceId, next: targetId }];
  const tOld = links.get(targetId) ?? null;
  edits.push({ id: targetId, next: sOld });
  if (p !== null) edits.push({ id: p, next: tOld });
  const kept = edits.filter((e) => e.id !== e.next);
  const entryUpdate: EntryUpdate =
    entry === targetId
      ? { type: "set", entry: headOf(predsAfter(cmds, kept), sourceId) }
      : { type: "keep" };
  return { edits: kept, entry: entryUpdate };
}

/**
 * "Target runs right before source" (input-port drops). Reaches the
 * front, which after-links cannot.
 */
export function planLinkBefore(
  cmds: readonly Linked[],
  entry: number | null,
  sourceId: number,
  targetId: number,
): LinkPlan | null {
  const links = linksOf(cmds);
  if (
    !links.has(sourceId) ||
    !links.has(targetId) ||
    sourceId === targetId
  ) {
    return null;
  }
  if (links.get(targetId) === sourceId) return null;
  const preds = predecessorsOf(cmds);
  const ps = preds.get(sourceId) ?? null;
  const p = preds.get(targetId) ?? null;
  const tOld = links.get(targetId) ?? null;
  const edits: LinkEdit[] = [{ id: targetId, next: sourceId }];
  if (ps !== null) edits.push({ id: ps, next: targetId });
  if (p !== null) edits.push({ id: p, next: tOld });
  const kept = edits.filter((e) => e.id !== e.next);
  const entryUpdate: EntryUpdate =
    ps === null
      ? { type: "set", entry: targetId }
      : entry === targetId
        ? { type: "set", entry: headOf(predsAfter(cmds, kept), sourceId) }
        : { type: "keep" };
  return { edits: kept, entry: entryUpdate };
}

/** Empty-canvas drop: detach the target into a tail of its own. */
export function planMoveToEnd(
  cmds: readonly Linked[],
  entry: number | null,
  targetId: number,
): LinkPlan | null {
  const links = linksOf(cmds);
  if (!links.has(targetId)) return null;
  const tOld = links.get(targetId) ?? null;
  if (tOld === null) return null;
  const preds = predecessorsOf(cmds);
  const p = preds.get(targetId) ?? null;
  const edits: LinkEdit[] = [{ id: targetId, next: null }];
  if (p !== null) edits.push({ id: p, next: tOld });
  const entryUpdate: EntryUpdate =
    entry === targetId ? { type: "set", entry: tOld } : { type: "keep" };
  return { edits: edits.filter((e) => e.id !== e.next), entry: entryUpdate };
}

/**
 * Where a wire dragged from an out-port lands.
 * - `"after"`: dropped on the target block body — target moves to run
 *   right after the source (legacy move semantics).
 * - `"before"`: dropped on the target's in-port — forward port-to-port
 *   wiring: out → in always flows forward, never reverses intent.
 * - `"end"`: dropped on empty canvas — source detaches into a tail.
 */
export type DropWhere = "after" | "before" | "end";

/**
 * One entry point for connection drops (UI gesture → link plan).
 *
 * In-port drops follow an anchor rule so successive port-to-port drags
 * build chains the way the user draws them:
 * - source detached (fresh block) → insert source right *before* the
 *   target; the target keeps its successor, entry follows a moved head.
 *   This makes `D.out → A.in` yield `D → A`, and prepending work.
 * - source already chained → insert target right *after* the source
 *   (target adopts the source's old successor, its old gap bridges).
 *   This makes `A.out → P.in` yield `… → A → P` without tearing down
 *   what was built before.
 *
 * Returns null when invalid or a no-op, like the planners.
 */
export function planDropLink(
  cmds: readonly Linked[],
  entry: number | null,
  sourceId: number,
  targetId: number | null,
  where: DropWhere,
): LinkPlan | null {
  if (where === "end") {
    if (targetId !== null) return null;
    return planMoveToEnd(cmds, entry, sourceId);
  }
  if (targetId === null) return null;
  if (where === "after") {
    return planLinkAfter(cmds, entry, sourceId, targetId);
  }
  const links = linksOf(cmds);
  if (!links.has(sourceId) || !links.has(targetId) || sourceId === targetId) {
    return null;
  }
  const preds = predecessorsOf(cmds);
  const sourceDetached =
    !preds.has(sourceId) && (links.get(sourceId) ?? null) === null;
  return sourceDetached
    ? planLinkBefore(cmds, entry, targetId, sourceId)
    : planLinkAfter(cmds, entry, sourceId, targetId);
}

/** Smooth cubic Bézier from source port to target port. */
export function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  horizontal = false,
): string {
  if (horizontal) {
    const bend = Math.max(32, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }
  const bend = Math.max(32, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

export interface BlockRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type BlockSide = "top" | "bottom" | "left" | "right";

export interface EdgeEnds {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly horizontal: boolean;
}

function sidePoint(rect: BlockRect, side: BlockSide): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: rect.x + rect.w / 2, y: rect.y };
    case "bottom":
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case "left":
      return { x: rect.x, y: rect.y + rect.h / 2 };
    case "right":
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
  }
}

/**
 * Honest geometry (P3): pick the exit/entry sides facing each other
 * from block centers, so edges route vertically for stacked blocks and
 * horizontally for side-by-side blocks. Pure coordinates — semantics
 * still come from `next` pointers alone.
 */
export function edgeEnds(a: BlockRect, b: BlockRect): EdgeEnds {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  let exit: BlockSide;
  let entry: BlockSide;
  let horizontal: boolean;
  if (Math.abs(dy) >= Math.abs(dx)) {
    horizontal = false;
    if (dy >= 0) {
      exit = "bottom";
      entry = "top";
    } else {
      exit = "top";
      entry = "bottom";
    }
  } else {
    horizontal = true;
    if (dx >= 0) {
      exit = "right";
      entry = "left";
    } else {
      exit = "left";
      entry = "right";
    }
  }
  const p1 = sidePoint(a, exit);
  const p2 = sidePoint(b, entry);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, horizontal };
}
