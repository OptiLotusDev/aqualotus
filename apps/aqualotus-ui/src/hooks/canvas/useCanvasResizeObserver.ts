/**
 * Canvas resize observer: block geometry via ResizeObserver subscription.
 * Side effects only.
 *
 * Registration happens per element, from the DOM ref callbacks that the
 * canvas hands to `register`. That is what keeps the observed set honest
 * no matter WHEN an element enters the tree: blocks mounted after the
 * first pass (a newly added block, a block returning from viewport
 * culling, a merged join circle) are measured and observed the moment
 * their ref fires, instead of waiting for a subscription sweep that a
 * mount-once effect would never run again.
 */

import { useCallback, useEffect, useRef } from "react";
import type { Size } from "../../components/visualEditor_constants";

interface UseCanvasResizeObserverArgs {
  readonly blockEls: React.MutableRefObject<Map<string, HTMLDivElement>>;
  readonly setSizes: React.Dispatch<React.SetStateAction<ReadonlyMap<string, Size>>>;
}

export function useCanvasResizeObserver(
  args: UseCanvasResizeObserverArgs,
): (el: HTMLDivElement | null, key: string) => void {
  const { blockEls, setSizes } = args;

  // One subscription per canvas; created lazily on the first registered
  // element so environments without ResizeObserver (tests) never touch it.
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    return () => {
      if (observerRef.current !== null) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  const setEntry = useCallback(
    (key: string, w: number, h: number): void => {
      setSizes((prev) => {
        const cur = prev.get(key);
        if (cur !== undefined && cur.w === w && cur.h === h) return prev;
        const next = new Map(prev);
        next.set(key, { w, h });
        return next;
      });
    },
    [setSizes],
  );

  // Border box, not the content rect: the port-anchored edge geometry and
  // the container auto-sizing both treat these as the painted `.vblock`
  // box, whose right edge and vertical centre carry the ports — a content
  // rect would place every arrow short by the block's horizontal padding.
  const measureNow = useCallback(
    (key: string, el: HTMLElement): void => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      setEntry(key, w, h);
    },
    [setEntry],
  );

  const getObserver = useCallback((): ResizeObserver | null => {
    if (typeof ResizeObserver === "undefined") return null;
    if (observerRef.current === null) {
      observerRef.current = new ResizeObserver((entries) => {
        setSizes((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const entry of entries) {
            const target = entry.target as HTMLElement;
            const key = target.dataset.sizeKey;
            if (key === undefined || key === "") continue;
            const w = entry.borderBoxSize?.[0]?.inlineSize ?? target.offsetWidth;
            const h = entry.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight;
            if (w <= 0 || h <= 0) continue;
            const cur = next.get(key);
            if (cur?.w !== w || cur?.h !== h) {
              next.set(key, { w, h });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });
    }
    return observerRef.current;
  }, [setSizes]);

  /**
   * Attach (or detach) one measured element under `key`. Called from the
   * block- and join-element ref callbacks with the mounted element, and
   * with `null` when the element leaves the tree.
   *
   * Deliberately a plain (un-memoized) function: ref callbacks get fresh
   * closures from the renderer on every render anyway, so memoizing here
   * only buys a compiler diagnostic.
   */
  const register = (el: HTMLDivElement | null, key: string): void => {
    const current = blockEls.current.get(key);
    if (current !== undefined && current !== el) {
      // Re-registered under the same key with a fresh element: stop
      // watching the old one before tracking the new one.
      observerRef.current?.unobserve(current);
      blockEls.current.delete(key);
    }
    if (el === null) {
      if (current !== undefined) {
        observerRef.current?.unobserve(current);
        blockEls.current.delete(key);
      }
      // The recorded size stays: it is a presentation input, not truth —
      // a re-mounted id is re-measured by its own registration below.
      return;
    }
    el.dataset.sizeKey = key;
    blockEls.current.set(key, el);
    // Measure synchronously as well as observing: the first paint gets
    // real geometry even before the observer's first callback.
    measureNow(key, el);
    const observer = getObserver();
    observer?.observe(el);
  };

  return register;
}
