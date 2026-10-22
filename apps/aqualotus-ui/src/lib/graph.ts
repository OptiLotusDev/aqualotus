/**
 * Generic SVG edge helpers plus minimal topological link planning.
 *
 * A connection drop must only touch the blocks involved: the moved
 * target, its old predecessor, and the source (plus entry when the
 * head changes). Re-linking the whole list would drag unrelated
 * detached blocks into the chain, so planners return exact edits.
 * Edges themselves are derived from semantic `next` pointers elsewhere.
 *
 * ## The `if` gap (engine-owned limitation, UI-owned compensation)
 *
 * The engine keeps an `if`'s condition in a **hidden compute command**
 * that has to run immediately before the `if`. That compute is not a
 * user command, so the engine's user-level `next` edge cannot express
 * "block X is followed by an `if`": `Package::user_next` reports
 * `None` whenever the raw successor is not a user command. The engine
 * therefore cannot report the edge into an `if` — a documented engine
 * limitation (see `docs/feature-parity-audit.md`, F-1).
 *
 * The UI compensates by remembering the connections it planned: a
 * connection the engine accepted (the bridge confirmed it) but cannot
 * report is marked `planned` on the block that starts it, so the canvas
 * and the "not connected" notice never claim an unconfirmed engine
 * edge.
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
  // The runtime executes **one linear chain** per function: a command
  // with two predecessors is never reached (the executor walks
  // `next` from the entry). A second incoming wire would therefore be a
  // lie on the canvas — the dropped block would be drawn as connected
  // and never run. An in-port drop always *inserts* the detached source
  // before the target instead: the target keeps its successor, its old
  // predecessor keeps the chain, and every block stays reachable.
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

/**
 * The shape the graph model needs from a command summary. Structural on
 * purpose: the engine's `CommandSummary` and the UI's projection both
 * satisfy it.
 */
export interface GraphCommand {
  readonly id: number;
  readonly next: number | null;
  readonly kind?: string;
  readonly then_body?: readonly number[];
  readonly else_body?: readonly number[];
  /**
   * The successor came from the UI's plan, not from the engine: it is
   * the edge into an `if`, whose hidden condition compute the engine
   * cannot report (see the module header).
   */
  readonly planned?: boolean;
}

/**
 * Every raw id the engine lists in an `if`'s branch bodies.
 *
 * A branch list carries *every raw node* of a member (a print owns a
 * hidden tail node), so this set mixes visible blocks with hidden
 * nodes. Callers that need blocks filter it through
 * {@link visibleBranchMembers}.
 */
export function branchMemberIds(
  cmds: readonly GraphCommand[],
): Set<number> {
  const out = new Set<number>();
  for (const c of cmds) {
    for (const id of c.then_body ?? []) out.add(id);
    for (const id of c.else_body ?? []) out.add(id);
  }
  return out;
}

/**
 * The visible blocks of one `if` branch, in execution order.
 *
 * The engine's branch list starts at the branch's first **raw** node,
 * which is not always a block the canvas can draw (a cast's group
 * starts at its hidden compute node). Only the ids the engine also
 * reports as commands are blocks, and the first of those is the
 * branch's head — the block the `if`'s branch wire must start at.
 */
export function visibleBranchMembers(
  cmds: readonly GraphCommand[],
  body: readonly number[] | null | undefined,
): number[] {
  if (body === null || body === undefined || body.length === 0) return [];
  const known = new Set(cmds.map((c) => c.id));
  return body.filter((id) => known.has(id));
}

/** One visible connection of the canvas graph. */
export interface LogicalEdge {
  /** The block the connection starts at. */
  readonly from: number;
  /** The block the connection leads to. */
  readonly to: number;
  /**
   * A branch wire: the `if`'s port to the head of one of its branches.
   * `null` for a chain edge.
   */
  readonly branch: "then" | "else" | null;
  /**
   * The engine's summary cannot report this connection (it is the edge
   * into an `if`, whose hidden condition compute hides it). The UI
   * planned it and the bridge accepted it.
   */
  readonly planned: boolean;
}

