/**
 * Canvas branch layout: branch membership, branch frame derivation,
 * branch layout, branch member placement, branch drag offsets, branch
 * membership changes, automatic placement of newly joined branch
 * members, and manual merge join positioning. Presentation only — the
 * engine owns branch semantics.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { CommandSummary } from "../../lib/optilotus";
import type { BlockRect } from "../../lib/graph_geometry";
import type { BranchSide } from "../../lib/graph_topology";
import type { Pos, LayoutMap } from "../../lib/layout";
import type { Size } from "../../components/visualEditor_constants";
import type { IfShape, MergeJoin } from "../../lib/graph";
import { buildIfShapes, joinDefaultPos, JOIN_FALLBACK_SIZE } from "../../lib/graph";
import { branchDropPos } from "../../lib/layout";
import { BLOCK_MIN_Y, FALLBACK_SIZE } from "../../components/visualEditor_constants";
import { clampBlockPos } from "../../lib/canvas_geometry";

export interface BranchDragState {
  readonly fid: number;
  readonly ifId: number;
  readonly branch: BranchSide;
  readonly dx: number;
  readonly dy: number;
}

export interface JoinDragState {
  readonly ifId: number;
  readonly dx: number;
  readonly dy: number;
}

export interface BranchDragMember {
  readonly id: number;
  readonly orig: Pos;
}

export interface BranchFrame {
  readonly ifId: number;
  readonly branch: BranchSide;
  readonly rect: BlockRect;
  readonly empty: boolean;
}

export interface BranchDragOffsets {
  readonly fid: number;
  readonly map: ReadonlyMap<number, Pos>;
}

interface UseCanvasBranchLayoutArgs {
  readonly ifShapesByFunction: ReadonlyMap<number, readonly IfShape[]>;
  readonly layoutStore: Readonly<Record<number, LayoutMap>>;
  readonly layout: {
    readonly funcOrigin: (fid: number) => Pos;
    readonly posOf: (fid: number, cmd: CommandSummary, index: number) => Pos;
  };
  readonly sizes: ReadonlyMap<string, Size>;
  readonly mergeJoins?: Readonly<Record<number, MergeJoin>>;
  readonly onMoveBlock: (fid: number, id: number, pos: Pos) => void;
  readonly onMoveJoin?: (ifId: number, pos: Pos) => void;
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
}

interface UseCanvasBranchLayoutResult {
  readonly branchDrag: BranchDragState | null;
  readonly setBranchDrag: (next: BranchDragState | null) => void;
  readonly branchDragRef: React.MutableRefObject<BranchDragState | null>;
  readonly branchMembersRef: React.MutableRefObject<readonly BranchDragMember[]>;
  readonly joinDrag: JoinDragState | null;
  readonly setJoinDrag: (next: JoinDragState | null) => void;
  readonly joinDragRef: React.MutableRefObject<JoinDragState | null>;
  readonly joinBaseRef: React.MutableRefObject<Pos | null>;
  readonly startBranchDrag: (
    fid: number,
    ifId: number,
    branch: BranchSide,
    startX: number,
    startY: number,
    members: readonly BranchDragMember[],
  ) => void;
  readonly applyBranchDragMove: (
    clientX: number,
    clientY: number,
    startX: number,
    startY: number,
    zoom: number,
  ) => void;
  readonly endBranchDrag: (moved: boolean) => void;
  readonly startJoinDrag: (
    fid: number,
    ifId: number,
    startX: number,
    startY: number,
    base: Pos,
  ) => void;
  readonly applyJoinDragMove: (
    clientX: number,
    clientY: number,
    startX: number,
    startY: number,
    zoom: number,
  ) => void;
  readonly endJoinDrag: (moved: boolean) => void;
  readonly joinBasePos: (fid: number, ifId: number) => Pos | null;
  readonly joinWorldRect: (fid: number, ifId: number) => BlockRect | null;
  readonly joinLivePos: (fid: number, ifId: number) => Pos | null;
  readonly memberSideOf: (fid: number, id: number) => BranchSide | undefined;
  readonly branchFrames: (
    fid: number,
    viewport: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null,
  ) => readonly BranchFrame[];
  readonly branchDragOffsets: BranchDragOffsets | null;
  readonly placeBranchMember: (
    fid: number,
    ifId: number,
    branch: BranchSide,
    blockId: number,
  ) => void;
}

export function useCanvasBranchLayout(args: UseCanvasBranchLayoutArgs): UseCanvasBranchLayoutResult {
  const {
    ifShapesByFunction,
    layoutStore,
    layout,
    sizes,
    mergeJoins,
    onMoveBlock,
    onMoveJoin,
    commandsByFunction,
  } = args;

  const [branchDrag, setBranchDrag] = useState<BranchDragState | null>(null);
  const branchDragRef = useRef<BranchDragState | null>(null);
  const branchMembersRef = useRef<readonly BranchDragMember[]>([]);
  const [joinDrag, setJoinDrag] = useState<JoinDragState | null>(null);
  const joinDragRef = useRef<JoinDragState | null>(null);
  const joinBaseRef = useRef<Pos | null>(null);

  const startBranchDrag = useCallback(
    (
      fid: number,
      ifId: number,
      branch: BranchSide,
      _startX: number,
      _startY: number,
      members: readonly BranchDragMember[],
    ): void => {
      branchMembersRef.current = members;
      const next: BranchDragState = {
        fid,
        ifId,
        branch,
        dx: 0,
        dy: 0,
      };
      branchDragRef.current = next;
      setBranchDrag(next);
    },
    [],
  );

  const applyBranchDragMove = useCallback(
    (
      clientX: number,
      clientY: number,
      _startX: number,
      _startY: number,
      zoom: number,
    ): void => {
      const dx = (clientX - _startX) / zoom;
      const dy = (clientY - _startY) / zoom;
      const next: BranchDragState = {
        fid: branchDragRef.current?.fid ?? -1,
        ifId: branchDragRef.current?.ifId ?? -1,
        branch: branchDragRef.current?.branch ?? "then",
        dx,
        dy,
      };
      branchDragRef.current = next;
      setBranchDrag(next);
    },
    [],
  );

  const endBranchDrag = useCallback(
    (moved: boolean): void => {
      const drag =
        branchDragRef.current !== null ? branchDragRef.current : null;
      branchDragRef.current = null;
      setBranchDrag(null);
      if (moved && drag !== null) {
        for (const member of branchMembersRef.current) {
          onMoveBlock(
            drag.fid,
            member.id,
            clampBlockPos(
              { x: member.orig.x + drag.dx, y: member.orig.y + drag.dy },
              8,
              BLOCK_MIN_Y,
            ),
          );
        }
      }
      branchMembersRef.current = [];
    },
    [onMoveBlock],
  );

  const startJoinDrag = useCallback(
    (_fid: number, ifId: number, _startX: number, _startY: number, base: Pos): void => {
      joinBaseRef.current = base;
      const next: JoinDragState = {
        ifId,
        dx: 0,
        dy: 0,
      };
      joinDragRef.current = next;
      setJoinDrag(next);
    },
    [],
  );

  const applyJoinDragMove = useCallback(
    (
      clientX: number,
      clientY: number,
      startX: number,
      startY: number,
      zoom: number,
    ): void => {
      const dx = (clientX - startX) / zoom;
      const dy = (clientY - startY) / zoom;
      const next: JoinDragState = {
        ifId: joinDragRef.current?.ifId ?? -1,
        dx,
        dy,
      };
      joinDragRef.current = next;
      setJoinDrag(next);
    },
    [],
  );

  const endJoinDrag = useCallback(
    (moved: boolean): void => {
      const drag =
        joinDragRef.current !== null ? joinDragRef.current : null;
      joinDragRef.current = null;
      setJoinDrag(null);
      const base = joinBaseRef.current;
      joinBaseRef.current = null;
      if (moved && drag !== null && base !== null && onMoveJoin !== undefined) {
        onMoveJoin(drag.ifId, {
          x: Math.max(8, base.x + drag.dx),
          y: Math.max(BLOCK_MIN_Y, base.y + drag.dy),
        });
      }
    },
    [onMoveJoin],
  );

  const joinBasePos = useCallback(
    (fid: number, ifId: number): Pos | null => {
      const state = mergeJoins?.[ifId];
      if (state === undefined || !state.on) return null;
      const shape = (ifShapesByFunction.get(fid) ?? []).find(
        (s) => s.ifId === ifId,
      );
      const pos = state.pos ?? joinDefaultPos(shape?.frames ?? []);
      if (pos === null) return null;
      return { x: pos.x, y: pos.y };
    },
    [ifShapesByFunction, mergeJoins],
  );

  const joinWorldRect = useCallback(
    (fid: number, ifId: number): BlockRect | null => {
      const base = joinBasePos(fid, ifId);
      if (base === null) return null;
      const s = sizes.get(`${fid}:join:${ifId}`) ?? JOIN_FALLBACK_SIZE;
      const f = layout.funcOrigin(fid);
      return { x: f.x + base.x, y: f.y + base.y, w: s.w, h: s.h };
    },
    [joinBasePos, sizes, layout],
  );

  const joinLivePos = useCallback(
    (fid: number, ifId: number): Pos | null => {
      const base = joinBasePos(fid, ifId);
      if (base === null) return null;
      const drag =
        joinDrag !== null && joinDrag.ifId === ifId ? joinDrag : null;
      if (drag === null) return base;
      return { x: base.x + drag.dx, y: base.y + drag.dy };
    },
    [joinBasePos, joinDrag],
  );

  const memberSideOf = useCallback(
    (fid: number, id: number): BranchSide | undefined => {
      for (const shape of ifShapesByFunction.get(fid) ?? []) {
        const side = shape.branchOf.get(id);
        if (side !== undefined) return side;
      }
      return undefined;
    },
    [ifShapesByFunction],
  );

  const branchFrames = useCallback(
    (
      fid: number,
      viewport: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null,
    ): readonly BranchFrame[] => {
      const f = layout.funcOrigin(fid);
      const overscan =
        viewport === null ? null : {
          x: viewport.x - 800,
          y: viewport.y - 800,
          w: viewport.w + 1600,
          h: viewport.h + 1600,
        };
      const frames: BranchFrame[] = [];
      for (const shape of ifShapesByFunction.get(fid) ?? []) {
        for (const frame of shape.frames) {
          let rect = frame.rect;
          const drag =
            branchDrag !== null &&
            branchDrag.fid === fid &&
            branchDrag.ifId === shape.ifId &&
            branchDrag.branch === frame.branch
              ? branchDrag
              : null;
          if (drag !== null) {
            rect = {
              x: rect.x + drag.dx,
              y: rect.y + drag.dy,
              w: rect.w,
              h: rect.h,
            };
          }
          if (overscan !== null) {
            const world = {
              x: f.x + rect.x,
              y: f.y + rect.y,
              w: rect.w,
              h: rect.h,
            };
            if (
              world.x < overscan.x + overscan.w &&
              world.x + world.w > overscan.x &&
              world.y < overscan.y + overscan.h &&
              world.y + world.h > overscan.y
            ) {
              frames.push({ ...frame, rect, ifId: shape.ifId });
            }
          } else {
            frames.push({ ...frame, rect, ifId: shape.ifId });
          }
        }
      }
      return frames;
    },
    [branchDrag, ifShapesByFunction, layout],
  );

  const branchDragOffsets = useMemo((): BranchDragOffsets | null => {
    const drag = branchDrag;
    if (drag === null) return null;
    const map = new Map<number, Pos>();
    for (const shape of ifShapesByFunction.get(drag.fid) ?? []) {
      if (shape.ifId !== drag.ifId) continue;
      const ids = drag.branch === "then" ? shape.then : shape.else;
      for (const id of ids) map.set(id, { x: drag.dx, y: drag.dy });
    }
    return { fid: drag.fid, map };
  }, [branchDrag, ifShapesByFunction]);

  const placeBranchMember = useCallback(
    (fid: number, ifId: number, branch: BranchSide, blockId: number): void => {
      if (branch !== "then" && branch !== "else") return;
      const cmds = commandsByFunction[fid] ?? [];
      const byIndex = new Map<number, number>(
        cmds.map((c, i) => [c.id, i] as const),
      );
      const ifIndex = byIndex.get(ifId);
      const ifCmd = ifIndex === undefined ? undefined : cmds[ifIndex];
      if (ifCmd === undefined || ifIndex === undefined) return;
      const store = layoutStore[fid];
      const ifPos = store?.[ifId] ?? { x: 48, y: 36 + ifIndex * 264 };
      const ifSize = sizes.get(`${fid}:${ifId}`) ?? FALLBACK_SIZE;
      const shape = (ifShapesByFunction.get(fid) ?? []).find(
        (s) => s.ifId === ifId,
      );
      const memberIds =
        branch === "then"
          ? (shape?.then ?? [])
          : (shape?.else ?? []);
      const memberRects: (readonly [number, number])[] = [];
      for (const id of memberIds) {
        if (id === blockId) continue;
        const index = byIndex.get(id) ?? -1;
        const cmd = cmds[index];
        if (cmd === undefined) continue;
        const p = store?.[cmd.id] ?? { x: 48, y: 36 + index * 264 };
        const s = sizes.get(`${fid}:${cmd.id}`) ?? FALLBACK_SIZE;
        memberRects.push([p.y, s.h] as const);
      }
      const rectOf = (id: number): BlockRect | undefined => {
        const idx = byIndex.get(id);
        const command = idx === undefined ? undefined : cmds[idx];
        if (command === undefined || idx === undefined) return undefined;
        const p = store?.[command.id] ?? { x: 48, y: 36 + idx * 264 };
        const s = sizes.get(`${fid}:${command.id}`) ?? FALLBACK_SIZE;
        return { x: p.x, y: p.y, w: s.w, h: s.h };
      };
      const preFrame = buildIfShapes(
        cmds.map((c) => {
          if (!(c.id === ifId && c.kind === "if")) return c;
          if (branch === "then") {
            return { ...c, then_body: [] };
          }
          return { ...c, else_body: [] };
        }),
        rectOf,
        rectOf,
      )
        .find((s) => s.ifId === ifId)
        ?.frames.find((f) => f.branch === branch)?.rect;
      const p =
        store?.[blockId] ?? { x: 48, y: 36 + (byIndex.get(blockId) ?? -1) * 264 };
      if (
        preFrame !== undefined &&
        p.x >= preFrame.x &&
        p.x <= preFrame.x + preFrame.w &&
        p.y >= preFrame.y &&
        p.y <= preFrame.y + preFrame.h
      ) {
        return;
      }
      const dropPos = branchDropPos({
        branch,
        ifRect: { x: ifPos.x, y: ifPos.y, w: ifSize.w, h: ifSize.h },
        memberRects,
      });
      onMoveBlock(fid, blockId, dropPos);
    },
    [commandsByFunction, layoutStore, sizes, ifShapesByFunction, onMoveBlock],
  );

  return {
    branchDrag,
    setBranchDrag,
    branchDragRef,
    branchMembersRef,
    joinDrag,
    setJoinDrag,
    joinDragRef,
    joinBaseRef,
    startBranchDrag,
    applyBranchDragMove,
    endBranchDrag,
    startJoinDrag,
    applyJoinDragMove,
    endJoinDrag,
    joinBasePos,
    joinWorldRect,
    joinLivePos,
    memberSideOf,
    branchFrames,
    branchDragOffsets,
    placeBranchMember,
  };
}
