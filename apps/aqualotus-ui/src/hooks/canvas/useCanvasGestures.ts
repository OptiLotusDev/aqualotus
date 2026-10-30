/**
 * Canvas gestures: the pointer-gesture coordinator. Owns the shared
 * gesture state machine and the board event handlers. Delegates
 * gesture-type-specific logic to useCanvasBlockDrag,
 * useCanvasConnections, and useCanvasBranchLayout.
 */

import { useCallback, useRef, useState } from "react";
import type { BlockSide } from "../../lib/graph_geometry";
import type { BranchSide } from "../../lib/graph_topology";
import type { CommandSummary } from "../../lib/optilotus";
import type { Pos, LayoutMap } from "../../lib/layout";
import type { IfShape } from "../../lib/graph";
import type { Size } from "../../components/visualEditor_constants";
import type { ReactElement } from "react";
import type { CanvasDrawnEdge } from "../../lib/canvas_edges";
import type { FlowState } from "../../lib/flow";
import { BLOCK_MIN_Y } from "../../components/visualEditor_constants";
import { clampBlockPos } from "../../lib/canvas_geometry";
import { useCanvasBlockDrag } from "./useCanvasBlockDrag";
import { useCanvasConnections } from "./useCanvasConnections";
import { useCanvasBranchLayout } from "./useCanvasBranchLayout";

export type CanvasGesture =
  | { kind: "block"; fid: number; id: number; startX: number; startY: number; orig: Pos }
  | { kind: "connect"; fid: number; sourceId: number; side: BlockSide }
  | {
      kind: "branch";
      fid: number;
      ifId: number;
      branch: BlockSide;
      startX: number;
      startY: number;
    }
  | { kind: "join"; fid: number; ifId: number; startX: number; startY: number }
  | { kind: "pkg"; startX: number; startY: number; orig: Pos }
  | { kind: "pan"; startX: number; startY: number; left: number; top: number }
  | { kind: "pinch"; startZoom: number; lastDist: number }
  | null;

interface UseCanvasGesturesArgs {
  readonly boardRef: React.RefObject<HTMLDivElement | null>;
  readonly busy: boolean;
  readonly selectedFunctionId: number | null;
  readonly selectedCommandId: number | null;
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
  readonly layoutStore: Readonly<Record<number, LayoutMap>>;
  readonly sizes: ReadonlyMap<string, Size>;
  readonly ifShapesByFunction: ReadonlyMap<number, readonly IfShape[]>;
  readonly posOf: (fid: number, cmd: CommandSummary, index: number) => Pos;
  readonly blockWorld: (fid: number, cmd: CommandSummary, index: number) => Pos;
  readonly funcOrigin: (fid: number) => Pos;
  readonly mergeJoins?: Readonly<Record<number, { readonly on: boolean; readonly pos: Pos | null }>>;
  readonly zoom: number;
  readonly onSelectFunction: (id: number) => void;
  readonly onSelectCommand: (id: number | null) => void;
  readonly onMoveBlock: (fid: number, id: number, pos: Pos) => void;
  readonly onReconnect: (
    fid: number,
    sourceId: number,
    targetId: number | null,
    where: "after" | "before" | "end",
    side?: BlockSide,
  ) => boolean;
  readonly onDropBlock: (fid: number, kind: string, pos: Pos) => void;
  readonly onMoveJoin?: (ifId: number, pos: Pos) => void;
  readonly setPkgOff: (next: Pos) => void;
  readonly pkgOff: Pos;
  readonly flashHint: (text: string) => void;
  readonly setZoom: (z: number) => void;
  readonly zoomBy: (factor: number) => void;
  readonly edges: readonly CanvasDrawnEdge[];
  readonly flow: FlowState | null;
  readonly placeBranchMember: (
    fid: number,
    ifId: number,
    branch: BranchSide,
    blockId: number,
  ) => void;
}

interface UseCanvasGesturesResult {
  readonly onBoardPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  readonly onBoardPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  readonly onBoardPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  readonly onBoardClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  readonly onBoardKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: () => void;
  readonly dragPos: { readonly fid: number; readonly id: number; readonly pos: Pos } | null;
  readonly preview: { readonly fid: number; readonly sourceId: number; readonly side: BlockSide; readonly x: number; readonly y: number } | null;
  readonly branchDrag: { readonly fid: number; readonly ifId: number; readonly branch: BranchSide; readonly dx: number; readonly dy: number } | null;
  readonly joinDrag: { readonly ifId: number; readonly dx: number; readonly dy: number } | null;
  readonly hint: string;
  readonly pinnedBlocks: ReadonlySet<number>;
  readonly branchDragOffsets: { readonly fid: number; readonly map: ReadonlyMap<number, Pos> } | null;
  readonly memberSideOf: (fid: number, id: number) => BranchSide | undefined;
  readonly dragEffectivePos: (fid: number, cmd: CommandSummary, index: number) => Pos;
  readonly joinLivePos: (fid: number, ifId: number) => Pos | null;
  readonly joinBasePos: (fid: number, ifId: number) => Pos | null;
  readonly previewNode: () => ReactElement | null;
  readonly drawing: ReadonlySet<string>;
}

