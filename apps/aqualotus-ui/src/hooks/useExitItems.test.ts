import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { EXIT_MS, useExitItems } from "./useExitItems";

interface Item {
  readonly id: string;
}

const keyOf = (item: Item): string => item.id;

describe("useExitItems", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a removed item alive for the exit window, then lets it go", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly Item[] }) => useExitItems(items, keyOf),
      { initialProps: { items: [{ id: "a" }, { id: "b" }] as Item[] } },
    );
    expect(result.current.length).toBe(0);

    // "b" left the list: it plays its exit animation.
    rerender({ items: [{ id: "a" }] });
    expect(result.current.map((e) => e.key)).toEqual(["b"]);
    expect(result.current[0]?.item.id).toBe("b");

    // The window closes: the ghost is gone.
    act(() => {
      vi.advanceTimersByTime(EXIT_MS + 20);
    });
    expect(result.current.length).toBe(0);
  });

  it("drops the ghost when the item comes back", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly Item[] }) => useExitItems(items, keyOf),
      { initialProps: { items: [{ id: "a" }] as Item[] } },
    );
    rerender({ items: [] });
    expect(result.current.length).toBe(1);
    // The item is back (an undo): no ghost for it.
    rerender({ items: [{ id: "a" }] });
    expect(result.current.length).toBe(0);
  });

  it("never keeps the same item twice", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly Item[] }) => useExitItems(items, keyOf),
      { initialProps: { items: [{ id: "a" }] as Item[] } },
    );
    rerender({ items: [] });
    rerender({ items: [{ id: "a" }] });
    rerender({ items: [] });
    expect(result.current.length).toBe(1);
  });

  it("cleans its pending exit when the component unmounts", () => {
    const { rerender, unmount } = renderHook(
      ({ items }: { items: readonly Item[] }) => useExitItems(items, keyOf),
      { initialProps: { items: [{ id: "a" }] as Item[] } },
    );
    rerender({ items: [] });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    // No timer survives the unmount: nothing can update a gone tree.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("survives rapid add and remove cycles", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly Item[] }) => useExitItems(items, keyOf),
      { initialProps: { items: [] as Item[] } },
    );
    for (let i = 0; i < 5; i += 1) {
      rerender({ items: [{ id: "x" }] });
      rerender({ items: [] });
    }
    // The same item leaves and comes back five times: one ghost.
    expect(result.current.length).toBe(1);
    act(() => {
      vi.advanceTimersByTime(EXIT_MS + 20);
    });
    expect(result.current.length).toBe(0);
  });
});
