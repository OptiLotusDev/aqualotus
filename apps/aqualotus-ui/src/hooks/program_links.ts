/**
 * Link topology for one function: the logical user-level `next` edges
 * plus the connections the engine accepted but cannot report
 * (the edge into an `if`).
 *
 * These are pure functions over command summaries and the planned-links
 * overlay. They never touch React state or the bridge; `useProgram`
 * owns the `plannedRef` map and calls them when applying plans.
 */

import type { CommandSummary } from "../lib/optilotus";
import type { UiCommand } from "../lib/program";
import type { LinkPlan } from "../lib/graph";
import type { HistoryIdMap } from "../lib/history";

/** `from` → `to`, where `to` is always an `if`. */
export type PlannedLinks = Map<number, number>;

/** The overlay of one function (empty when it has no planned links). */
export function plannedLinksOf(
  planned: ReadonlyMap<number, PlannedLinks>,
  fid: number,
): PlannedLinks {
  return planned.get(fid) ?? new Map<number, number>();
}

/**
 * Merge the engine's command summaries with the connections the UI
 * planned and the engine accepted but cannot report.
 *
 * A planned link only fills a gap the engine left open: when the
 * engine reports the successor itself, the engine's value wins and the
 * command is not marked as planned. A planned link whose target is
 * gone is dropped, so a deleted block never keeps a stale connection.
 *
 * Exported for the engine-level integration tests: they must build the
 * same projection the canvas sees (see `load`).
 */
export function withPlannedLinks(
  cmds: readonly CommandSummary[],
  planned: ReadonlyMap<number, number>,
): UiCommand[] {
  if (planned.size === 0) return [...cmds];
  const known = new Set(cmds.map((c) => c.id));
  return cmds.map((c) => {
    const link = planned.get(c.id);
    if (link === undefined) return c;
    if (c.next !== null && c.next !== undefined) return c;
    if (!known.has(link)) return c;
    return { ...c, next: link, planned: true };
  });
}

/**
 * Record the connections of a link plan the engine cannot report.
 *
 * Only the edge *into* an `if` needs remembering: every other
 * successor is the engine's own `next`. A rewired block loses its old
 * planned link, so a plan that moves a block away from an `if` never
 * leaves a stale connection behind.
 */
export function recordPlannedLinks(
  planned: Map<number, PlannedLinks>,
  fid: number,
  plan: LinkPlan,
  cmds: readonly CommandSummary[],
  remap: HistoryIdMap,
): void {
  const links = new Map(planned.get(fid) ?? []);
  const kindOf = new Map(cmds.map((c) => [c.id, c.kind]));
  for (const edit of plan.edits) {
    const id = remap.resolve(edit.id);
    const next = edit.next === null ? null : remap.resolve(edit.next);
    if (next !== null && kindOf.get(next) === "if") {
      links.set(id, next);
    } else {
      links.delete(id);
    }
  }
  if (links.size === 0) {
    planned.delete(fid);
  } else {
    planned.set(fid, links);
  }
}

/** Remember one planned connection (the engine cannot report it). */
export function setPlannedLink(
  planned: Map<number, PlannedLinks>,
  fid: number,
  from: number,
  to: number,
): void {
  const links = planned.get(fid) ?? new Map<number, number>();
  links.set(from, to);
  planned.set(fid, links);
}

/**
 * Drop the planned links of the blocks a plan rewrites.
 *
 * Used when the engine's state cannot be read: an unknown state must
 * not leave a connection behind that the engine may not have.
 */
export function forgetPlannedLinks(
  planned: Map<number, PlannedLinks>,
  fid: number,
  plan: LinkPlan,
  remap: HistoryIdMap,
): void {
  const links = planned.get(fid);
  if (links === undefined) return;
  for (const edit of plan.edits) {
    links.delete(remap.resolve(edit.id));
  }
  if (links.size === 0) planned.delete(fid);
}

/** Drop the planned connection one block had (it left the chain). */
export function forgetPlannedLink(
  planned: Map<number, PlannedLinks>,
  fid: number,
  id: number,
): void {
  const links = planned.get(fid);
  if (links === undefined) return;
  links.delete(id);
  if (links.size === 0) planned.delete(fid);
}

/** The logical successor of one command (the engine's edge, else planned). */
export function logicalNextOf(
  cmds: readonly CommandSummary[],
  planned: PlannedLinks,
  id: number,
): number | null {
  const cmd = cmds.find((c) => c.id === id);
  if (cmd === undefined) return null;
  if (cmd.next !== null && cmd.next !== undefined) return cmd.next;
  return planned.get(id) ?? null;
}
