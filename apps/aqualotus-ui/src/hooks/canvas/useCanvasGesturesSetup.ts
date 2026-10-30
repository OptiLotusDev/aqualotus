/**
 * Canvas gestures setup: wheel zoom (Ctrl/Cmd+wheel) and keyboard zoom
 * (Ctrl/Cmd++/-, Ctrl/Cmd+0) with canvas focus. Side effects only.
 */

import { useEffect } from "react";
import { isZoomWheel, wheelDeltaPx, ZOOM_STEP } from "../../lib/history";

interface UseCanvasGesturesSetupArgs {
  readonly boardRef: React.RefObject<HTMLDivElement | null>;
  readonly zoomRef: React.RefObject<number>;
  readonly setZoom: (z: number) => void;
  readonly commitZoom: (before: number, after: number) => void;
  readonly zoomBy: (factor: number) => void;
  readonly zoomAtCursor: (clientX: number, clientY: number, deltaPx: number) => void;
}

export function useCanvasGesturesSetup(args: UseCanvasGesturesSetupArgs): void {
  const { boardRef, zoomRef, setZoom, commitZoom, zoomBy, zoomAtCursor } = args;

  useEffect(() => {
    const overBoard = (target: EventTarget | null): boolean => {
      const board = boardRef.current;
      return board !== null && target instanceof Element && board.contains(target);
    };
    function onWheelCapture(e: WheelEvent): void {
      if (!isZoomWheel(e)) return;
      e.preventDefault();
      if (!overBoard(e.target)) return;
      zoomAtCursor(e.clientX, e.clientY, wheelDeltaPx(e.deltaY, e.deltaMode));
    }
    function onGesture(e: Event): void {
      e.preventDefault();
    }
    function onKeyZoom(e: KeyboardEvent): void {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key !== "+" && e.key !== "=" && e.key !== "-" && e.key !== "_" && e.key !== "0") {
        return;
      }
      const target = e.target as Element | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (!overBoard(e.target)) return;
      e.preventDefault();
      if (e.key === "0") {
        const before = zoomRef.current;
        setZoom(1);
        commitZoom(before, 1);
      } else if (e.key === "+" || e.key === "=") {
        zoomBy(ZOOM_STEP);
      } else {
        zoomBy(1 / ZOOM_STEP);
      }
    }
    window.addEventListener("wheel", onWheelCapture, { passive: false, capture: true });
    window.addEventListener("gesturestart", onGesture, { capture: true });
    window.addEventListener("gesturechange", onGesture, { capture: true });
    window.addEventListener("gestureend", onGesture, { capture: true });
    window.addEventListener("keydown", onKeyZoom, { capture: true });
    return () => {
      window.removeEventListener("wheel", onWheelCapture, { capture: true });
      window.removeEventListener("gesturestart", onGesture, { capture: true });
      window.removeEventListener("gesturechange", onGesture, { capture: true });
      window.removeEventListener("gestureend", onGesture, { capture: true });
      window.removeEventListener("keydown", onKeyZoom, { capture: true });
    };
  }, [zoomRef, setZoom, commitZoom, zoomBy, zoomAtCursor, boardRef]);
}