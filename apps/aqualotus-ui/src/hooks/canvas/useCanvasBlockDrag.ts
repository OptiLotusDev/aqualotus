/**
 * Canvas block drag: drag positions, offsets, completion, and
 * cancellation. Owns the live drag state for a single block drag and for
 * package background dragging. Position updates flow through the
 * existing `onMoveBlock` callback on pointer-up only — no bridge calls
 * mid-drag.
 */

import { useCallback, useRef, useState } from "react";
import type { Pos } from "../../lib/layout";
import { clampBlockPos } from "../../lib/canvas_geometry";
import { BLOCK_MIN_Y, clampDrag } from "../../components/visualEditor_constants";

export interface BlockDragState {
  readonly fid: number;
  readonly id: number;
  readonly pos: Pos;
}

export interface PkgDragState {
  readonly startX: number;
  readonly startY: number;
  readonly orig: Pos;
}

interface UseCanvasBlockDragArgs {
  readonly onMoveBlock: (fid: number, id: number, pos: Pos) => void;
  readonly pkgOff: Pos;
  readonly setPkgOff: (next: Pos) => void;
}

interface UseCanvasBlockDragResult {
  readonly dragPos: BlockDragState | null;
  readonly setDragPos: (next: BlockDragState | null) => void;
  readonly dragPosRef: React.MutableRefObject<BlockDragState | null>;
  readonly startBlockDrag: (
    fid: number,
    id: number,
    orig: Pos,
  ) => void;
  readonly applyBlockDragMove: (
    clientX: number,
    clientY: number,
    startX: number,
    startY: number,
    orig: Pos,
    zoom: number,
  ) => void;
  readonly endBlockDrag: (moved: boolean) => { committed: boolean; finalPos: Pos | null };
  readonly startPkgDrag: () => void;
  readonly applyPkgDragMove: (
    clientX: number,
    clientY: number,
    startX: number,
    startY: number,
    orig: Pos,
    zoom: number,
  ) => void;
  readonly endPkgDrag: () => void;
  readonly cancelDrag: () => void;
}

export function useCanvasBlockDrag(args: UseCanvasBlockDragArgs): UseCanvasBlockDragResult {
  const { onMoveBlock, setPkgOff } = args;

  const [dragPos, setDragPos] = useState<BlockDragState | null>(null);
  const dragPosRef = useRef<BlockDragState | null>(null);

  const startBlockDrag = useCallback(
    (fid: number, id: number, orig: Pos): void => {
      dragPosRef.current = { fid, id, pos: orig };
      setDragPos({ fid, id, pos: orig });
    },
    [],
  );

  const applyBlockDragMove = useCallback(
    (
      clientX: number,
      clientY: number,
      startX: number,
      startY: number,
      orig: Pos,
      zoom: number,
    ): void => {
      const dx = (clientX - startX) / zoom;
      const dy = (clientY - startY) / zoom;
      const next: BlockDragState = {
        fid: dragPosRef.current?.fid ?? -1,
        id: dragPosRef.current?.id ?? -1,
        pos: clampBlockPos(
          { x: orig.x + dx, y: orig.y + dy },
          8,
          BLOCK_MIN_Y,
        ),
      };
      dragPosRef.current = next;
      setDragPos(next);
    },
    [],
  );

  const endBlockDrag = useCallback(
    (moved: boolean): { committed: boolean; finalPos: Pos | null } => {
      const live = dragPosRef.current;
      dragPosRef.current = null;
      setDragPos(null);
      if (!moved || live === null) {
        return { committed: false, finalPos: null };
      }
      onMoveBlock(live.fid, live.id, live.pos);
      return { committed: true, finalPos: live.pos };
    },
    [onMoveBlock],
  );

  const startPkgDrag = useCallback((): void => {
    // Package drag state lives in pkgOff; orig captured by caller.
  }, []);

  const applyPkgDragMove = useCallback(
    (
      clientX: number,
      clientY: number,
      startX: number,
      startY: number,
      orig: Pos,
      zoom: number,
    ): void => {
      const dx = (clientX - startX) / zoom;
      const dy = (clientY - startY) / zoom;
      setPkgOff({
        x: clampDrag(orig.x + dx),
        y: clampDrag(orig.y + dy),
      });
    },
    [setPkgOff],
  );

  const endPkgDrag = useCallback((): void => {
    // Nothing to commit: pkgOff is live state.
  }, []);

  const cancelDrag = useCallback((): void => {
    dragPosRef.current = null;
    setDragPos(null);
  }, []);

  return {
    dragPos,
    setDragPos,
    dragPosRef,
    startBlockDrag,
    applyBlockDragMove,
    endBlockDrag,
    startPkgDrag,
    applyPkgDragMove,
    endPkgDrag,
    cancelDrag,
  };
}