export function useCanvasGestures(args: UseCanvasGesturesArgs): UseCanvasGesturesResult {
  const {
    boardRef,
    busy,
    selectedFunctionId,
    selectedCommandId,
    commandsByFunction,
    layoutStore,
    sizes,
    ifShapesByFunction,
    posOf,
    blockWorld,
    funcOrigin,
    mergeJoins,
    zoom,
    onSelectFunction,
    onSelectCommand,
    onMoveBlock,
    onReconnect,
    onMoveJoin,
    setPkgOff,
    pkgOff,
    setZoom,
    edges,
    flow,
    placeBranchMember,
  } = args;

  // Shared gesture state
  const gestureRef = useRef<CanvasGesture>(null);
  const pointersRef = useRef(new Map<number, Pos>());
  const movedRef = useRef<boolean>(false);
  const hintTimer = useRef<number | null>(null);
  const selectStampRef = useRef<number>(0);
  const pendingMoveRef = useRef<React.PointerEvent<HTMLDivElement> | null>(null);
  const moveRafRef = useRef<number>(0);

  const [hint, setHint] = useState("");

  const flashHintInternal = useCallback((text: string): void => {
    setHint(text);
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(""), 2600);
  }, []);

  // Sub-hooks
  const blockDrag = useCanvasBlockDrag({
    onMoveBlock,
    pkgOff,
    setPkgOff,
  });

  const connections = useCanvasConnections({
    onReconnect,
    commandsByFunction,
    blockWorld,
    funcOrigin,
    sizes,
    selectedFunctionId,
    selectedCommandId,
    mergeJoins,
    ifShapesByFunction,
    edges,
    flow,
    flashHint: flashHintInternal,
    placeBranchMember,
  });

  const branchLayout = useCanvasBranchLayout({
    ifShapesByFunction,
    layoutStore,
    layout: {
      funcOrigin,
      posOf,
    },
    sizes,
    mergeJoins,
    onMoveBlock,
    onMoveJoin,
    commandsByFunction,
  });

  const pinnedBlocks = new Set<number>();
  if (selectedCommandId !== null) pinnedBlocks.add(selectedCommandId);

  const dragEffectivePos = useCallback(
    (fid: number, cmd: CommandSummary, index: number): Pos => {
      if (blockDrag.dragPos !== null && blockDrag.dragPos.fid === fid && blockDrag.dragPos.id === cmd.id) {
        return blockDrag.dragPos.pos;
      }
      const base = posOf(fid, cmd, index);
      const drag = branchLayout.branchDragOffsets !== null &&
        branchLayout.branchDragOffsets.fid === fid
        ? branchLayout.branchDragOffsets.map.get(cmd.id)
        : undefined;
      if (drag === undefined) return clampBlockPos(base, 8, BLOCK_MIN_Y);
      return clampBlockPos({ x: base.x + drag.x, y: base.y + drag.y }, 8, BLOCK_MIN_Y);
    },
    [blockDrag.dragPos, posOf, branchLayout.branchDragOffsets],
  );

  // --- Pointer down ---

  const onBoardPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (busy) return;
      const board = boardRef.current;
      if (board === null) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        const pts = [...pointersRef.current.values()];
        const first = pts[0] ?? { x: 0, y: 0 };
        const second = pts[1] ?? { x: 0, y: 0 };
        gestureRef.current = {
          kind: "pinch",
          startZoom: zoom,
          lastDist: Math.hypot(second.x - first.x, second.y - first.y),
        };
        movedRef.current = true;
        blockDrag.cancelDrag();
        return;
      }
      if (pointersRef.current.size > 2) return;
      const target = e.target as Element;
      const port = target.closest('[data-port="out"]');
      if (port instanceof HTMLElement) {
        const id = Number(port.dataset.blockId);
        const fid = Number(port.dataset.fid);
        if (!Number.isFinite(id) || !Number.isFinite(fid)) return;
        if (fid !== selectedFunctionId) {
          onSelectFunction(fid);
          flashHintInternal("Selected its function — drag again to connect.");
          return;
        }
        const side = (port.dataset.side ?? "right") as BlockSide;
        gestureRef.current = { kind: "connect", fid, sourceId: id, side };
        movedRef.current = false;
        try {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        } catch {}
        return;
      }
      const block = target.closest("[data-block-id]");
      if (block instanceof HTMLElement && block.classList.contains("vblock")) {
        const id = Number(block.dataset.blockId);
        const fid = Number(
          (block as HTMLElement).dataset.fid ?? selectedFunctionId ?? NaN,
        );
        if (!Number.isFinite(id) || !Number.isFinite(fid)) return;
        if (fid !== selectedFunctionId) {
          onSelectFunction(fid);
          return;
        }
        const cmds = commandsByFunction[fid] ?? [];
        const index = cmds.findIndex((c) => c.id === id);
        if (index < 0) return;
        const origin = cmds[index] as CommandSummary;
        const origPos = posOf(fid, origin, index);
        gestureRef.current = {
          kind: "block",
          fid,
          id,
          startX: e.clientX,
          startY: e.clientY,
          orig: origPos,
        };
        blockDrag.startBlockDrag(fid, id, origPos);
        movedRef.current = false;
        return;
      }
      const join = target.closest(".vjoin");
      if (join instanceof HTMLElement) {
        const fid = Number((join as HTMLElement).dataset.fid ?? NaN);
        const ifId = Number((join as HTMLElement).dataset.joinOf ?? NaN);
        if (!Number.isFinite(fid) || !Number.isFinite(ifId)) return;
        if (fid !== selectedFunctionId) {
          onSelectFunction(fid);
          return;
        }
        const base = branchLayout.joinBasePos(fid, ifId);
        if (base === null) return;
        branchLayout.startJoinDrag(fid, ifId, e.clientX, e.clientY, base);
        gestureRef.current = { kind: "join", fid, ifId, startX: e.clientX, startY: e.clientY };
        movedRef.current = false;
        try {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        } catch {}
        return;
      }
      const frame = target.closest(".vbranch");
      if (frame instanceof HTMLElement) {
        const fid = Number(frame.dataset.fid ?? NaN);
        const ifId = Number(frame.dataset.ifId ?? NaN);
        const branch = frame.dataset.ifBranch;
        if (!Number.isFinite(fid) || !Number.isFinite(ifId)) return;
        if (branch !== "then" && branch !== "else") return;
        if (fid !== selectedFunctionId) {
          onSelectFunction(fid);
          return;
        }
        const shape = (ifShapesByFunction.get(fid) ?? []).find(
          (s) => s.ifId === ifId,
        );
        const ids = shape === undefined ? [] : branch === "then" ? shape.then : shape.else;
        const cmds = commandsByFunction[fid] ?? [];
        const byIndex = new Map<number, number>(cmds.map((c, i) => [c.id, i]));
        const store = layoutStore[fid];
        const members: { id: number; orig: Pos }[] = [];
        for (const id of ids) {
          const index = byIndex.get(id);
          if (index === undefined) continue;
          members.push({
            id,
            orig: store?.[id] ?? { x: 48, y: 36 + index * 264 },
          });
        }
        if (members.length === 0) return;
        branchLayout.startBranchDrag(fid, ifId, branch as BranchSide, e.clientX, e.clientY, members);
        gestureRef.current = {
          kind: "branch",
          fid,
          ifId,
          branch: branch as BranchSide,
          startX: e.clientX,
          startY: e.clientY,
        };
        movedRef.current = false;
        try {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        } catch {}
        return;
      }
      const func = target.closest(".funcc");
      if (func instanceof HTMLElement) {
        const match = func.id.match(/^func-(\d+)$/);
        if (match !== null) {
          const fid = Number(match[1]);
          if (Number.isFinite(fid) && fid !== selectedFunctionId) {
            onSelectFunction(fid);
            return;
          }
        }
      }
      const pkg = target.closest(".pkg");
      if (pkg instanceof HTMLElement) {
        gestureRef.current = {
          kind: "pkg",
          startX: e.clientX,
          startY: e.clientY,
          orig: { ...pkgOff },
        };
        movedRef.current = false;
        return;
      }
      gestureRef.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        left: board.scrollLeft,
        top: board.scrollTop,
      };
      movedRef.current = false;
    },
    [
      busy, boardRef, pointersRef, gestureRef, movedRef, zoom,
      blockDrag, onSelectFunction, flashHintInternal, selectedFunctionId,
      commandsByFunction, posOf, branchLayout, ifShapesByFunction,
      layoutStore, pkgOff, onMoveBlock,
    ],
  );

  // --- Apply pointer move ---

  const applyPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const gesture = gestureRef.current;
      const board = boardRef.current;
      if (gesture === null || board === null) return;
      if (gesture.kind === "pinch") {
        const pts = [...pointersRef.current.values()];
        if (pts.length < 2) return;
        const first = pts[0] ?? { x: 0, y: 0 };
        const second = pts[1] ?? { x: 0, y: 0 };
        const dist = Math.hypot(second.x - first.x, second.y - first.y);
        const factor = dist / gesture.lastDist;
        gestureRef.current = { ...gesture, lastDist: dist };
        const z = zoom;
        const next = Math.min(1.5, Math.max(0.25, z * factor));
        if (Math.abs(next - z) < 1e-9) return;
        setZoom(next);
        const rect = board.getBoundingClientRect();
        const mx = (first.x + second.x) / 2 - rect.left;
        const my = (first.y + second.y) / 2 - rect.top;
        const wx = (board.scrollLeft + mx) / z;
        const wy = (board.scrollTop + my) / z;
        board.scrollLeft = Math.max(0, wx * next - (wx * z - board.scrollLeft));
        board.scrollTop = Math.max(0, wy * next - (wy * z - board.scrollTop));
        return;
      }
      if (gesture.kind === "block") {
        const dx = (e.clientX - gesture.startX) / zoom;
        const dy = (e.clientY - gesture.startY) / zoom;
        if (!movedRef.current && Math.hypot(dx, dy) * zoom < 4) return;
        movedRef.current = true;
        blockDrag.applyBlockDragMove(
          e.clientX, e.clientY,
          gesture.startX, gesture.startY,
          gesture.orig, zoom,
        );
      } else if (gesture.kind === "connect") {
        movedRef.current = true;
        connections.applyConnectMove(board, e.clientX, e.clientY, zoom, gesture.fid, gesture.sourceId, gesture.side);
      } else if (gesture.kind === "branch") {
        const dx = (e.clientX - gesture.startX) / zoom;
        const dy = (e.clientY - gesture.startY) / zoom;
        if (!movedRef.current && Math.hypot(dx, dy) * zoom < 4) return;
        movedRef.current = true;
        branchLayout.applyBranchDragMove(
          e.clientX, e.clientY,
          gesture.startX, gesture.startY, zoom,
        );
      } else if (gesture.kind === "join") {
        const dx = (e.clientX - gesture.startX) / zoom;
        const dy = (e.clientY - gesture.startY) / zoom;
        if (!movedRef.current && Math.hypot(dx, dy) * zoom < 4) return;
        movedRef.current = true;
        branchLayout.applyJoinDragMove(
          e.clientX, e.clientY,
          gesture.startX, gesture.startY, zoom,
        );
      } else if (gesture.kind === "pkg") {
        const dx = (e.clientX - gesture.startX) / zoom;
        const dy = (e.clientY - gesture.startY) / zoom;
        if (!movedRef.current && Math.hypot(dx, dy) * zoom < 4) return;
        movedRef.current = true;
        blockDrag.applyPkgDragMove(
          e.clientX, e.clientY,
          gesture.startX, gesture.startY,
          gesture.orig, zoom,
        );
      } else {
        const dx = e.clientX - gesture.startX;
        const dy = e.clientY - gesture.startY;
        if (!movedRef.current && Math.hypot(dx, dy) < 4) return;
        movedRef.current = true;
        board.scrollLeft = gesture.left - dx;
        board.scrollTop = gesture.top - dy;
      }
    },
    [
      gestureRef, boardRef, pointersRef, movedRef, zoom,
      blockDrag, connections, branchLayout, setZoom,
    ],
  );

  const onBoardPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (gestureRef.current === null) return;
      if (gestureRef.current.kind === "pinch") {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        applyPointerMove(e);
        return;
      }
      pendingMoveRef.current = e;
      if (moveRafRef.current !== 0) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = 0;
        const latest = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (latest !== null) applyPointerMove(latest);
      });
    },
    [applyPointerMove],
  );

  useCallback((): (() => void) => {
    return () => {
      if (moveRafRef.current !== 0) cancelAnimationFrame(moveRafRef.current);
    };
  }, []);

  // --- End gesture ---

  const endGesture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      pointersRef.current.delete(e.pointerId);
      if (gesture?.kind === "pinch") {
        if (moveRafRef.current !== 0) {
          cancelAnimationFrame(moveRafRef.current);
          moveRafRef.current = 0;
        }
        pendingMoveRef.current = null;
        movedRef.current = false;
        selectStampRef.current = Date.now();
        return;
      }
      if (moveRafRef.current !== 0) {
        cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = 0;
        const latest = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (latest !== null && gesture !== null) {
          gestureRef.current = gesture;
          applyPointerMove(latest);
          gestureRef.current = null;
        }
      } else {
        pendingMoveRef.current = null;
      }
      if (gesture === null) return;

      if (gesture.kind === "block") {
        blockDrag.endBlockDrag(movedRef.current);
        if (!movedRef.current) {
          onSelectCommand(selectedCommandId === gesture.id ? null : gesture.id);
        }
      } else if (gesture.kind === "connect") {
        connections.endConnect(
          { clientX: e.clientX, clientY: e.clientY },
          { fid: gesture.fid, sourceId: gesture.sourceId, side: gesture.side },
          movedRef.current,
        );
      } else if (gesture.kind === "branch") {
        branchLayout.endBranchDrag(movedRef.current);
      } else if (gesture.kind === "join") {
        branchLayout.endJoinDrag(movedRef.current);
      } else {
        if (!movedRef.current) onSelectCommand(null);
      }
      movedRef.current = false;
      selectStampRef.current = Date.now();
    },
    [
      gestureRef, pointersRef, moveRafRef, pendingMoveRef,
      blockDrag, connections, branchLayout,
      onSelectCommand, onSelectFunction, applyPointerMove, movedRef,
    ],
  );

  // --- Click / key / cancel ---

  const onBoardClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (Date.now() - selectStampRef.current < 500) return;
      const target = e.target as Element;
      if (target.closest("button, input, select, summary, a")) return;
      const block = target.closest("[data-block-id]");
      if (block instanceof HTMLElement && block.classList.contains("vblock")) {
        const id = Number(block.dataset.blockId);
        const fid = Number(block.dataset.fid ?? NaN);
        if (!Number.isFinite(id)) return;
        if (!Number.isFinite(fid) || fid !== selectedFunctionId) {
          if (Number.isFinite(fid)) onSelectFunction(fid);
          return;
        }
        onSelectCommand(selectedCommandId === id ? null : id);
      } else {
        const func = target.closest(".funcc");
        if (func instanceof HTMLElement) {
          const match = func.id.match(/^func-(\d+)$/);
          if (match !== null) {
            const fid = Number(match[1]);
            if (Number.isFinite(fid) && fid !== selectedFunctionId) {
              onSelectFunction(fid);
              return;
            }
          }
        }
        onSelectCommand(null);
      }
    },
    [selectStampRef, selectedFunctionId, selectedCommandId, onSelectFunction, onSelectCommand],
  );

  const onBoardKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target as Element;
      const block = target.closest?.("[data-block-id]");
      if (block instanceof HTMLElement && block.classList.contains("vblock")) {
        const id = Number(block.dataset.blockId);
        const fid = Number(block.dataset.fid ?? NaN);
        if (!Number.isFinite(id)) return;
        if (!Number.isFinite(fid) || fid !== selectedFunctionId) {
          if (Number.isFinite(fid)) onSelectFunction(fid);
          return;
        }
        e.preventDefault();
        onSelectCommand(selectedCommandId === id ? null : id);
      }
    },
    [selectedFunctionId, selectedCommandId, onSelectFunction, onSelectCommand],
  );

  const onPointerCancel = useCallback((): void => {
    gestureRef.current = null;
    pointersRef.current.clear();
    blockDrag.cancelDrag();
    branchLayout.endBranchDrag(false);
    branchLayout.endJoinDrag(false);
    connections.endConnect(
      { clientX: 0, clientY: 0 },
      { fid: 0, sourceId: 0, side: "right" },
      false,
    );
  }, [blockDrag, branchLayout, connections]);

  return {
    onBoardPointerDown,
    onBoardPointerMove,
    onBoardPointerUp: endGesture,
    onBoardClick,
    onBoardKeyDown,
    onPointerCancel,
    dragPos: blockDrag.dragPos,
    preview: connections.preview,
    branchDrag: branchLayout.branchDrag,
    joinDrag: branchLayout.joinDrag,
    hint,
    pinnedBlocks,
    branchDragOffsets: branchLayout.branchDragOffsets,
    memberSideOf: branchLayout.memberSideOf,
    dragEffectivePos,
    joinLivePos: branchLayout.joinLivePos,
    joinBasePos: branchLayout.joinBasePos,
    previewNode: connections.previewNode,
    drawing: connections.drawing,
  };
}
