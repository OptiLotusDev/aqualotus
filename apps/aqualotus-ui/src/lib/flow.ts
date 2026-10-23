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
interface BranchCandidate {
  readonly side: "then" | "else";
  readonly members: readonly CommandSummary[];
  /** Visible print members, in branch-list order. */
  readonly prints: readonly CommandSummary[];
}

/**
 * The flows the run travelled, in execution order.
 *
 * The walk follows the engine's entry chain (its `next` edges plus the
 * planned edges into an `if` — see the module header). At an `if` the
 * resolver decides which branch the run took before it enters one:
 *
 * - each branch's print count comes from the projection's branch list
 *   (a branch carrying a nested `if` is a documented limitation: the
 *   nested walk order is unknowable from the envelope alone, so the
 *   outer `if` stays undecided);
 * - the window is consistent with exactly one candidate when the count
 *   of lines printed this run (`printed.length`) can only be produced
 *   by that branch; and when both counts fit, a branch whose prints are
 *   **pure literals** (quoted text without `{variable}` refs) must
 *   reappear at exactly the positions the run would print them — a
 *   matching branch is proven, a contradicting one is excluded;
 * - when both candidates are still possible, or when the window itself
 *   is empty (an error run has no envelope), the `if` stays undecided:
 *   the visualisation then travels the chain and the `if`'s own edge to
 *   the join and **never either branch** — the glow must not claim a
 *   branch the engine did not report;
 * - one honest exception: when every print-based reading fails but the
 *   `if`'s condition is a **literal** (`true` / `false`, reported by the
 *   engine's own `if_condition`), the branch follows the literal. The
 *   envelope alone cannot distinguish two branches that print identical
 *   lines (the default of the library on both sides, say); the engine,
 *   however, evaluated a constant condition, so which branch ran is not
 *   a guess — it is stated by the condition the engine itself holds.
 * Once one `if` cannot be decided, the number of lines it consumed is
 * no longer bankable, so every later `if` in the same run stays
 * undecided as well. Called functions' outputs and early `return`s are
 * equally unknowable from the envelope; they make the counts disagree
 * with every candidate and land in the same undecided path (chain plus
 * the `if`→join edge for the whole run).
 */
