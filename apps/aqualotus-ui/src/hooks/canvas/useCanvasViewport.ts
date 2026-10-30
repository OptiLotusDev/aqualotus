/**
 * Canvas viewport: measurement, resize/scroll subscription lifecycle, and
 * viewport state for block culling. Honest over explicit inputs — the
 * board rect and scroll position are read from the DOM, and the viewport
 * is exposed as state for culling and overlay sizing.
 */

import { useCallback, useEffect, useState } from "react";
import type { ViewRect } from "../../lib/history";
import { visibleWorldRect } from "../../lib/history";

interface UseCanvasViewportArgs {
  readonly boardRef: React.RefObject<HTMLDivElement | null>;
  readonly zoom: number;
  readonly zoomRef: React.RefObject<number>;
}

/** The visible world rect derived from board scroll + client size + zoom. */
export interface ViewportState {
  readonly viewport: ViewRect | null;
  readonly setViewport: React.Dispatch<React.SetStateAction<ViewRect | null>>;
}

export function useCanvasViewport(
  args: UseCanvasViewportArgs,
): ViewportState {
  const { boardRef, zoom, zoomRef } = args;
  const [viewport, setViewport] = useState<ViewRect | null>(null);

  const readViewport = useCallback((): void => {
    const board = boardRef.current;
    if (board === null) return;
    if (board.clientWidth === 0 && board.clientHeight === 0) return;
    setViewport((prev: ViewRect | null) => {
      const next = visibleWorldRect(
        board.scrollLeft,
        board.scrollTop,
        board.clientWidth === 0 ? 1200 : board.clientWidth,
        board.clientHeight === 0 ? 800 : board.clientHeight,
        zoomRef.current,
      );
      if (
        prev !== null &&
        Math.abs(prev.x - next.x) < 1 &&
        Math.abs(prev.y - next.y) < 1 &&
        Math.abs(prev.w - next.w) < 1 &&
        Math.abs(prev.h - next.h) < 1
      ) {
        return prev;
      }
      return next;
    });
  }, [boardRef, zoomRef]);

  // Scroll + resize subscription with rAF coalescing (Issue 9).
  useEffect(() => {
    const board = boardRef.current;
    if (board === null) return;
    let raf = 0;
    function onScroll(): void {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        readViewport();
      });
    }
    readViewport();
    board.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      board.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [readViewport]);

  // Zoom changes the world mapping without scrolling: refresh culling.
  useEffect(() => {
    const board = boardRef.current;
    if (board === null) return;
    if (board.clientWidth === 0 && board.clientHeight === 0) return;
    setViewport(
      visibleWorldRect(
        board.scrollLeft,
        board.scrollTop,
        board.clientWidth === 0 ? 1200 : board.clientWidth,
        board.clientHeight === 0 ? 800 : board.clientHeight,
        zoom,
      ),
    );
  }, [zoom, boardRef]);

  return { viewport, setViewport };
}
