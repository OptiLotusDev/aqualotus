import type { CSSProperties } from "react";
import type { CommandSummary } from "./optilotus";

/** Style bag that also carries CSS custom properties. */
export type FlowStyle = CSSProperties & Record<`--${string}`, string | number>;

/**
 * Execution-flow visualisation model (presentation only).
 *
 * The engine runs `main` and walks its `next` chain from the entry
 * command one command at a time; at an `if` it runs one branch and then
 * continues at the `if`'s own successor. The bridge exposes no
 * per-step trace, so the travelled path is **derived from the run's
 * own envelope** (`resolveRunPath`): the chain edges always travel, a
 * branch is followed only where the window (`printed`) is consistent
 * with exactly that branch, and nowhere does the visualisation glow
 * both branches of one `if` — engine truth only, no UI-evaluated
 * conditions. Blocks inside called functions are not animated — the
 * UI cannot know whether or when a callee ran.
 */

/** One connection of the executed chain. */
export interface FlowEdge {
  /** Function the connection belongs to. */
  readonly fid: number;
  /** Source command id. */
  readonly from: number;
  /** Target command id. */
  readonly to: number;
  /**
   * Which connection on screen this one travels:
   * - `"chain"` — the engine's own `next` edge (including planned ones
   *   and same-branch column links); the editor matches it by endpoints;
   * - `"branch-head"` — the `if` card's bottom TRUE/FALSE port running
   *   down into the decided branch's first member;
   * - `"merge"` — the decided branch's tail flowing back into the block
   *   after the `if`. When the manual merge join is on, the editor
   *   expands this into the tail→join segment plus the join→continuation
   *   segment (each exactly once, however many tails exist).
   */
  readonly kind: "chain" | "branch-head" | "merge";
}

/** A running flow visualisation. */
export interface FlowState {
  /** Bumped per run so the animation restarts instead of stacking. */
  readonly runId: number;
  /** Connections to glow, in execution order. */
  readonly edges: readonly FlowEdge[];
  /** Travel time of one connection, in milliseconds. */
  readonly linkMs: number;
}

/**
 * Travel time of a single connection, in milliseconds. The OptiLotus
 * design guide sets the travelling indicator at 300ms per link.
 */
export const FLOW_LINK_MS = 300;

/**
 * Floor for the per-connection travel time: a long chain keeps every
 * link visible instead of turning into a blur.
 */
export const FLOW_MIN_LINK_MS = 120;

/**
 * Upper bound for the whole sweep, so long chains stay responsive.
 */
export const FLOW_MAX_SWEEP_MS = 2400;

/**
 * Segment timing. The design guide travels one link at a time, in
 * order: each connection gets the reference duration, and only a long
 * chain shortens it — never below the floor, never above the guide.
 */
export function flowTimings(count: number): {
  readonly linkMs: number;
} {
  if (count <= 1) return { linkMs: FLOW_LINK_MS };
  const linkMs = Math.max(
    FLOW_MIN_LINK_MS,
    Math.min(FLOW_LINK_MS, Math.floor(FLOW_MAX_SWEEP_MS / count)),
  );
  return { linkMs };
}

/**
 * How a run used a branch, decided **only** from the engine's own run
 * envelope. The resolver never evaluates a condition and never invents
 * runtime success: every decision has to be consistent with what the
 * engine actually printed this run.
 */

/** What a run handed to the flow resolver: its printed lines. */
export type RunPrinted = readonly string[];

/** One `then`/`else` candidate for an `if`'s decision. */
export interface BranchCandidate {
  readonly side: "then" | "else";
  /** Visible members of the branch, in execution order. */
  readonly members: readonly CommandSummary[];
  /** Visible print members, in branch-list order. */
  readonly prints: readonly CommandSummary[];
}

/**
 * Filter a branch body's raw ids to the visible commands the canvas can
 * draw. The engine's branch list starts at the branch's first raw node
 * (not always a drawable block), so only ids that also appear as
 * commands are blocks.
 */
export function visibleBranchBody(
  body: readonly number[] | null | undefined,
  byId: Map<number, CommandSummary>,
): CommandSummary[] {
  const out: CommandSummary[] = [];
  if (body === null || body === undefined) return out;
  for (const id of body) {
    const cmd = byId.get(id);
    if (cmd !== undefined) out.push(cmd);
  }
  return out;
}

/** Quoted text without `{variables}`: the literal line the engine prints. */
export function literalPrintLine(template: string | undefined): string | null {
  if (template === undefined) return null;
  const text = template.trim();
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) {
    return null;
  }
  const inner = text.slice(1, -1);
  if (inner.includes("{") || inner.includes("\\")) return null;
  return inner;
}

/**
 * Print lines the walk would cover on the chain that starts at `start`,
 * stopping at the first downstream `if` (`null` = unknown: that `if`'s
 * branch may print, which the count alone cannot bank). Cycle-safe.
 */