export function resolveRunPath(
  cmds: readonly CommandSummary[],
  entry: number | null,
  fid: number,
  printed: RunPrinted,
  /**
   * Literal conditions per `if` (`"true"` / `"false"` exactly, read from
   * the engine's own `if_condition` at run freeze — nothing folded).
   * Used only when the envelope cannot decide (see the module header).
   */
  literalConditions?: ReadonlyMap<number, boolean>,
): readonly FlowEdge[] {
  if (entry === null) return [];
  const byId = new Map<number, CommandSummary>();
  for (const cmd of cmds) byId.set(cmd.id, cmd);
  /** Branch-body members the projection can draw, in list order. */
  const visible = (
    body: readonly number[] | null | undefined,
  ): CommandSummary[] => {
    if (body === null || body === undefined) return [];
    const out: CommandSummary[] = [];
    for (const id of body) {
      const cmd = byId.get(id);
      if (cmd !== undefined) out.push(cmd);
    }
    return out;
  };

  /**
   * Prints the walk would cover on the chain that starts at `start`,
   * stopping at the first downstream `if` (`null` = unknown: that
   * `if`'s branch may print, which the count alone cannot bank).
   */
  const chainPrintCount = (start: number | null | undefined): number | null => {
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
  };

  /** Quoted text without `{variables}`: the line the engine prints. */
  const printedLineOf = (
    template: string | undefined,
  ): string | null => {
    if (template === undefined) return null;
    const text = template.trim();
    if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) {
      return null;
    }
    const inner = text.slice(1, -1);
    if (inner.includes("{") || inner.includes("\\")) return null;
    return inner;
  };

  /**
   * Which branch the run took at one `if`, or null when the envelope
   * cannot decide. `offset` is how many printed lines the walk passed
   * before the `if`.
   */
  const decideBranch = (
    cmd: CommandSummary,
    offset: number,
  ): "then" | "else" | null => {
    const candidate = (
      side: "then" | "else",
      body: readonly number[] | null | undefined,
    ): BranchCandidate => {
      const members = visible(body);
      return { side, members, prints: members.filter((m) => m.kind === "print") };
    };
    const candidates = [
      candidate("then", cmd.then_body),
      candidate("else", cmd.else_body),
    ];
    // Nested `if`s: the engine walks the taken branch's own branches by
    // rules the envelope cannot recover; the outer decision stays open
    // (see the module doc — pivot documented limitation).
    if (
      candidates.some((c) => c.members.some((m) => m.kind === "if"))
    ) {
      return null;
    }
    const joinCount = chainPrintCount(cmd.next);
    const viable = (candidate: BranchCandidate): boolean => {
      if (
        joinCount !== null &&
        printed.length !== offset + candidate.prints.length + joinCount
      ) {
        return false;
      }
      // A contradicting literal excludes the branch; unverifiable
      // positions (variable templates) are tolerated.
      for (let i = 0; i < candidate.prints.length; i += 1) {
        const print = candidate.prints[i];
        const line = printedLineOf(print?.template);
        if (line === null) continue;
        if (printed[offset + i] !== line) return false;
      }
      return true;
    };
    /** Every line verified: the branch is positively proven. */
    const proven = (candidate: BranchCandidate): boolean => {
      if (candidate.prints.length === 0) return false;
      for (let i = 0; i < candidate.prints.length; i += 1) {
        const print = candidate.prints[i];
        if (printedLineOf(print?.template) === null) return false;
        if (printed[offset + i] !== printedLineOf(print?.template)) {
          return false;
        }
      }
      return true;
    };
    const thenViable = viable(candidates[0]);
    const elseViable = viable(candidates[1]);
    if (thenViable !== elseViable) {
      return thenViable ? "then" : "else";
    }
    // Both are still possible: a proven branch (all its literal prints
    // reappeared in the window) beats an unverifiable one — and a tie
    // (e.g. identical literals, or no print evidence) stays undecided.
    const thenProven = proven(candidates[0]);
    const elseProven = proven(candidates[1]);
    if (thenProven !== elseProven) {
      return thenProven ? "then" : "else";
    }
    // Envelope exhausted: a literal condition the engine itself holds is
    // not a guess — it names the branch the run took (see module header).
    const literal = literalConditions?.get(cmd.id);
    if (literal !== undefined) {
      return literal ? "then" : "else";
    }
    return null;
  };

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
      const taken = decideBranch(cmd, offset);
      if (taken !== null) {
        const members = visible(taken === "then" ? cmd.then_body : cmd.else_body);
        // The decided branch: its wire into the first member, its
        // member→member column links, and, when there is a successor, the
        // engine's merge back into the join block (the branch tail exits
        // to the `if`'s own `next` — `Package::if_append` ends the
        // member's chain there). A terminal `if` has no join, so no
        // merge edge is drawn — there is nothing to rejoin into.
        if (members.length > 0) {
          edges.push({
            fid,
            from: cmd.id,
            to: members[0]!.id,
            kind: "branch-head",
          });
          for (let i = 0; i + 1 < members.length; i += 1) {
            edges.push({
              fid,
              from: members[i]!.id,
              to: members[i + 1]!.id,
              kind: "chain",
            });
          }
          const tail = members[members.length - 1]!.id;
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
export function truncateFlow(
  state: FlowState,
  failedCommandId: number,
): FlowState {
  const into = state.edges.findIndex((edge) => edge.to === failedCommandId);
  if (into >= 0) {
    const edges = state.edges.slice(0, into + 1);
    if (edges.length === state.edges.length) return state;
    return { ...state, edges };
  }
  const out = state.edges.findIndex((edge) => edge.from === failedCommandId);
  if (out >= 0) {
    const edges = state.edges.slice(0, out);
    if (edges.length === state.edges.length) return state;
    return { ...state, edges };
  }
  return state;
}

/** Total lifetime of the sweep, in milliseconds: one link after another. */
export function flowDuration(state: FlowState): number {
  return state.edges.length * state.linkMs;
}
