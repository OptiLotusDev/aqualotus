import type { Pos } from "./layout";

/**
 * Presentation-only program-model projection (P17/P20).
 *
 * The runtime exposes one package (`app`) and many functions. Packages
 * and structs shown on the canvas are visual architecture only: they
 * are never sent into the Optilotus bridge and never affect execution
 * semantics. This module owns that presentation mapping as honest pure
 * functions so the canvas can read as Package → Struct → Function →
 * Blocks today, and adopt real packages/structs later without throwing
 * the UI away.
 *
 * Calls (`name()` inside assign/return expressions) execute in the
 * engine but deliberately draw no arrows: the only drawn relationship
 * is the `next` flow chain.
 */

/** Hardcoded package snapshot name in the Rust core (`PACKAGE_NAME`). */
export const PACKAGE_NAME = "app";

/** Single presentation struct grouping all functions until structs exist. */
export const PRESENTATION_STRUCT_ID = "preview-struct-main";

/** Display name of the presentation struct. */
export const PRESENTATION_STRUCT_NAME = "Main";

/** Breadcrumb path shown in the top bar and inspector. */
export function breadcrumbPath(functionName: string | null): string {
  if (functionName === null || functionName === "") {
    return `${PACKAGE_NAME} / ${PRESENTATION_STRUCT_NAME}`;
  }
  return `${PACKAGE_NAME} / ${PRESENTATION_STRUCT_NAME} / ${functionName}`;
}

/** Vertical stack for function containers inside the struct container. */
export function layoutFunctionContainers(
  ids: readonly number[],
  startY = 64,
  gapY = 28,
  heights?: Readonly<Record<number, number>>,
): Record<number, Pos> {
  const out: Record<number, Pos> = {};
  let cursor = startY;
  for (const id of ids) {
    out[id] = { x: 28, y: cursor };
    const height = heights?.[id] ?? 220;
    cursor += height + gapY;
  }
  return out;
}
