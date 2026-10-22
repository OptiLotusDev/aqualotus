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
  // A successful wire with no entry point must make the chain runnable:
  // without this, body-drop wiring of orphan blocks forms a chain the
  // runner can never reach (entry stays `null` → no output). Establishing
  // the head here never disturbs a live entry (`keep` otherwise).
  const entryUpdate: EntryUpdate =
    entry === targetId
      ? { type: "set", entry: headOf(predsAfter(cmds, kept), sourceId) }
      : entry === null
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
  // Like `planLinkAfter`: wiring with no entry point establishes the
  // post-edit head so the chain becomes runnable (`ps === null` already
  // covers prepending; the `null` branch covers mid-chain inserts onto
  // a cleared entry). A live entry is untouched.
  const entryUpdate: EntryUpdate =
    ps === null
      ? { type: "set", entry: targetId }
      : entry === targetId
        ? { type: "set", entry: headOf(predsAfter(cmds, kept), sourceId) }
        : entry === null
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
  if (!sourceDetached) {
    return planLinkAfter(cmds, entry, sourceId, targetId);
  }
  // Fan-in attach (multiple inputs, one output): when the drop target's
  // input is already occupied, the detached source simply grows a second
  // incoming wire — the target keeps its predecessor and its successor,
  // so an in-port drop never yanks a block out of its chain. An
  // unoccupied in-port keeps the prepend behavior (build chains forward).
  if (preds.has(targetId)) {
    if ((links.get(sourceId) ?? null) === targetId) return null;
    const edits = [{ id: sourceId, next: targetId } as LinkEdit];
    const entryUpdate: EntryUpdate =
      entry === null
        ? { type: "set", entry: headOf(predsAfter(cmds, edits), sourceId) }
        : { type: "keep" };
    return { edits, entry: entryUpdate };
  }
  return planLinkBefore(cmds, entry, targetId, sourceId);
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

export type BlockSide = "top" | "bottom" | "left" | "right" | "then" | "else";

export interface EdgeEnds {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly horizontal: boolean;
}

/**
 * Port-anchored geometry (P3/P17): every edge exits the source's right
 * out-port and enters the target's left in-port, so arrows always start
 * and end on the visible port dots — never on a block middle, top, or
 * bottom edge. Blocks carry exactly two ports (left in, right out) and
 * chains run left → right; presentation only, semantics still come from
 * `next` pointers alone.
 *
 * `a` and `b` must be the block's **border box** (the painted `.vblock`
 * box): `x1` is the right edge and the port sits at the vertical
 * centre, so a content-box rect (padding excluded) misses the port by
 * the block's horizontal padding on x and half the vertical padding on
 * y. The sizes map is therefore populated from `offsetWidth` /
 * `offsetHeight`, never from a ResizeObserver `contentRect`.
 */
export function edgeEnds(a: BlockRect, b: BlockRect): EdgeEnds {
  return {
    x1: a.x + a.w,
    y1: a.y + a.h / 2,
    x2: b.x,
    y2: b.y + b.h / 2,
    horizontal: true,
  };
}

/**
 * Chain every given command head-to-tail in the given order (one-click
 * "connect in order" for orphan blocks). The caller passes the display
 * order (`list_commands` order: reachable chain first, then orphans by
 * id). A missing entry is established at the first id; a live entry is
 * kept while orphans are appended after the tail. Returns `null` only
 * when there is nothing to connect.
 *
 * Commands that belong to an `if` branch are **skipped**: the engine
 * runs a branch member from the `if`, so chaining it into the main
 * chain as well would execute it twice. The branch lists carry every
 * raw id of the member's command group, and the member's user-visible
 * head id is one of them, so the member is recognised by id.
 */
export function planChainAll(
  cmds: readonly (Linked & {
    readonly then_body?: readonly number[];
    readonly else_body?: readonly number[];
  })[],
  entry: number | null,
): LinkPlan | null {
  const branchMembers = new Set<number>();
  for (const c of cmds) {
    for (const id of c.then_body ?? []) branchMembers.add(id);
    for (const id of c.else_body ?? []) branchMembers.add(id);
  }
  const ids = cmds
    .map((c) => c.id)
    .filter((id) => !branchMembers.has(id));
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const only = ids[0] as number;
    if (entry === only) return null;
    return { edits: [], entry: { type: "set", entry: only } };
  }
  const links = linksOf(cmds);
  const edits: LinkEdit[] = [];
  ids.forEach((id, i) => {
    const next = i + 1 < ids.length ? (ids[i + 1] as number) : null;
    if ((links.get(id) ?? null) !== next) {
      edits.push({ id, next });
    }
  });
  const liveEntry = entry !== null && links.has(entry) ? entry : null;
  if (edits.length === 0 && liveEntry === ids[0]) return null;
  return {
    edits,
    entry:
      liveEntry === null
        ? { type: "set", entry: ids[0] as number }
        : { type: "keep" },
  };
}

export interface Edge {
  readonly fid: number;
  readonly from: number;
  readonly to: number;
}

export function edgesOf(cmds: readonly { id: number; next: number | null; then_body?: number[]; else_body?: number[] }[]): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<number>();
  const byId = new Map<number, { next: number | null; then_body?: number[]; else_body?: number[] }>();
  for (const c of cmds) byId.set(c.id, c);

  for (const cmd of cmds) {
    if (cmd.next !== null && !seen.has(cmd.id)) {
      seen.add(cmd.id);
      if (cmd.next !== undefined && byId.has(cmd.next)) {
        out.push({ fid: 0, from: cmd.id, to: cmd.next });
      }
    }

    if (cmd.then_body !== undefined && cmd.then_body.length > 0) {
      for (let i = 0; i < cmd.then_body.length; i++) {
        const cid = cmd.then_body[i];
        if (seen.has(cid)) continue;
        seen.add(cid);
        if (i < cmd.then_body.length - 1) {
          const nextId = cmd.then_body[i + 1];
          if (byId.has(nextId)) {
            out.push({ fid: 0, from: cid, to: nextId });
          }
        }
      }
    }

    if (cmd.else_body !== undefined && cmd.else_body.length > 0) {
      for (let i = 0; i < cmd.else_body.length; i++) {
        const cid = cmd.else_body[i];
        if (seen.has(cid)) continue;
        seen.add(cid);
        if (i < cmd.else_body.length - 1) {
          const nextId = cmd.else_body[i + 1];
          if (byId.has(nextId)) {
            out.push({ fid: 0, from: cid, to: nextId });
          }
        }
      }
    }
  }

  return out;
}
