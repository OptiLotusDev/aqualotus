/**
 * Canvas resize observer: block geometry via ResizeObserver subscription.
 * Side effects only.
 */

import { useEffect } from "react";

interface UseCanvasResizeObserverArgs {
  readonly blockEls: React.MutableRefObject<Map<string, HTMLDivElement>>;
  readonly setSizes: React.Dispatch<React.SetStateAction<ReadonlyMap<string, { readonly w: number; readonly h: number }>>>;
}

export function useCanvasResizeObserver(args: UseCanvasResizeObserverArgs): void {
  const { blockEls, setSizes } = args;

  useEffect(() => {
    const els = [...blockEls.current.values()];
    if (typeof ResizeObserver === "undefined") {
      if (els.length === 0) return;
      const frame = requestAnimationFrame(() => {
        setSizes((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const [key, el] of blockEls.current) {
            if (el.offsetWidth <= 0) continue;
            const cur = next.get(key);
            if (cur?.w !== el.offsetWidth || cur?.h !== el.offsetHeight) {
              next.set(key, { w: el.offsetWidth, h: el.offsetHeight });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver((entries) => {
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
    for (const [key, el] of blockEls.current) {
      el.dataset.sizeKey = key;
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [blockEls, setSizes]);
}