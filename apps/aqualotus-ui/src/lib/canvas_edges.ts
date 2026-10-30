/**
 * Canvas edge path computation.
 *
 * Builds the drawn SVG path list for one render: every semantic edge
 * (chain, branch wire, column link, merge rail, manual-merge rail,
 * join→continuation wire) as a `{ key, from, to, fid, d, planned, merge,
 * joinTail?, joinIfId? }` record. Pure over block rectangles and the
 * graph-model edges; never touches React state or the DOM.
 *
 * The component calls this once per program edit (memoized), never per
 * scroll frame. Paint cost is bounded by the viewport-sized SVG overlay
 * which clips, not by skipping paths here.
 */

import type { CommandSummary } from "../lib/optilotus";
import {
  edgesOf,
  mergeEdgesOf,
  mergeJoinRailsOf,
  type BlockRect,
  type BranchSide,
  type IfShape,
  type PortRole,
  branchEdgeEnds,
  columnEdgeEnds,
  edgeEnds,
  edgePath,
  portEdgeEnds,
  verticalEdgePath,
} from "../lib/graph";
/** One connection as the edges layer draws it. */
export interface CanvasDrawnEdge {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly fid: number;
  readonly d: string;
  /** The engine cannot report this edge (the planned `into an if` gap). */
  readonly planned: boolean;
  /** A merge wire or the `if`'s own post-body continuation rail. */
  readonly merge: boolean;
  /** Manual-merge mode: this rail ends at the branch's join circle. */
  readonly joinTail?: boolean;
  readonly joinIfId?: number;
}

/** The per-function context the edge builder needs. */
export interface EdgeBuildContext {
  readonly cmds: readonly CommandSummary[];
  readonly byId: Map<number, number>;
  readonly worldRect: (c: CommandSummary, i: number) => BlockRect;
  readonly joinOn: (ifId: number) => boolean;
  readonly owners: ReadonlyMap<number, { ifId: number; branch: BranchSide }>;
  readonly joinWorldRect: (ifId: number) => BlockRect | null;
  readonly ifShapes: readonly IfShape[];
  readonly fid: number;
}

