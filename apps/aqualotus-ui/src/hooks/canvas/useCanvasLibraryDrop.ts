/**
 * Canvas library drop: handles library ghost drops onto the canvas.
 * Side effects only.
 */

import { useEffect } from "react";

interface UseCanvasLibraryDropArgs {
  readonly boardRef: React.RefObject<HTMLDivElement | null>;
  readonly functions: readonly { readonly id: number }[];
  readonly selectedFunctionId: number | null;
  readonly layout: {
    readonly funcOrigin: (fid: number) => { readonly x: number; readonly y: number };
    readonly heights: ReadonlyMap<number, number>;
    readonly widths: ReadonlyMap<number, number>;
  };
  readonly toCanvas: (board: HTMLDivElement, clientX: number, clientY: number, zoomLevel: number) => { readonly x: number; readonly y: number };
  readonly zoomRef: React.RefObject<number>;
  readonly onRegisterDrop: (
    handler: ((kind: string, clientX: number, clientY: number) => void) | null,
  ) => void;
  readonly onDropBlock: (fid: number, kind: string, pos: { readonly x: number; readonly y: number }) => void;
}

export function useCanvasLibraryDrop(args: UseCanvasLibraryDropArgs): void {
  const { boardRef, functions, selectedFunctionId, layout, toCanvas, zoomRef, onRegisterDrop, onDropBlock } = args;

  useEffect(() => {
    onRegisterDrop((kind: string, clientX: number, clientY: number) => {
      const board = boardRef.current;
      if (board === null) return;
      const rect = board.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return;
      }
      const p = toCanvas(board, clientX, clientY, zoomRef.current);
      let targetFid = selectedFunctionId;
      for (const fn of functions) {
        const f = layout.funcOrigin(fn.id);
        const h = layout.heights.get(fn.id) ?? 200;
        const w = layout.widths.get(fn.id) ?? 600;
        if (
          p.x >= f.x &&
          p.x <= f.x + w &&
          p.y >= f.y &&
          p.y <= f.y + h
        ) {
          targetFid = fn.id;
          break;
        }
      }
      if (targetFid === null) return;
      const f = layout.funcOrigin(targetFid);
      onDropBlock(targetFid, kind, {
        x: Math.max(8, p.x - f.x - 100),
        y: Math.max(36, p.y - f.y - 40),
      });
    });
    return () => onRegisterDrop(null);
  }, [onRegisterDrop, onDropBlock, functions, selectedFunctionId, layout, toCanvas, zoomRef, boardRef]);
}