/**
 * Centralized undo/redo history machinery (P10: single owner).
 *
 * Every undo/redo thunk in `useProgram` resolves stale command ids
 * through `HistoryIdMap` — no per-component remapping logic lives
 * anywhere else. The runtime never reuses ids (deleted ids stay dead),
 * so recreated commands get fresh ids and history entries must translate
 * old ids to their live replacements consistently.
 *
 * `HistoryStore` enforces transactional discipline: an entry moves to
 * the opposite stack only when its thunk reports success. Failures keep
 * the entry where it was, so history never diverges from the runtime.
 */

/** Old command/function id → live replacement id. */
export class HistoryIdMap {
  private readonly forward = new Map<number, number>();

  /** Record that `oldId` now lives on as `newId` (follows chains). */
  track(oldId: number, newId: number): void {
    if (oldId === newId) return;
    const target = this.resolve(newId);
    for (const [key, value] of this.forward) {
      if (value === oldId) {
        this.forward.set(key, target);
      }
    }
    this.forward.set(oldId, target);
  }

  /** Resolve an id recorded earlier to its live replacement. */
  resolve(id: number): number {
    let current = id;
    const seen = new Set<number>([id]);
    for (;;) {
      const next = this.forward.get(current);
      if (next === undefined) return current;
      if (seen.has(next)) return current;
      seen.add(next);
      current = next;
    }
  }

  /** Resolve `null` (chain tail) through unchanged. */
  resolveNullable(id: number | null): number | null {
    return id === null ? null : this.resolve(id);
  }

  /** Forget every mapping (used after project reset / function delete). */
  clear(): void {
    this.forward.clear();
  }

  get size(): number {
    return this.forward.size;
  }
}

/** One undoable unit. Thunks report success; only success commits. */
export interface HistoryEntry {
  readonly seq: number;
  readonly label: string;
  readonly undo: () => boolean;
  readonly redo: () => boolean;
}

/**
 * Linear undo stacks with transactional moves (P10 owner).
 * `undo`/`redo` run the thunk first and move the entry only on
 * `true`. On `false` (or a throw, reported as failure) the stacks are
 * left untouched so the next undo/redo stays predictable.
 */
export class HistoryStore {
  private readonly past: HistoryEntry[] = [];
  private readonly future: HistoryEntry[] = [];

  push(entry: HistoryEntry): void {
    this.past.push(entry);
    this.future.length = 0;
  }

  undo(): { ok: boolean; label: string | null } {
    const top = this.past[this.past.length - 1];
    if (top === undefined) return { ok: false, label: null };
    let done = false;
    try {
      done = top.undo();
    } catch {
      done = false;
    }
    if (!done) return { ok: false, label: top.label };
    this.past.pop();
    this.future.push(top);
    return { ok: true, label: top.label };
  }

  redo(): { ok: boolean; label: string | null } {
    const top = this.future[this.future.length - 1];
    if (top === undefined) return { ok: false, label: null };
    let done = false;
    try {
      done = top.redo();
    } catch {
      done = false;
    }
    if (!done) return { ok: false, label: top.label };
    this.future.pop();
    this.past.push(top);
    return { ok: true, label: top.label };
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.length > 0
      ? (this.past[this.past.length - 1]?.label ?? null)
      : null;
  }

  get redoLabel(): string | null {
    return this.future.length > 0
      ? (this.future[this.future.length - 1]?.label ?? null)
      : null;
  }

  get undoSeq(): number | null {
    return this.past.length > 0
      ? (this.past[this.past.length - 1]?.seq ?? null)
      : null;
  }

  get redoSeq(): number | null {
    return this.future.length > 0
      ? (this.future[this.future.length - 1]?.seq ?? null)
      : null;
  }

  get depth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }
}

// ------------------------------------------------------------------
// Input gesture math (Issue 10): pure, unit-tested helpers so canvas
// handlers never embed magic numbers. Trackpad wheel events are NOT
// mouse-wheel events — deltas arrive unscaled per gesture phase.
// ------------------------------------------------------------------

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.5;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Zoom factor for one wheel tick. Pinch gestures on macOS arrive as
 * `ctrlKey + wheel` with small continuous deltas; plain mouse wheels
 * arrive in larger steps. Both directions are symmetric so repeated
 * in/out returns to the start zoom. Capped at ±5% per tick so a single
 * gesture burst can never fling the canvas far away.
 */
export function zoomFactorForWheel(deltaY: number, ctrlKey: boolean): number {
  if (deltaY === 0) return 1;
  if (ctrlKey) {
    // Trackpad pinch: gentle exponential mapping keeps fine control.
    const factor = Math.exp(-deltaY / 1600);
    return deltaY < 0 ? Math.min(1.05, factor) : Math.max(1 / 1.05, factor);
  }
  return deltaY < 0 ? 1.05 : 1 / 1.05;
}

