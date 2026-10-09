import { describe, expect, it } from "vitest";
import {
  anchorScroll,
  clampZoom,
  filterVisibleBlocks,
  HistoryIdMap,
  HistoryStore,
  isZoomWheel,
  pinchFactor,
  rectsIntersect,
  screenToWorld,
  visibleWorldRect,
  wheelDeltaPx,
  withOverscan,
  zoomFactorForWheel,
  ZOOM_STEP,
} from "./history";

describe("HistoryIdMap", () => {
  it("resolves unknown ids to themselves", () => {
    const map = new HistoryIdMap();
    expect(map.resolve(7)).toBe(7);
    expect(map.resolveNullable(null)).toBe(null);
    expect(map.resolveNullable(7)).toBe(7);
  });

  it("tracks a recreation and follows chains", () => {
    const map = new HistoryIdMap();
    map.track(2, 10);
    expect(map.resolve(2)).toBe(10);
    // A second recreation of the same logical command follows the chain.
    map.track(10, 14);
    expect(map.resolve(2)).toBe(14);
    expect(map.resolve(10)).toBe(14);
  });

  it("rewrites earlier mappings that pointed at a recreated id", () => {
    const map = new HistoryIdMap();
    // a -> b recorded; then b itself is recreated as b'.
    map.track(1, 2);
    map.track(2, 9);
    expect(map.resolve(1)).toBe(9);
  });

  it("models the a → b → c double-delete sequence", () => {
    // Delete b (id 2), then c (id 3). Undo restores c' (id 4), then the
    // older entry for b must resolve its stale next=3 to the live 4.
    const map = new HistoryIdMap();
    map.track(3, 4);
    expect(map.resolve(3)).toBe(4);
    map.track(2, 5);
    expect(map.resolve(2)).toBe(5);
    expect(map.resolve(3)).toBe(4);
    expect(map.size).toBe(2);
  });

  it("clears all mappings on project reset", () => {
    const map = new HistoryIdMap();
    map.track(2, 10);
    map.clear();
    expect(map.resolve(2)).toBe(2);
    expect(map.size).toBe(0);
  });
});

describe("HistoryStore", () => {
  it("moves entries only on success (transactional undo/redo)", () => {
    const store = new HistoryStore();
    expect(store.canUndo).toBe(false);
    expect(store.undo().ok).toBe(false);

    let failNext = true;
    store.push({
      seq: 1,
      label: "Delete b",
      undo: () => !failNext,
      redo: () => true,
    });
    expect(store.canUndo).toBe(true);

    // Failed undo: the entry stays on the past stack.
    expect(store.undo().ok).toBe(false);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);
    expect(store.undoLabel).toBe("Delete b");

    // Successful undo moves it to the redo stack.
    failNext = false;
    expect(store.undo().ok).toBe(true);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);

    // Successful redo moves it back.
    expect(store.redo().ok).toBe(true);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);
  });

  it("keeps a failed redo on the future stack", () => {
    const store = new HistoryStore();
    store.push({
      seq: 1,
      label: "Rewire",
      undo: () => true,
      redo: () => false,
    });
    expect(store.undo().ok).toBe(true);
    expect(store.redo().ok).toBe(false);
    expect(store.canRedo).toBe(true);
    expect(store.canUndo).toBe(false);
    expect(store.redoLabel).toBe("Rewire");
  });

  it("treats throwing thunks as failures without moving stacks", () => {
    const store = new HistoryStore();
    store.push({
      seq: 1,
      label: "Boom",
      undo: () => {
        throw new Error("bridge exploded");
      },
      redo: () => true,
    });
    expect(store.undo().ok).toBe(false);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);
  });

  it("clears redo on new actions (linear discipline)", () => {
    const store = new HistoryStore();
    store.push({ seq: 1, label: "A", undo: () => true, redo: () => true });
    store.undo();
    expect(store.canRedo).toBe(true);
    store.push({ seq: 2, label: "B", undo: () => true, redo: () => true });
    expect(store.canRedo).toBe(false);
    expect(store.undoLabel).toBe("B");
    expect(store.redoSeq).toBe(null);
    expect(store.undoSeq).toBe(2);
  });
});

describe("filterVisibleBlocks", () => {
  const view = { x: 0, y: 0, w: 600, h: 400 };
  function item(id: number, x: number): { id: number; rect: { x: number; y: number; w: number; h: number } } {
    return { id, rect: { x, y: 0, w: 100, h: 50 } };
  }

  it("mounts everything without a measured viewport", () => {
    const items = [item(1, 0), item(2, 5000)];
    expect(filterVisibleBlocks(items, null, 800, new Set()).visible).toHaveLength(2);
    expect(filterVisibleBlocks(items, null, 800, new Set()).culled).toBe(0);
  });

  it("culls far off-screen blocks but keeps neighbors via overscan", () => {
    const items = [item(1, 0), item(2, 650), item(3, 5000)];
    const { visible, culled } = filterVisibleBlocks(items, view, 800, new Set());
    expect(visible.map((i) => i.id)).toEqual([1, 2]);
    expect(culled).toBe(1);
  });

  it("pins selection, error, and drag ids regardless of position", () => {
    const items = [item(1, 9000)];
    const { visible, culled } = filterVisibleBlocks(items, view, 800, new Set([1]));
    expect(visible.map((i) => i.id)).toEqual([1]);
    expect(culled).toBe(0);
  });

  it("scales to thousands of blocks with only the window mounted", () => {
    const items = Array.from({ length: 3000 }, (_, i) => item(i, i * 264));
    const windowed = filterVisibleBlocks(items, { x: 0, y: 0, w: 1728, h: 972 }, 800, new Set());
    expect(windowed.visible.length).toBeLessThan(30);
    expect(windowed.visible.length + windowed.culled).toBe(3000);
  });
});