export function chainPrintCount(
  start: number | null | undefined,
  byId: Map<number, CommandSummary>,
): number | null {
  let count = 0;
  const seen = new Set<number>();
  let current: number | null = start ?? null;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const cmd = byId.get(current);
    if (cmd === undefined) break;
    if (cmd.kind === "if") return null;
    if (cmd.kind === "print") count += 1;
    const next = cmd.next;
    if (next === null || next === undefined || !byId.has(next)) break;
    current = next;
  }
  return count;
}

/**
 * Build one `then`/`else` candidate: its visible members and the print
 * members among them.
 */
export function branchCandidate(
  side: "then" | "else",
  body: readonly number[] | null | undefined,
  byId: Map<number, CommandSummary>,
): BranchCandidate {
  const members = visibleBranchBody(body, byId);
  return {
    side,
    members,
    prints: members.filter((m) => m.kind === "print"),
  };
}

/** `true` when a candidate's branch holds a nested `if`. The envelope
 * cannot recover the nested walk order, so the outer decision stays
 * open. */
export function hasNestedIf(candidate: BranchCandidate): boolean {
  return candidate.members.some((m) => m.kind === "if");
}

/** `true` when the printed window is consistent with this candidate:
 * the join-side print count lines up, and every literal print reappears
 * at the position the walk would print it. Variable templates are
 * tolerated (they cannot be verified from the envelope). */
export function candidateViable(
  candidate: BranchCandidate,
  offset: number,
  printed: RunPrinted,
  joinCount: number | null,
): boolean {
  if (joinCount !== null && printed.length !== offset + candidate.prints.length + joinCount) {
    return false;
  }
  for (let i = 0; i < candidate.prints.length; i += 1) {
    const line = literalPrintLine(candidate.prints[i]?.template);
    if (line === null) continue;
    if (printed[offset + i] !== line) return false;
  }
  return true;
}

/** `true` when every line of the candidate is verified: all its prints
 * are literals that reappeared at the exact positions the walk prints
 * them. A branch with no prints is never proven. */
export function candidateProven(
  candidate: BranchCandidate,
  offset: number,
  printed: RunPrinted,
): boolean {
  if (candidate.prints.length === 0) return false;
  for (let i = 0; i < candidate.prints.length; i += 1) {
    const line = literalPrintLine(candidate.prints[i]?.template);
    if (line === null) return false;
    if (printed[offset + i] !== line) return false;
  }
  return true;
}

/**
 * Which branch the run took at one `if`, or null when the envelope
 * cannot decide. `offset` is how many printed lines the walk passed
 * before the `if`.
 *
 * Resolution order:
 * 1. Nested `if` in either body → undecided (module limitation).
 * 2. Exactly one viable candidate (count excludes the other) → decided.
 * 3. Both viable: the proven candidate (all literal prints reappear)
 *    beats the unverifiable one; a tie stays undecided.
 * 4. Envelope exhausted: a literal condition the engine itself holds
 *    names the branch — not a guess, but stated truth.
 */
export function decideBranch(
  cmd: CommandSummary,
  offset: number,
  printed: RunPrinted,
  byId: Map<number, CommandSummary>,
  /**
   * Literal conditions per `if` (`"true"` / `"false"` exactly, read from
   * the engine's own `if_condition` at run freeze — nothing folded).
   * Used only when the envelope cannot decide.
   */
  literalConditions?: ReadonlyMap<number, boolean>,
): "then" | "else" | null {
  const candidates = [
    branchCandidate("then", cmd.then_body, byId),
    branchCandidate("else", cmd.else_body, byId),
  ];
  if (candidates.some((c) => hasNestedIf(c))) {
    return null;
  }
  const joinCount = chainPrintCount(cmd.next, byId);
  const thenViable = candidateViable(candidates[0], offset, printed, joinCount);
  const elseViable = candidateViable(candidates[1], offset, printed, joinCount);
  if (thenViable !== elseViable) {
    return thenViable ? "then" : "else";
  }
  const thenProven = candidateProven(candidates[0], offset, printed);
  const elseProven = candidateProven(candidates[1], offset, printed);
  if (thenProven !== elseProven) {
    return thenProven ? "then" : "else";
  }
  const literal = literalConditions?.get(cmd.id);
  if (literal !== undefined) {
    return literal ? "then" : "else";
  }
  return null;
}

/** The first command of a branch, or undefined when it has none. */
export function firstMember(members: readonly CommandSummary[]): CommandSummary | undefined {
  return members.length === 0 ? undefined : members[0];
}

/**
 * The flows the run travelled, in execution order.
 *
 * The walk follows the engine's entry chain (its `next` edges plus the
 * planned edges into an `if`). At an `if` the resolver decides which
 * branch the run took before it enters one (see `decideBranch`).
 * Once one `if` cannot be decided, every later `if` in the same run
 * stays undecided as well: the walk then travels the chain and the
 * `if`'s own edge to the join, never either branch.
 */