/** Discrete toolbar step: ±5% per click. */
export const ZOOM_STEP = 1.05;

/**
 * Pinch-zoom factor from finger distance: direct 1:1 tracking (no
 * cap needed — fingers bound the motion, unlike wheel bursts).
 * Degenerate input (no movement baseline) is a no-op.
 */
export function pinchFactor(startDist: number, currentDist: number): number {
  if (
    !Number.isFinite(startDist) ||
    !Number.isFinite(currentDist) ||
    startDist <= 0 ||
    currentDist <= 0
  ) {
    return 1;
  }
  return currentDist / startDist;
}

/**
 * Scroll offset that keeps one world point under the same screen pixel
 * across a zoom. Pure so the anchor math is unit-testable; callers
 * apply it to both axes. This is what stops zoom from "navigating
 * away": the anchor (cursor for pinch, package center for buttons)
 * stays put on screen.
 */
export function anchorScroll(
  scroll: number,
  worldPoint: number,
  before: number,
  after: number,
): number {
  return worldPoint * after - (worldPoint * before - scroll);
}

/** `true` when this wheel event is a zoom gesture (pinch / ctrl-wheel). */
export function isZoomWheel(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey;
}

/**
 * Normalize wheel deltas to pixels. `deltaMode 1` reports lines
 * (Firefox), `2` reports pages — scale to pixels before panning.
 */
export function wheelDeltaPx(
  delta: number,
  deltaMode: number,
  lineHeightPx = 16,
): number {
  if (deltaMode === 1) return delta * lineHeightPx;
  if (deltaMode === 2) return delta * lineHeightPx * 24;
  return delta;
}

/**
 * Screen (client px, includes scroll) → world (canvas units) at `zoom`.
 * Single formula shared by drops, connection previews, and tests.
 */
export function screenToWorld(
  clientX: number,
  clientY: number,
  rectLeft: number,
  rectTop: number,
  scrollLeft: number,
  scrollTop: number,
  zoom: number,
): { x: number; y: number } {
  const z = zoom === 0 ? 1 : zoom;
  return {
    x: (clientX - rectLeft + scrollLeft) / z,
    y: (clientY - rectTop + scrollTop) / z,
  };
}

// ------------------------------------------------------------------
// Viewport culling math (Issue 8): pure rect helpers. Culling affects
// presentation only — the canonical program stays in the runtime.
// ------------------------------------------------------------------

export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Visible world rect from scroll position, viewport px, and zoom. */
export function visibleWorldRect(
  scrollLeft: number,
  scrollTop: number,
  viewportW: number,
  viewportH: number,
  zoom: number,
): ViewRect {
  const z = zoom === 0 ? 1 : zoom;
  return {
    x: scrollLeft / z,
    y: scrollTop / z,
    w: viewportW / z,
    h: viewportH / z,
  };
}

/** Expand a rect by `overscan` world units on every side for smooth pan. */
export function withOverscan(rect: ViewRect, overscan: number): ViewRect {
  return {
    x: rect.x - overscan,
    y: rect.y - overscan,
    w: rect.w + overscan * 2,
    h: rect.h + overscan * 2,
  };
}

/** `true` when rect `b` intersects the (overscanned) viewport `a`. */
export function rectsIntersect(a: ViewRect, b: ViewRect): boolean {
  return (
    b.x < a.x + a.w && b.x + b.w > a.x && b.y < a.y + a.h && b.y + b.h > a.y
  );
}

export interface CullItem {
  readonly id: number;
  readonly rect: ViewRect;
}

/**
 * Viewport culling for canvas nodes (presentation only — the program
 * graph is untouched). Returns the items intersecting the overscanned
 * viewport plus any `pinned` ids (selection, error, drag sources stay
 * mounted so hit testing, keyboard access, and scroll-into-view keep
 * working). A `null` viewport (no layout yet, e.g. tests) disables
 * culling so nothing ever disappears for lack of measurement.
 */
export function filterVisibleBlocks<T extends CullItem>(
  items: readonly T[],
  viewport: ViewRect | null,
  overscan: number,
  pinned: ReadonlySet<number>,
): { visible: T[]; culled: number } {
  if (viewport === null) {
    return { visible: [...items], culled: 0 };
  }
  const view = withOverscan(viewport, overscan);
  const visible: T[] = [];
  let culled = 0;
  for (const item of items) {
    if (pinned.has(item.id) || rectsIntersect(view, item.rect)) {
      visible.push(item);
    } else {
      culled += 1;
    }
  }
  return { visible, culled };
}
