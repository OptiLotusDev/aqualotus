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

import {
  BRANCH_COLUMN_GAP,
  BRANCH_FRAME_PAD,
  BRANCH_GHOST_W,
  BRANCH_MIN_H,
  BRANCH_PAD_Y,
} from "./layout";
import type { Pos } from "./layout";

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

/**
 * How many user-visible blocks the run never reaches, and why.
 *
 * A block is unreached when the entry-chain walk (the engine's own
 * `next` edges plus the planned edges into an `if` — see the module
 * header) cannot arrive at it unless the engine runs it *from* an `if`
 * (a branch member: the walk follows the user-level pointers, and the
 * branch lists are part of every command summary, so the UI knows them
 * without any second semantics).
 *
 * With no entry point every block except branch members is unreached —
 * the run is a flat no-op. The count never lies about the engine; the
 * caller turns it into the "blocks aren't connected" notice.
 */
export function countUnconnectedBlocks(
  cmds: readonly GraphCommand[],
  entry: number | null,
): { total: number; orphans: number } {
  const branchMembers = branchMemberIds(cmds);
  if (cmds.length === 0) return { total: 0, orphans: 0 };
  if (entry === null) {
    return {
      total: cmds.length,
      orphans: cmds.filter((c) => !branchMembers.has(c.id)).length,
    };
  }
  const nextOf = new Map(cmds.map((c) => [c.id, c.next ?? null]));
  const seen = new Set<number>();
  let cur: number | null = entry;
  let guard = 0;
  while (cur !== null && !seen.has(cur) && guard <= nextOf.size) {
    seen.add(cur);
    guard += 1;
    cur = nextOf.get(cur) ?? null;
  }
  return {
    total: cmds.length,
    orphans: cmds.filter(
      (c) => !seen.has(c.id) && !branchMembers.has(c.id),
    ).length,
  };
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
 * The two branch outputs of an `if`. `then` executes when the condition
 * holds (TRUE), `else` when it does not (FALSE) — the engine's own word
 * choice (`IfSide::Then`, `IfSide::Else`).
 */
export type BranchSide = "then" | "else";

/** Which `if` and branch a block belongs to. */
export interface BranchOwner {
  readonly ifId: number;
  readonly branch: BranchSide;
}

/**
 * The branch each visible command belongs to, including *empty slots*:
 * a command the engine runs inside one `if`'s branch. Callers use it to
 * draw same-branch chain links vertically (a branch body runs top to
 * bottom), never for semantics — membership stays the engine's.
 */
export function branchOwnerOf(
  cmds: readonly GraphCommand[],
): Map<number, BranchOwner> {
  const out = new Map<number, BranchOwner>();
  for (const cmd of cmds) {
    if (cmd.kind !== "if") continue;
    const then = visibleBranchMembers(cmds, cmd.then_body);
    const otherwise = visibleBranchMembers(cmds, cmd.else_body);
    for (const id of then) if (!out.has(id)) out.set(id, { ifId: cmd.id, branch: "then" });
    for (const id of otherwise) if (!out.has(id)) out.set(id, { ifId: cmd.id, branch: "else" });
  }
  return out;
}

/**
 * One engine-implied *merge* connection: a branch body's last visible
 * member → the block after the `if` (its user-level `next`).
 *
 * The engine ends a member's chain there (`if_append` sets the moved
 * group's tail `next = None`), so the body's final edge is *not* a
 * `next` edge — the executor walks the body from `body[0]` and, when
 * the walk stops (the tail), continues at the `if`'s own `next`. That
 * continuation is the merge point every branch rejoins; it is engine
 * truth (`select_if_body`'s documented contract), just not a reported
 * pointer. Deriving it from the engine's own branch lists + `next` is
 * presentation the way the "planned" edges are: never a second semantics.
 */
export interface MergeEdge {
  /** The `if` whose body the tail belongs to. */
  readonly ifId: number;
  readonly from: number;
  readonly to: number;
}

export function mergeEdgesOf(
  cmds: readonly GraphCommand[],
): readonly MergeEdge[] {
  const ids = new Set(cmds.map((c) => c.id));
  const out: MergeEdge[] = [];
  for (const cmd of cmds) {
    if (cmd.kind !== "if") continue;
    const join = cmd.next ?? null;
    // No visible successor, or the successor is not a block (the hidden
    // compute of a chained `if` — the projection reports no `next` for
    // it, the same gap the "planned" edges cover): no merge rail.
    if (join === null || !ids.has(join)) continue;
    const thenTail = lastOf(visibleBranchMembers(cmds, cmd.then_body));
    const elseTail = lastOf(visibleBranchMembers(cmds, cmd.else_body));
    if (thenTail !== undefined) out.push({ ifId: cmd.id, from: thenTail, to: join });
    if (elseTail !== undefined && elseTail !== thenTail) {
      out.push({ ifId: cmd.id, from: elseTail, to: join });
    }
  }
  return out;
}

function lastOf(list: readonly number[]): number | undefined {
  return list.length === 0 ? undefined : list[list.length - 1];
}

/**
 * One branch rail an `if` draws in **manual-merge mode** (the "End of If
 * Block" join circle shown): a populated branch feeds the join through
 * its tail's bottom port, and an *empty* branch feeds it through the
 * `if`'s own TRUE/FALSE port — so the join shows one incoming wire per
 * branch even before either body has a member, and even when the `if`
 * has no continuation block to rejoin into at all (the join circle is
 * still the branch flow's own destination, ahead of `if.next` ever
 * being set).
 */
export interface MergeJoinRail {
  /** The `if` whose branch the rail belongs to. */
  readonly ifId: number;
  readonly branch: BranchSide;
  /**
   * The block the rail leaves: the branch's visible tail, or the `if`
   * itself when its branch is empty (`emptyBranch` then).
   */
  readonly from: number;
  /** `true` when the branch has no member — the rail leaves the `if`'s own TRUE/FALSE port. */
  readonly emptyBranch: boolean;
}

/**
 * The manual-merge rails of every `if`: one per branch, populated or
 * empty. Deck: `mergeEdgesOf` above is the classic-mode derivation (a
 * tail runs straight into the block after the `if`, which requires a
 * visible successor, an empty branch draws nothing); this one exists
 * for join mode, where the circle itself anchors an empty branch and a
 * missing continuation changes nothing — the engine's `next` is not
 * consulted at all, this is pure branch-list presentation.
 */
export function mergeJoinRailsOf(
  cmds: readonly GraphCommand[],
): readonly MergeJoinRail[] {
  const out: MergeJoinRail[] = [];
  const tails = new Set<number>();
  for (const cmd of cmds) {
    if (cmd.kind !== "if") continue;
    for (const branch of ["then", "else"] as const) {
      const tail = lastOf(
        visibleBranchMembers(
          cmds,
          branch === "then" ? cmd.then_body : cmd.else_body,
        ),
      );
      if (tail === undefined) {
        out.push({
          ifId: cmd.id,
          branch,
          from: cmd.id,
          emptyBranch: true,
        });
        continue;
      }
      // Engine branch lists never share a tail (a block runs in one
      // branch), but mirroring `mergeEdgesOf`'s dedupe keeps two rails
      // from ever leaving one port even if a projection ever sent one.
      if (tails.has(tail)) continue;
      tails.add(tail);
      out.push({ ifId: cmd.id, branch, from: tail, emptyBranch: false });
    }
  }
  return out;
}

/**
 * The fraction of an `if` card's width where each branch port sits, on
 * the card's **bottom** edge: TRUE at 30%, FALSE at 70% of the width —
 * branching downward into the vertical TRUE/FALSE body containers.
 * Kept in one place because the canvas CSS mirrors the same fractions
 * (`.vport-then.vport-bottom { left: 30% }`) and both must move
 * together when the card's layout changes.
 */
export const BRANCH_PORT_FRACTION: Record<BranchSide, number> = {
  then: 0.3,
  else: 0.7,
} as const;

/**
 * Port anchors for the vertical control-flow edges.
 *
 * A **branch wire** leaves the `if` card through its bottom TRUE/FALSE
 * port and enters the first body block through its *top* edge: a branch
 * body runs downward, so the wire enters where the reading starts.
 *
 * A **column link** (a branch member that chains to the next member of
 * the same branch) goes from the member's bottom edge to the next
 * member's top edge — the body's vertical flow line.
 */
export function branchEdgeEnds(
  a: BlockRect,
  b: BlockRect,
  branch: BranchSide,
): EdgeEnds {
  return portEdgeEnds(a, b, branch === "then" ? "then" : "else", "inTop");
}

export function columnEdgeEnds(a: BlockRect, b: BlockRect): EdgeEnds {
  return portEdgeEnds(a, b, "outBottom", "inTop");
}

/**
 * The roles the visible port circles play. Every edge must start at and
 * end on the *centre of a drawn port circle* — never on a block border
 * the port does not sit on — so the drawn geometry and the CSS port
 * offsets are kept in one place (P3/P17, port-centred edges):
 *
 * - `inLeft` / `outRight` — the side ports every ordinary block carries
 *   (chain flow reads left → right);
 * - `inTop` / `outBottom` — the vertical pair a branch body member
 *   carries (a body runs top → bottom);
 * - `then` / `else` — the `if` card's bottom TRUE/FALSE ports (30% /
 *   70% of the card width, mirroring `BRANCH_PORT_FRACTION` in CSS);
 * - `joinIn` / `joinOut` — the manual merge join point (the "End of If
 *   Block" circle): tails enter its top, the continuation leaves its
 *   right.
 */
export type PortRole =
  | "inLeft"
  | "inTop"
  | "outRight"
  | "outBottom"
  | "then"
  | "else"
  | "joinIn"
  | "joinOut";

/** The centre of a drawn port circle, in block coordinates. */
export interface PortPoint {
  readonly x: number;
  readonly y: number;
  /** `true` when the edge on this side reads horizontally. */
  readonly horizontal: boolean;
}

/** A port-circle centre: CSS mirrors these offsets (±6.5px bring the
 * 13px rings' centres exactly onto the block border). */
export function portCenter(rect: BlockRect, role: PortRole): PortPoint {
  const horizontal = (role: PortRole): boolean => {
    switch (role) {
      case "inLeft":
      case "outRight":
      case "joinOut":
        return true;
      default:
        return false;
    }
  };
  switch (role) {
    case "inLeft":
      return { x: rect.x, y: rect.y + rect.h / 2, horizontal: horizontal(role) };
    case "outRight":
      return {
        x: rect.x + rect.w,
        y: rect.y + rect.h / 2,
        horizontal: horizontal(role),
      };
    case "inTop":
      return {
        x: rect.x + rect.w / 2,
        y: rect.y,
        horizontal: horizontal(role),
      };
    case "outBottom":
      return {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h,
        horizontal: horizontal(role),
      };
    case "then":
      return {
        x: rect.x + rect.w * BRANCH_PORT_FRACTION.then,
        y: rect.y + rect.h,
        horizontal: horizontal(role),
      };
    case "else":
      return {
        x: rect.x + rect.w * BRANCH_PORT_FRACTION.else,
        y: rect.y + rect.h,
        horizontal: horizontal(role),
      };
    case "joinIn":
      return {
        x: rect.x + rect.w / 2,
        y: rect.y,
        horizontal: horizontal(role),
      };
    case "joinOut":
      return {
        x: rect.x + rect.w,
        y: rect.y + rect.h / 2,
        horizontal: horizontal(role),
      };
  }
}

/**
 * One edge drawn between two port circles. `horizontal` bends the Bézier
 * the way the ports read (side ports slide horizontally, vertical flow
 * lines curve downward).
 */
export function portEdgeEnds(
  a: BlockRect,
  b: BlockRect,
  fromRole: PortRole,
  toRole: PortRole,
): EdgeEnds {
  const from = portCenter(a, fromRole);
  const to = portCenter(b, toRole);
  // Horizontal reads: into a side port. A top in-port belongs to the
  // vertical body flow (branch heads and column links), and the `if`
  // card's own input is its *left* side port — it carries no top
  // in-port — so every wire into an `if` reads through the side pair.
  const isHorizontal = toRole === "inLeft";
  return {
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    horizontal: isHorizontal,
  };
}

/**
 * The chain edge between two ordinary blocks: out of the source's right
 * out-port, into the target's left in-port.
 */
export function edgeEnds(a: BlockRect, b: BlockRect): EdgeEnds {
  return portEdgeEnds(a, b, "outRight", "inLeft");
}

/** Cubic Bézier for vertical edges: down from the source, into the
 * target's top edge. */
export function verticalEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const bend = Math.max(32, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 3);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

/**
 * One vertical If/Else body container: the drawn frame around the
 * blocks an `if`'s branch runs. `empty` marks a branch the engine
 * reports no body for (no members yet) — the canvas still draws a
 * faint frame so the branch's port has somewhere to drop onto; the
 * frame stays clearly a placeholder, not a body the engine owns.
 */
export interface IfBodyFrame {
  readonly branch: BranchSide;
  readonly rect: BlockRect;
  readonly empty: boolean;
}

/**
 * One `if`'s derived vertical subtree shape.
 *
 * `then`/`else` are the branch's *visible* member ids in execution
 * order; `branchOf` maps every visible member to its branch; `frames`
 * carry the container rectangles (member-derived; falls back to a
 * placeholder frame beside the `if` card when the branch is empty);
 * `join` is the merge target's id when the engine reports one.
 */
export interface IfShape {
  readonly ifId: number;
  readonly then: readonly number[];
  readonly else: readonly number[];
  readonly branchOf: ReadonlyMap<number, BranchSide>;
  readonly frames: readonly IfBodyFrame[];
  readonly join: number | null;
}

/**
 * Derive every `if`'s vertical subtree shape from one function's
 * command summaries — presentation truth only: the engine's own
 * `next`, `then_body`, and `else_body` fields, projected once per edit
 * so the canvas (containers, vertical edges, merge rails) never
 * re-derives membership ad hoc. `rectOf`/`ifRectOf` supply the
 * *relative* block rectangles (function-container coordinates); a
 * derived frame must never feed back into engine state.
 */
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
 * newcomer to itself.
 */
export function frameRect(
  members: readonly number[],
  rectOf: (id: number) => BlockRect | undefined,
): BlockRect | null {
  const rects = [];
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

/** Gap between the branch frames' bottom edge and the join circle. */
export const JOIN_GAP = 52;

/** Fallback join-circle box, until the real DOM size is observed. */
export const JOIN_FALLBACK_SIZE = { w: 168, h: 40 } as const;

/**
 * The manual merge join of one `if` ("End of If Block").
 *
 * Purely presentational mirror of a real engine fact: the engine executes
 * the join block once after *either* branch (`select_if_body` continues
 * at the `if`'s own `next` when the body walk stops). Turning the merge
 * on draws that fact the way the user thinks of it — both branch tails
 * flow into one visible join point, and the continuation leaves it —
 * without touching a single pointer.
 */
export interface MergeJoin {
  /** The join circle is shown and the wires flow through it. */
  readonly on: boolean;
  /** Stored top-left in function-container coordinates; `null` = auto. */
  readonly pos: Pos | null;
}

/**
 * Where the join circle sits by default: below **both** branch frames,
 * centered between the two columns. `null` when neither frame exists
 * (no `if` card was laid out yet).
 */
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
