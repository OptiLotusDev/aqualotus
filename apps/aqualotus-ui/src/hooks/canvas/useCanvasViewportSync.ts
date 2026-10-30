/**
 * Canvas viewport sync: handles viewport scroll/size subscription and zoom
 * change viewport refresh. Side effects only.
 */

import { useEffect } from "react";
import type { ViewRect } from "../../lib/history";
import { visibleWorldRect } from "../../lib/history";

interface UseCanvasViewportSyncArgs {
  readonly boardRef: React.RefObject<HTMLDivElement | null>;
  readonly zoom: number;
  readonly zoomRef: React.RefObject<number>;
  readonly setViewport: React.Dispatch<React.SetStateAction<ViewRect | null>>;
}

export function useCanvasViewportSync(args: UseCanvasViewportSyncArgs): void {
  const { boardRef, zoom, zoomRef, setViewport } = args;

  // Viewport scroll/size subscription
  useEffect(() => {
    const found = boardRef.current;
    if (found === null) return;
    const board: HTMLDivElement = found;
    let raf = 0;
    function read(): void {
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
    }
    function onScroll(): void {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        read();
      });
    }
    read();
    board.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      board.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [setViewport, zoomRef]);

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
  }, [zoom, setViewport, boardRef]);
}