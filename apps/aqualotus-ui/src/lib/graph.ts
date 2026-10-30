/**
 * Generic SVG edge helpers plus minimal topological link planning.
 *
 * This file is now a thin barrel over four cohesive modules:
 * - `graph_links` — connection drop planning (`planDropLink`,
 *   `planChainAll`, `planLinkAfter`, `planLinkBefore`, `planMoveToEnd`);
 * - `graph_topology` — visible edges and membership
 *   (`edgesOf`, `mergeEdgesOf`, `mergeJoinRailsOf`,
 *   `visibleBranchMembers`, `branchOwnerOf`, `resolveEntry`,
 *   `chainTailOf`, `countUnconnectedBlocks`);
 * - `graph_geometry` — port centres and edge geometry
 *   (`portCenter`, `edgeEnds`, `branchEdgeEnds`, `columnEdgeEnds`,
 *   `BRANCH_PORT_FRACTION`);
 * - `graph_shapes` — `if` branch frames and the manual merge join
 *   (`buildIfShapes`, `frameRect`, `joinDefaultPos`, `JOIN_GAP`,
 *   `JOIN_FALLBACK_SIZE`).
 *
 * The public surface is unchanged: every name below is re-exported so
 * existing imports from `../lib/graph` keep working. No signature,
 * ordering, or behaviour changed — only file placement.
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

/* Connection / link planning. */
export {
  type EntryUpdate,
  type LinkEdit,
  type LinkPlan,
  planChainAll,
  planDropLink,
  planLinkAfter,
  planLinkBefore,
  planMoveToEnd,
  predecessorsOf,
  type DropWhere,
} from "./graph_links";

/* Topological edges and branch membership. */
export {
  type BranchOwner,
  type BranchSide,
  type GraphCommand,
  type LogicalEdge,
  type MergeEdge,
  type MergeJoinRail,
  branchMemberIds,
  branchOwnerOf,
  chainTailOf,
  countUnconnectedBlocks,
  edgesOf,
  mergeEdgesOf,
  mergeJoinRailsOf,
  resolveEntry,
  visibleBranchMembers,
} from "./graph_topology";

/* Port centres and edge geometry. */
export {
  type BlockRect,
  type BlockSide,
  type EdgeEnds,
  type PortPoint,
  type PortRole,
  BRANCH_PORT_FRACTION,
  branchEdgeEnds,
  columnEdgeEnds,
  edgeEnds,
  edgePath,
  portCenter,
  portEdgeEnds,
  verticalEdgePath,
} from "./graph_geometry";

/* If branch shapes and the manual merge join. */
export {
  type IfBodyFrame,
  type IfShape,
  type MergeJoin,
  JOIN_GAP,
  JOIN_FALLBACK_SIZE,
  buildIfShapes,
  frameRect,
  joinDefaultPos,
} from "./graph_shapes";
