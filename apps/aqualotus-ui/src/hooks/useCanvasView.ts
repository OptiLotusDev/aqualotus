/**
 * Canvas "camera": zoom level, package pan offset, viewport, and the view
 * transform helpers. Extracted from `VisualEditor` so the editor stays
 * focused on orchestration while the camera logic is isolated and
 * independently testable. The editor drives the camera through the
 * returned handlers and reads `zoom` for rendering.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Pos } from "../lib/layout";
import { anchorScroll, clampZoom, screenToWorld } from "../lib/history";
import type { ViewRect } from "../lib/history";

interface ViewCameraArgs {
  readonly boardRef: React.RefObject<HTMLDivElement | null>;
  readonly layout: {
    readonly pkgPos: Pos;
    readonly pkgW: number;
    readonly pkgH: number;
  };
  readonly onRegisterZoom: (
    ctl: { getZoom: () => number; setZoom: (z: number) => void } | null,
  ) => void;
  readonly onZoomSettled?: (before: number, after: number) => void;
}

/** One camera: zoom, pan, viewport, and the view transform. */
export function useCanvasView(args: ViewCameraArgs) {
  const { boardRef, layout, onRegisterZoom, onZoomSettled } = args;
  const [zoom, setZoom] = useState<number>(1);
  const zoomRef = useRef<number>(1);
  const [viewport, setViewport] = useState<ViewRect | null>(null);

  const wheelBurstRef = useRef<{ start: number; timer: number | null }>({
    start: 1,
    timer: null,
  });

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    onRegisterZoom({
      getZoom: () => zoomRef.current,
      setZoom: (z: number) => setZoom(clampZoom(z)),
    });
    return () => onRegisterZoom(null);
  }, [onRegisterZoom]);

  const commitZoom = useCallback(
    (before: number, after: number): void => {
      if (Math.abs(before - after) < 1e-9) return;
      onZoomSettled?.(before, after);
    },
    [onZoomSettled],
  );

  function pkgCenter(): Pos {
    return {
      x: layout.pkgPos.x + layout.pkgW / 2,
      y: layout.pkgPos.y + layout.pkgH / 2,
    };
  }

  /**
   * Zoom to an absolute level keeping `anchor` (a world point, already
   * on screen) fixed on screen. Used by incremental zoom — buttons,
   * reset, wheel, pinch — so zooming never flings the canvas into an
   * empty region. NOT for Fit: fitting centers instead (see `fitView`).
   */
  function zoomTo(afterRaw: number, anchor: Pos, record = true): void {
    const board = boardRef.current;
    const before = zoomRef.current;
    const after = clampZoom(afterRaw);
    if (board === null) {
      setZoom(after);
      if (record) commitZoom(before, after);
      return;
    }
    if (Math.abs(before - after) < 1e-9) {
      if (record) commitZoom(before, after);
      return;
    }
    setZoom(after);
    if (record) commitZoom(before, after);
    const left = Math.max(
      0,
      anchorScroll(board.scrollLeft, anchor.x, before, after),
    );
    const top = Math.max(
      0,
      anchorScroll(board.scrollTop, anchor.y, before, after),
    );
    // Sync first (covers already-laid-out boards), then once more on
    // the next frame (covers boards mid-layout, e.g. Tauri startup).
    board.scrollLeft = left;
    board.scrollTop = top;
    requestAnimationFrame(() => {
      board.scrollLeft = left;
      board.scrollTop = top;
    });
  }

  function zoomBy(factor: number): void {
    zoomTo(zoomRef.current * factor, pkgCenter());
  }

  /**
   * Fit the package (not the infinite world) into view, centered.
   * Centering (not anchor-preserving): Fit is the recovery action for
   * a lost canvas, so it must move the package on screen even when
   * the current view shows only emptiness.
   */
  function fitView(): void {
    const board = boardRef.current;
    if (board === null) return;
    const vw = board.clientWidth;
    const vh = board.clientHeight;
    if (vw <= 0 || vh <= 0) return;
    const next = clampZoom(
      Math.min(vw / (layout.pkgW + 160), vh / (layout.pkgH + 160)),
    );
    const before = zoomRef.current;
    setZoom(next);
    commitZoom(before, next);
    const c = pkgCenter();
    const left = Math.max(0, c.x * next - vw / 2);
    const top = Math.max(0, c.y * next - vh / 2);
    board.scrollLeft = left;
    board.scrollTop = top;
    requestAnimationFrame(() => {
      board.scrollLeft = left;
      board.scrollTop = top;
    });
  }

  /**
   * Convert a screen pointer position into world coordinates using the
   * board's current rect and scroll. Pure in its arguments — closes over
   * no render-scoped state — so it is safe to memoize and depend on.
   */
  const toCanvas = useCallback(
    (board: HTMLDivElement, clientX: number, clientY: number, zoomLevel: number): Pos => {
      const rect = board.getBoundingClientRect();
      return screenToWorld(
        clientX,
        clientY,
        rect.left,
        rect.top,
        board.scrollLeft,
        board.scrollTop,
        zoomLevel,
      );
    },
    [],
  );

  /**
   * Zoom at a specific screen position (client coordinates), keeping that
   * screen point fixed. Used for pinch zoom and Ctrl+wheel zoom.
   */
  function zoomAtCursor(clientX: number, clientY: number, deltaPx: number): void {
    const board = boardRef.current;
    if (board === null) return;
    const rect = board.getBoundingClientRect();
    const anchor = screenToWorld(
      clientX,
      clientY,
      rect.left,
      rect.top,
      board.scrollLeft,
      board.scrollTop,
      zoomRef.current,
    );
    const factor = deltaPx < 0 ? 1.05 : 1 / 1.05;
    zoomTo(zoomRef.current * factor, anchor);
  }

  return {
    zoom,
    setZoom,
    zoomRef,
    wheelBurstRef,
    viewport,
    setViewport,
    commitZoom,
    zoomBy,
    zoomTo,
    zoomAtCursor,
    fitView,
    pkgCenter,
    toCanvas,
  };
}
