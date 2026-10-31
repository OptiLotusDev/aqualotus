/**
 * Canvas startup fit: handles initial canvas fit and scroll positioning on
 * mount. Side effects only.
 */

import { useEffect, useRef } from "react";
import { isTauriShell } from "../../lib/env";
import { clampZoom } from "../../lib/history";

interface UseCanvasStartupFitArgs {
  readonly boardRef: React.RefObject<HTMLDivElement | null>;
  readonly layout: {
    readonly pkgPos: { readonly x: number; readonly y: number };
    readonly pkgW: number;
    readonly pkgH: number;
  };
  readonly functions: readonly { readonly id: number }[];
  readonly setZoom: (z: number) => void;
  readonly viewport: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null;
}

export function useCanvasStartupFit(args: UseCanvasStartupFitArgs): void {
  const { boardRef, layout, functions, setZoom, viewport } = args;

  const scrolledInitRef = useRef<boolean>(false);

  useEffect(() => {
    if (scrolledInitRef.current) return;
    let cancelled = false;
    let attempts = 0;
    function settle(board: HTMLDivElement): void {
      scrolledInitRef.current = true;
      const vw = board.clientWidth;
      const vh = board.clientHeight;
      const px = layout.pkgPos.x;
      const py = layout.pkgPos.y;
      if (functions.length === 0 || vw <= 0 || vh <= 0) {
        board.scrollLeft = Math.max(0, px - 80);
        board.scrollTop = Math.max(0, py - 170);
        return;
      }
      if (!isTauriShell()) {
        board.scrollLeft = Math.max(0, px - 80);
        board.scrollTop = Math.max(0, py - 170);
        return;
      }
      // Tauri startup fits the package like the Fit button (centered).
      // At cold start the package is by definition not on screen yet, so
      // this centers rather than anchor-preserves.
      const next = clampZoom(
        Math.min(vw / (layout.pkgW + 160), vh / (layout.pkgH + 160)),
      );
      setZoom(next);
      const cx = layout.pkgPos.x + layout.pkgW / 2;
      const cy = layout.pkgPos.y + layout.pkgH / 2;
      const left = Math.max(0, cx * next - vw / 2);
      const top = Math.max(0, cy * next - vh / 2);
      board.scrollLeft = left;
      board.scrollTop = top;
      requestAnimationFrame(() => {
        if (!cancelled) {
          board.scrollLeft = left;
          board.scrollTop = top;
        }
      });
    }
    function attempt(): void {
      if (cancelled || scrolledInitRef.current) return;
      const board = boardRef.current;
      if (board === null) return;
      if (
        (board.clientWidth <= 0 || board.clientHeight <= 0) &&
        attempts < 600
      ) {
        attempts += 1;
        requestAnimationFrame(attempt);
        return;
      }
      settle(board);
    }
    function onResize(): void {
      if (!scrolledInitRef.current) attempt();
    }
    attempt();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [layout.pkgPos, layout.pkgW, layout.pkgH, viewport, functions.length, setZoom, boardRef]);
}