/** Build every drawn edge of one function, in drawing order. */
export function buildEdges(ctx: EdgeBuildContext): CanvasDrawnEdge[] {
  const {
    cmds,
    byId,
    worldRect,
    joinOn,
    owners,
    joinWorldRect,
    ifShapes,
    fid,
  } = ctx;
  const out: CanvasDrawnEdge[] = [];

  for (const edge of edgesOf(cmds)) {
    const fromIndex = byId.get(edge.from);
    const toIndex = byId.get(edge.to);
    if (fromIndex === undefined || toIndex === undefined) continue;
    const from = cmds[fromIndex];
    const to = cmds[toIndex];
    if (from === undefined || to === undefined) continue;
    const a = worldRect(from, fromIndex);
    const b = worldRect(to, toIndex);
    if (edge.branch !== null) {
      // Branch wire: the `if`'s bottom TRUE/FALSE port down into the
      // head of the branch (the body's first *visible* member). The
      // head is entered through its top edge — a branch body reads
      // top → bottom.
      const ends = branchEdgeEnds(a, b, edge.branch);
      out.push({
        key: `${fid}:branch:${edge.branch}:${edge.from}:head`,
        from: edge.from,
        to: edge.to,
        fid,
        d: verticalEdgePath(ends.x1, ends.y1, ends.x2, ends.y2),
        planned: false,
        merge: false,
      });
      continue;
    }
    // The `if` card carries no right out-port: its continuation never
    // leaves the card directly. Join off — the branch tails' merge rails
    // carry the flow onward (below); join on — the manual join circle's
    // own wire does (also below). One drawn truth per connection, never
    // two.
    if (from.kind === "if") continue;
    const ownerFrom = owners.get(edge.from);
    const ownerTo = owners.get(edge.to);
    if (
      ownerFrom !== undefined &&
      ownerTo !== undefined &&
      ownerFrom.ifId === ownerTo.ifId &&
      ownerFrom.branch === ownerTo.branch
    ) {
      // Column link: member → next member of the same body.
      const ends = columnEdgeEnds(a, b);
      out.push({
        key: `${fid}:${edge.from}`,
        from: edge.from,
        to: edge.to,
        fid,
        d: verticalEdgePath(ends.x1, ends.y1, ends.x2, ends.y2),
        planned: edge.planned,
        merge: false,
      });
      continue;
    }
    // Every chain edge reads left → right through the side ports — the
    // `if` card's input is its left in-port (its TRUE/FALSE pair enters
    // the branch bodies, never the card's top).
    const ends = edgeEnds(a, b);
    out.push({
      key: `${fid}:${edge.from}`,
      from: edge.from,
      to: edge.to,
      fid,
      d: ends.horizontal
        ? edgePath(ends.x1, ends.y1, ends.x2, ends.y2, true)
        : verticalEdgePath(ends.x1, ends.y1, ends.x2, ends.y2),
      planned: edge.planned,
      // No chain edge leaves the `if` card any more (no right port):
      // only ordinary blocks chain side to side here.
      merge: false,
    });
  }

      // Merge rails (join off): each populated branch's tail runs back into
      // the block after the `if` (the engine's documented join — the body
      // walk stops at the tail and flow continues at the `if`'s own `next`).
      // Engine truth, never a reported pointer. With the join on, the
      // circular join of the same fact is drawn from `mergeJoinRailsOf` below
      // instead.
      for (const merge of mergeEdgesOf(cmds)) {
        if (joinWorldRect(merge.ifId) !== null) continue;
    const fromIndex = byId.get(merge.from);
    const toIndex = byId.get(merge.to);
    if (fromIndex === undefined || toIndex === undefined) continue;
    const from = cmds[fromIndex];
    const to = cmds[toIndex];
    if (from === undefined || to === undefined) continue;
    const ends = edgeEnds(worldRect(from, fromIndex), worldRect(to, toIndex));
    out.push({
      key: `${fid}:merge:${merge.from}`,
      from: merge.from,
      to: merge.to,
      fid,
      d: edgePath(ends.x1, ends.y1, ends.x2, ends.y2, ends.horizontal),
      planned: false,
      merge: true,
    });
  }

  // Manual-merge mode (the join circle shown): one incoming rail per
  // TRUE/FALSE branch — a populated branch through its tail's bottom
  // port, an **empty** branch through the `if` card's own TRUE/FALSE
  // port — so both arrows address the circle even when the `if` has no
  // continuation block at all (the circle is the branch flows'
  // destination; `next` is not read here). One circle→continuation wire
  // carries the flow onward, once per `if` (the else branch below).
  for (const rail of mergeJoinRailsOf(cmds)) {
    if (!joinOn(rail.ifId)) continue;
    const join = joinWorldRect(rail.ifId);
    if (join === null) continue;
    const fromIndex = byId.get(rail.from);
    const from =
      fromIndex === undefined ? undefined : cmds[fromIndex];
    if (from === undefined || fromIndex === undefined) continue;
    // A tail's rail leaves the body's bottom port; an empty branch's
    // rail leaves the `if` card's own TRUE/FALSE port.
    const fromRole: PortRole = rail.emptyBranch ? rail.branch : "outBottom";
    const ends = portEdgeEnds(
      worldRect(from, fromIndex),
      join,
      fromRole,
      "joinIn",
    );
    out.push({
      key: rail.emptyBranch
        ? `${fid}:merge:${rail.ifId}:${rail.branch}`
        : `${fid}:merge:${rail.from}`,
      from: rail.from,
      // `to` names the join circle's host card: the rail's drawn end is
      // the circle itself (keyed by its `if`), and the `jo:` wire below
      // carries the flow past it.
      to: rail.ifId,
      fid,
      d: verticalEdgePath(ends.x1, ends.y1, ends.x2, ends.y2),
      planned: false,
      merge: true,
      joinTail: true,
      joinIfId: rail.ifId,
    });
  }

  // The join circle's continuation wire, once per `if` (every tail rail
  // shares it — the travelled path expands through both without drawing
  // it twice).
  const joinOutSeen = new Set<number>();
  for (const shape of ifShapes) {
    if (!joinOn(shape.ifId)) continue;
    if (joinOutSeen.has(shape.ifId)) continue;
    joinOutSeen.add(shape.ifId);
    const join = joinWorldRect(shape.ifId);
    const contId = shape.join;
    if (join === null || contId === null) continue;
    const contIndex = byId.get(contId);
    const cont =
      contIndex === undefined ? undefined : cmds[contIndex];
    if (cont === undefined || contIndex === undefined) continue;
    const ends = portEdgeEnds(
      join,
      worldRect(cont, contIndex),
      "joinOut",
      "inLeft",
    );
    out.push({
      key: `${fid}:jo:${shape.ifId}`,
      from: shape.ifId,
      to: contId,
      fid,
      d: edgePath(ends.x1, ends.y1, ends.x2, ends.y2, ends.horizontal),
      planned: false,
      merge: true,
      joinIfId: shape.ifId,
    });
  }

  return out;
}
