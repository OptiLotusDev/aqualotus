/**
 * Topological link planning: the visible connections of one function,
 * derived from the engine's own `next`, `then_body`, and `else_body`
 * fields — projected once per edit so the canvas never re-derives
 * membership ad hoc.
 *
 * The engine keeps an `if`'s condition in a **hidden compute command**
 * that has to run immediately before the `if`. That compute is not a
 * user command, so the engine's user-level `next` edge cannot express
 * "block X is followed by an `if`": `Package::user_next` reports
 * `None` whenever the raw successor is not a user command. The engine
 * therefore cannot report the edge into an `if` — a documented engine
 * limitation. The UI compensates by remembering the connections it
 * planned: a connection the engine accepted (the bridge confirmed it)
 * but cannot report is marked `planned`.
 */

/** The shape the graph model needs from a command summary. Structural on
 * purpose: the engine's `CommandSummary` and the UI's projection both
 * satisfy it. */
export interface GraphCommand {
  readonly id: number;
  readonly next: number | null;
  readonly kind?: string;
  readonly then_body?: readonly number[];
  readonly else_body?: readonly number[];
  /**
   * The successor came from the UI's plan, not from the engine: it is
   * the edge into an `if`, whose hidden condition compute the engine
   * cannot report. */
  readonly planned?: boolean;
}

/** Every raw id the engine lists in an `if`'s branch bodies.
 *
 * A branch list carries *every raw node* of a member (a print owns a
 * hidden tail node), so this set mixes visible blocks with hidden
 * nodes. Callers that need blocks filter it through
 * {@link visibleBranchMembers}. */
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

/** The visible blocks of one `if` branch, in execution order.
 *
 * The engine's branch list starts at the branch's first **raw** node,
 * which is not always a block the canvas can draw (a cast's group
 * starts at its hidden compute node). Only the ids the engine also
 * reports as commands are blocks, and the first of those is the
 * branch's head — the block the `if`'s branch wire must start at. */
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
 * `next` edges plus the planned edges into an `if`) cannot arrive at it
 * unless the engine runs it *from* an `if` (a branch member: the walk
 * follows the user-level pointers, and the branch lists are part of
 * every command summary, so the UI knows them without any second
 * semantics).
 *
 * With no entry point every block except branch members is unreached —
 * the run is a flat no-op. The count never lies about the engine; the
 * caller turns it into the "blocks aren't connected" notice. */
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
   * `null` for a chain edge. */
  readonly branch: "then" | "else" | null;
  /**
   * The engine's summary cannot report this connection (it is the edge
   * into an `if`, whose hidden condition compute hides it). The UI
   * planned it and the bridge accepted it. */
  readonly planned: boolean;
}

/**
 * The visible connections of one function.
 *
 * Three kinds, kept apart on purpose:
 * - **chain edges** — the engine's own `next` pointers (confirmed by
 *   the engine);
 * - **planned edges** — the edge into an `if`, which the engine cannot
 *   report;
 * - **branch edges** — the `if`'s port to the head of one of its
 *   branches; the engine confirms them through the branch lists.
 *
 * Only *visible* blocks are connected: an edge never starts or ends at
 * a hidden raw node (the `if`'s condition compute, a print's hidden
 * tail), and no connection is drawn twice. */
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

/** The user-visible entry point of a function.
 *
 * The engine's entry can point at a **hidden** node: when an `if`
 * heads the chain, the engine points the entry at the `if`'s condition
 * compute, and that id is not a block. The chain still starts at the
 * `if` itself — the compute is spliced right before it — and
 * `Package::list_commands` reports the reachable chain before the
 * orphans, so the first command it reports is the chain's first block.
 *
 * `null` means "the UI cannot name the entry": either there is none,
 * or the hidden entry belongs to an `if` that no longer exists (the
 * engine keeps pointing at the orphaned compute). The UI then says
 * "no entry point" instead of claiming a connection the runtime does
 * not have. */
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

/** The two branch outputs of an `if`. `then` executes when the condition
 * holds (TRUE), `else` when it does not (FALSE) — the engine's own word
 * choice (`IfSide::Then`, `IfSide::Else`). */
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
 * bottom), never for semantics — membership stays the engine's. */
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

/** One engine-implied *merge* connection: a branch body's last visible
 * member → the block after the `if` (its user-level `next`).
 *
 * The engine ends a member's chain there (`if_append` sets the moved
 * group's tail `next = None`), so the body's final edge is *not* a
 * `next` edge — the executor walks the body from `body[0]` and, when
 * the walk stops (the tail), continues at the `if`'s own `next`. That
 * continuation is the merge point every branch rejoins; it is engine
 * truth (`select_if_body`'s documented contract), just not a reported
 * pointer. Deriving it from the engine's own branch lists + `next` is
 * presentation the way the "planned" edges are: never a second
 * semantics. */
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
 * has no continuation block to rejoin into at all. */
export interface MergeJoinRail {
  /** The `if` whose branch the rail belongs to. */
  readonly ifId: number;
  readonly branch: BranchSide;
  /**
   * The block the rail leaves: the branch's visible tail, or the `if`
   * itself when its branch is empty (`emptyBranch` then). */
  readonly from: number;
  /** `true` when the branch has no member — the rail leaves the `if`'s own TRUE/FALSE port. */
  readonly emptyBranch: boolean;
}

/**
 * The manual-merge rails of every `if`: one per branch, populated or
 * empty. `mergeEdgesOf` above is the classic-mode derivation (a tail
 * runs straight into the block after the `if`, which requires a visible
 * successor, an empty branch draws nothing); this one exists for join
 * mode, where the circle itself anchors an empty branch and a missing
 * continuation changes nothing — the engine's `next` is not consulted
 * at all, this is pure branch-list presentation. */
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
        out.push({ ifId: cmd.id, branch, from: cmd.id, emptyBranch: true });
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

/** The last block of the chain that starts at `entry`.
 *
 * Walks the user-level `next` edges, so the hidden compute of an `if`
 * is skipped (the `if` is the block that follows it). Returns `null`
 * when there is no chain (no entry, or the entry is not a block). */
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