describe("gesture math", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(99)).toBe(1.5);
    expect(clampZoom(0.01)).toBe(0.25);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("distinguishes pinch zoom from plain wheel", () => {
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
    // Two-finger trackpad scroll reports no modifier: it pans, never zooms.
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("maps pinch deltas exponentially and wheel steps discretely", () => {
    // Pinch in (negative delta) zooms in, symmetric with pinch out.
    const pinchIn = zoomFactorForWheel(-10, true);
    const pinchOut = zoomFactorForWheel(10, true);
    expect(pinchIn).toBeGreaterThan(1);
    expect(pinchOut).toBeLessThan(1);
    expect(pinchIn * pinchOut).toBeCloseTo(1, 10);
    // Capped at ±5% per tick: one gesture burst can never fling far.
    expect(zoomFactorForWheel(-1000, true)).toBe(1.05);
    expect(zoomFactorForWheel(1000, true)).toBeCloseTo(1 / 1.05, 12);
    // Zero delta is a no-op.
    expect(zoomFactorForWheel(0, true)).toBe(1);
    // Plain mouse wheel stays on discrete ±5% steps.
    expect(zoomFactorForWheel(-100, false)).toBe(1.05);
    expect(zoomFactorForWheel(100, false)).toBeCloseTo(1 / 1.05, 12);
    expect(ZOOM_STEP).toBe(1.05);
  });

  it("pinchFactor tracks finger distance 1:1", () => {
    expect(pinchFactor(100, 200)).toBe(2);
    expect(pinchFactor(200, 100)).toBe(0.5);
    expect(pinchFactor(100, 100)).toBe(1);
    // Degenerate baselines never zoom.
    expect(pinchFactor(0, 200)).toBe(1);
    expect(pinchFactor(-5, 200)).toBe(1);
    expect(pinchFactor(Number.NaN, 200)).toBe(1);
  });

  it("anchorScroll keeps the anchor point fixed on screen", () => {
    // World point 2000 at zoom 1 with scroll 1500 sits at screen 500.
    // After zooming to 1.05 it must still sit at screen 500.
    const scroll = 1500;
    const world = 2000;
    const next = anchorScroll(scroll, world, 1, 1.05);
    expect(next).toBe(1600);
    expect(world * 1.05 - next).toBe(world * 1 - scroll);
    // Zooming out mirrors it.
    const back = anchorScroll(next, world, 1.05, 1);
    expect(back).toBeCloseTo(scroll, 10);
  });

  it("normalizes line/page wheel modes to pixels", () => {
    expect(wheelDeltaPx(10, 0)).toBe(10);
    expect(wheelDeltaPx(3, 1)).toBe(48);
    expect(wheelDeltaPx(1, 2)).toBe(384);
  });

  it("converts screen points to world coordinates at zoom", () => {
    // client (140, 200), rect origin (20, 40), scroll (30, 10), zoom 2.
    expect(screenToWorld(140, 200, 20, 40, 30, 10, 2)).toEqual({
      x: 75,
      y: 85,
    });
    // Zero zoom never divides by zero.
    expect(screenToWorld(10, 10, 0, 0, 0, 0, 0)).toEqual({ x: 10, y: 10 });
  });
});

describe("viewport culling math", () => {
  it("derives the visible world rect from scroll and zoom", () => {
    expect(visibleWorldRect(200, 100, 1200, 800, 2)).toEqual({
      x: 100,
      y: 50,
      w: 600,
      h: 400,
    });
  });

  it("expands by overscan on every side", () => {
    expect(withOverscan({ x: 100, y: 50, w: 600, h: 400 }, 10)).toEqual({
      x: 90,
      y: 40,
      w: 620,
      h: 420,
    });
  });

  it("culls off-screen rects but keeps touching ones", () => {
    const view = { x: 0, y: 0, w: 600, h: 400 };
    expect(rectsIntersect(view, { x: 100, y: 100, w: 50, h: 50 })).toBe(true);
    expect(rectsIntersect(view, { x: 2000, y: 100, w: 50, h: 50 })).toBe(
      false,
    );
    // Edge-touching counts as visible (no popping at the boundary).
    expect(rectsIntersect(view, { x: 600, y: 0, w: 50, h: 50 })).toBe(false);
    expect(rectsIntersect(view, { x: 599, y: 0, w: 50, h: 50 })).toBe(true);
  });
});