export function resolveRunPath(
  cmds: readonly CommandSummary[],
  entry: number | null,
  fid: number,
  printed: RunPrinted,
  literalConditions?: ReadonlyMap<number, boolean>,
): readonly FlowEdge[] {
  if (entry === null) return [];
  const byId = new Map<number, CommandSummary>();
  for (const cmd of cmds) byId.set(cmd.id, cmd);

  const edges: FlowEdge[] = [];
  const seen = new Set<number>();
  /** How many printed lines the walk passed so far. */
  let offset = 0;
  /**
   * False once an `if` cannot be decided: the window position becomes
   * untrustworthy, so the run stays on the chain for the rest.
   */
  let decidable = true;
  let current: number | null = entry;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const cmd = byId.get(current);
    if (cmd === undefined) break;
    const next = cmd.next;
    // An `if` may be the last block on the chain (no successor, no join):
    // its decided branch still runs, so the glow must travel the branch's
    // head wire and column links even though there is no merge target and
    // no `if`→successor edge to follow. Handle the branch before the
    // terminal-chain break below so a terminal `if` is not skipped.
    if (cmd.kind === "if" && decidable) {
      const taken = decideBranch(cmd, offset, printed, byId, literalConditions);
      if (taken !== null) {
        const members = visibleBranchBody(
          taken === "then" ? cmd.then_body : cmd.else_body,
          byId,
        );
        // The decided branch: its wire into the first member, its
        // member→member column links, and, when there is a successor, the
        // engine's merge back into the join block (the branch tail exits
        // to the `if`'s own `next` — `Package::if_append` ends the
        // member's chain there). A terminal `if` has no join, so no
        // merge edge is drawn — there is nothing to rejoin into.
        if (members.length > 0) {
          const [head] = members;
          edges.push({
            fid,
            from: cmd.id,
            to: head.id,
            kind: "branch-head",
          });
          for (let i = 0; i + 1 < members.length; i += 1) {
            edges.push({
              fid,
              from: members[i].id,
              to: members[i + 1].id,
              kind: "chain",
            });
          }
          const tail = members[members.length - 1].id;
          const join = next;
          if (
            join !== null &&
            join !== undefined &&
            byId.has(join) &&
            cmd.next !== null
          ) {
            edges.push({
              fid,
              from: tail,
              to: join,
              kind: "merge",
            });
          }
        }
        offset += members.filter((m) => m.kind === "print").length;
      } else {
        // First undecided `if`: the rest of the run travels the chain
        // only (never both branches, never an invented branch). A terminal
        // undecided `if` simply has no successor edge to travel.
        decidable = false;
      }
    }
    if (cmd.kind === "print") offset += 1;
    if (next === null || next === undefined || !byId.has(next)) break;
    edges.push({ fid, from: cmd.id, to: next, kind: "chain" });
    current = next;
  }
  return edges;
}

/**
 * Stop the visualisation at the command the engine reported as failed:
 * the connections up to it ran, the ones after it did not. An error
 * that belongs to another function leaves the flow untouched.
 *
 * Two cases, because the engine walks the chain one command at a time:
 * - the failed command was reached through a connection, so that
 *   connection carried flow into it and everything after it did not run;
 * - the failed command is the head of the chain, so it never reached its
 *   own successor: no connection of the chain ran at all.
 */

/**
 * Path-aware truncation.
 *
 * The glow list is ordered in execution order but may contain more than
 * one edge that targets (or originates from) the same command when an
 * `if` has both a merge edge and its own chain edge into the join. Picking
 * the first such edge by array position can cut a path that actually ran
 * (or keep a redundant one). Walk the edges in execution order instead and
 * stop at the edge that is reached on the actual travelled path.
 */
export function truncateFlow(
  state: FlowState,
  failedCommandId: number,
): FlowState {
  const edges = state.edges;
  // Index of the edge that enters the failed command along the travelled
  // path (or -1 when the failed command is the head / unreachable).
  let into = -1;
  let current: number | null = null;
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    if (current === null || edge.from === current) {
      if (edge.to === failedCommandId) {
        into = i;
        break;
      }
      current = edge.to;
    }
  }
  if (into >= 0) {
    const next = edges.slice(0, into + 1);
    if (next.length === edges.length) return state;
    return { ...state, edges: next };
  }
  // Head of the chain (or a command whose outgoing edge is the first on
  // the path): drop everything from its first outgoing edge onward.
  let out = -1;
  let currentOut: number | null = null;
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    if (currentOut === null || edge.from === currentOut) {
      if (edge.from === failedCommandId) {
        out = i;
        break;
      }
      currentOut = edge.to;
    }
  }
  if (out >= 0) {
    const next = edges.slice(0, out);
    if (next.length === edges.length) return state;
    return { ...state, edges: next };
  }
  return state;
}

/** Total lifetime of the sweep, in milliseconds: one link after another. */
export function flowDuration(state: FlowState): number {
  return state.edges.length * state.linkMs;
}
