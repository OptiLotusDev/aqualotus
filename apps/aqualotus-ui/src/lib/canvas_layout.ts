/**
 * Pure canvas layout: package/struct/function dimensions, world geometry,
 * and container positioning. Honest functions over explicit inputs — no
 * React state, no DOM.
 */

import type { CommandSummary } from "../lib/optilotus";
import type { Pos, LayoutMap } from "./layout";
import type { Size } from "../components/visualEditor_constants";
import {
  FALLBACK_SIZE,
  FUNC_GAP,
  FUNC_MIN_HEIGHT,
  FUNC_MIN_WIDTH,
  PKG_HEAD,
  PKG_PAD,
  STRUCT_HEAD,
  STRUCT_PAD,
  WORLD_CENTER,
  WORLD_SIZE,
  fallbackPos,
} from "../components/visualEditor_constants";
import type { IfShape } from "./graph";

/**
 * The full world geometry of the Package → Struct → Function nesting,
 * in canvas coordinates (before zoom). Pure over the program summaries,
 * the layout store, observed block sizes, the package drag offset, and
 * the derived if shapes.
 */
export interface CanvasLayout {
  /** Stored or fallback position of one command within its function. */
  posOf: (fid: number, cmd: CommandSummary, index: number) => Pos;
  /** Function container heights, keyed by fid. */
  readonly heights: Map<number, number>;
  /** Function container widths, keyed by fid. */
  readonly widths: Map<number, number>;
  /** Vertical cursor (top offset) of each function container. */
  readonly ys: Map<number, number>;
  readonly structW: number;
  readonly structH: number;
  readonly pkgW: number;
  readonly pkgH: number;
  readonly worldW: number;
  readonly worldH: number;
  /** Package position in world coordinates (includes pkgOff drag). */
  readonly pkgPos: Pos;
  /** Struct container origin in world coordinates. */
  readonly structOrigin: Pos;
  /** Function container origin in world coordinates. */
  readonly funcOrigin: (fid: number) => Pos;
}

/**
 * Compute the full canvas layout from explicit inputs. Memoize at the
 * call site so effects can depend on it without re-running every render.
 */
export function computeCanvasLayout({
  functions,
  commandsByFunction,
  layoutStore,
  sizes,
  pkgOff,
  ifShapesByFunction,
}: {
  readonly functions: readonly { readonly id: number; readonly name: string }[];
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
  readonly layoutStore: Readonly<Record<number, LayoutMap>>;
  readonly sizes: ReadonlyMap<string, Size>;
  readonly pkgOff: Pos;
  readonly ifShapesByFunction: ReadonlyMap<number, readonly IfShape[]>;
}): CanvasLayout {
  function posOf(fid: number, cmd: CommandSummary, index: number): Pos {
    const stored = layoutStore[fid]?.[cmd.id];
    if (stored !== undefined) return stored;
    return fallbackPos(index);
  }
  function size(fid: number, id: number): Size {
    return sizes.get(`${fid}:${id}`) ?? FALLBACK_SIZE;
  }

  const heights = new Map<number, number>();
  const widths = new Map<number, number>();
  for (const fn of functions) {
    const cmds = commandsByFunction[fn.id] ?? [];
    let bottom = 0;
    let right = 0;
    cmds.forEach((cmd, index) => {
      const p = posOf(fn.id, cmd, index);
      bottom = Math.max(bottom, p.y + size(fn.id, cmd.id).h);
      right = Math.max(right, p.x + size(fn.id, cmd.id).w);
    });
    for (const shape of ifShapesByFunction.get(fn.id) ?? []) {
      for (const frame of shape.frames) {
        bottom = Math.max(bottom, frame.rect.y + frame.rect.h);
        right = Math.max(right, frame.rect.x + frame.rect.w);
      }
    }
    heights.set(
      fn.id,
      Math.max(FUNC_MIN_HEIGHT, bottom === 0 ? 0 : bottom + 36),
    );
    widths.set(
      fn.id,
      Math.max(FUNC_MIN_WIDTH, right === 0 ? 0 : right + 56),
    );
  }

  const ys = new Map<number, number>();
  let cursor = STRUCT_PAD;
  for (const fn of functions) {
    ys.set(fn.id, cursor);
    cursor += (heights.get(fn.id) ?? FUNC_MIN_HEIGHT) + FUNC_GAP;
  }
  const lastId = functions[functions.length - 1]?.id ?? -1;
  const contentH =
    functions.length === 0
      ? STRUCT_PAD * 2 + 120
      : (ys.get(lastId) ?? 0) +
        (heights.get(lastId) ?? FUNC_MIN_HEIGHT) +
        STRUCT_PAD;
  let contentW = FUNC_MIN_WIDTH;
  for (const fn of functions) {
    contentW = Math.max(contentW, widths.get(fn.id) ?? FUNC_MIN_WIDTH);
  }
  const structW = contentW + STRUCT_PAD * 2;
  const structH = STRUCT_HEAD + contentH;
  const pkgW = structW + PKG_PAD * 2;
  const pkgH = PKG_HEAD + PKG_PAD + structH + PKG_PAD;

  const pkgPos: Pos = {
    x: WORLD_CENTER + pkgOff.x,
    y: WORLD_CENTER + pkgOff.y,
  };
  const structOrigin: Pos = {
    x: pkgPos.x + PKG_PAD,
    y: pkgPos.y + PKG_HEAD + PKG_PAD,
  };
  function funcOrigin(fid: number): Pos {
    return {
      x: structOrigin.x + STRUCT_PAD,
      y: structOrigin.y + STRUCT_HEAD + (ys.get(fid) ?? STRUCT_PAD),
    };
  }
  return {
    posOf,
    heights,
    widths,
    ys,
    structW,
    structH,
    pkgW,
    pkgH,
    worldW: Math.max(WORLD_SIZE, pkgPos.x + pkgW + WORLD_SIZE),
    worldH: Math.max(WORLD_SIZE, pkgPos.y + pkgH + WORLD_SIZE),
    pkgPos,
    structOrigin,
    funcOrigin,
  };
}