/**
 * The visible connections of one function.
 *
 * Three kinds, kept apart on purpose:
 * - **chain edges** — the engine's own `next` pointers (confirmed by
 *   the engine).
 * - **planned edges** — the edge into an `if`, which the engine cannot
 *   report (see {@link GraphCommand.planned}).
 * - **branch edges** — the `if`'s port to the head of one of its
 *   branches; the engine confirms them through the branch lists.
 *
 * Only *visible* blocks are connected: an edge never starts or ends at
 * a hidden raw node (the `if`'s condition compute, a print's hidden
 * tail), and no connection is drawn twice.
 */
export function edgesOf(cmds: readonly GraphCommand[]): LogicalEdge[] {
  const byId = new Map<number, GraphCommand>();
  for (const c of cmds) byId.set(c.id, c);
  const out: LogicalEdge[] = [];
  const seen = new Set<string>();
  const push = (
    from: number,
    to: number,
    branch: "then" | "else" | null,
    isPlanned: boolean,
  ): void => {
    if (!byId.has(from) || !byId.has(to)) return;
    const key = `${from}>${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ from, to, branch, planned: isPlanned });
  };

  // Chain edges: the engine's own `next` pointers, plus the ones the
  // UI planned and the engine accepted but cannot report (the edge
  // into an `if` — the projection marks those with `planned`). The
  // engine's edges always win: an edge is never drawn twice.
  for (const cmd of cmds) {
    const next = cmd.next ?? null;
    if (next === null) continue;
    push(cmd.id, next, null, cmd.planned === true);
  }

  // Branch edges: the `if`'s port to the head of a branch. The engine
  // confirms the membership through the branch lists; the head is the
  // first *visible* member, never a hidden raw node.
  for (const cmd of cmds) {
    if (cmd.kind !== "if") continue;
    const then = visibleBranchMembers(cmds, cmd.then_body)[0];
    if (then !== undefined) push(cmd.id, then, "then", false);
    const otherwise = visibleBranchMembers(cmds, cmd.else_body)[0];
    if (otherwise !== undefined) push(cmd.id, otherwise, "else", false);
  }

  return out;
}

/**
 * The user-visible entry point of a function.
 *
 * The engine's entry can point at a **hidden** node: when an `if`
 * heads the chain, the engine points the entry at the `if`'s condition
 * compute (`Package::if_set_condition`), and that id is not a block.
 * The chain still starts at the `if` itself — the compute is spliced
 * right before it — and `Package::list_commands` reports the reachable
 * chain before the orphans, so the first command it reports is the
 * chain's first block.
 *
 * `null` means "the UI cannot name the entry": either there is none, or
 * the hidden entry belongs to an `if` that no longer exists (the engine
 * keeps pointing at the orphaned compute). The UI then says "no entry
 * point" instead of claiming a connection the runtime does not have.
 */
export function resolveEntry(
  cmds: readonly GraphCommand[],
  entry: number | null,
): number | null {
  if (entry === null) return null;
  for (const c of cmds) {
    if (c.id === entry) return entry;
  }
  // A hidden entry is the condition compute of the `if` that heads the
  // chain: its successor is that `if`, so the chain's first block is
  // the first command the engine reports.
  const first = cmds[0];
  if (first === undefined || first.kind !== "if") return null;
  return first.id;
}

/**
 * The last block of the chain that starts at `entry`.
 *
 * Walks the user-level `next` edges, so the hidden compute of an `if`
 * is skipped (the `if` is the block that follows it). Returns `null`
 * when there is no chain (no entry, or the entry is not a block).
 */
export function chainTailOf(
  cmds: readonly GraphCommand[],
  entry: number | null,
): number | null {
  if (entry === null) return null;
  const nextOf = new Map<number, number | null>();
  for (const c of cmds) nextOf.set(c.id, c.next ?? null);
  let current: number | null = entry;
  const seen = new Set<number>();
  while (current !== null && !seen.has(current)) {
    if (!nextOf.has(current)) return null;
    seen.add(current);
    const next: number | null = nextOf.get(current) ?? null;
    if (next === null) return current;
    current = next;
  }
  return current;
}
