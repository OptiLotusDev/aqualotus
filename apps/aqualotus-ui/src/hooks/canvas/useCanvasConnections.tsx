/**
 * Canvas connections: connection drawing state, previews, source and
 * destination resolution, connection drag lifecycle, drop resolution,
 * and reconnection interactions. Uses the existing `onReconnect`
 * callback and `resolveBranchConnect` planner — graph semantics remain
 * the engine's.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommandSummary } from "../../lib/optilotus";
import type { BlockSide } from "../../lib/graph_geometry";
import type { BranchSide } from "../../lib/graph_topology";
import type { Pos } from "../../lib/layout";
import type { FlowState } from "../../lib/flow";
import type { MergeJoin, IfShape } from "../../lib/graph";
import type { Size } from "../../components/visualEditor_constants";
import { resolveBranchConnect } from "../../lib/branching";
import type { CanvasDrawnEdge } from "../../lib/canvas_edges";
import { edgePath, BRANCH_PORT_FRACTION } from "../../lib/graph_geometry";
import { screenToWorld } from "../../lib/history";
import {
  FALLBACK_SIZE,
  EMPTY_EDGE_KEYS,
  EDGE_DRAW_MS,
} from "../../components/visualEditor_constants";
import { JOIN_FALLBACK_SIZE } from "../../lib/graph";

export interface ConnectionPreview {
  readonly fid: number;
  readonly sourceId: number;
  readonly side: BlockSide;
  readonly x: number;
  readonly y: number;
}

export interface TravelEdge {
  readonly key: string;
  readonly selected: boolean;
}

interface UseCanvasConnectionsArgs {
  readonly onReconnect: (
    fid: number,
    sourceId: number,
    targetId: number | null,
    where: "after" | "before" | "end",
    side?: BlockSide,
  ) => boolean;
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
  readonly blockWorld: (fid: number, cmd: CommandSummary, index: number) => Pos;
  readonly funcOrigin: (fid: number) => Pos;
  readonly sizes: ReadonlyMap<string, Size>;
  readonly selectedFunctionId: number | null;
  readonly selectedCommandId: number | null;
  readonly mergeJoins?: Readonly<Record<number, MergeJoin>>;
  readonly ifShapesByFunction: ReadonlyMap<number, readonly IfShape[]>;
  readonly edges: readonly CanvasDrawnEdge[];
  readonly flow: FlowState | null;
  readonly flashHint: (text: string) => void;
  readonly placeBranchMember: (
    fid: number,
    ifId: number,
    branch: BranchSide,
    blockId: number,
  ) => void;
}

interface UseCanvasConnectionsResult {
  readonly drawing: ReadonlySet<string>;
  readonly preview: ConnectionPreview | null;
  readonly setPreview: (next: ConnectionPreview | null) => void;
  readonly applyConnectMove: (
    board: HTMLDivElement,
    clientX: number,
    clientY: number,
    zoom: number,
    fid: number,
    sourceId: number,
    side: BlockSide,
  ) => void;
  readonly endConnect: (
    e: { clientX: number; clientY: number },
    gesture: { readonly fid: number; readonly sourceId: number; readonly side: BlockSide },
    moved: boolean,
  ) => void;
  readonly travelEdges: readonly TravelEdge[];
  readonly previewNode: () => React.ReactElement | null;
}

export function useCanvasConnections(args: UseCanvasConnectionsArgs): UseCanvasConnectionsResult {
  const {
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
    flashHint,
    placeBranchMember,
  } = args;

  const [drawing, setDrawing] = useState<ReadonlySet<string>>(EMPTY_EDGE_KEYS);
  const knownEdges = useRef<ReadonlyMap<string, number> | null>(null);
  const drawTimer = useRef<number | null>(null);
  const [preview, setPreview] = useState<ConnectionPreview | null>(null);

  // Edge draw animation: newly created/rewired connections stretch into
  // place over EDGE_DRAW_MS.
  useEffect(() => {
    const next = new Map(edges.map((edge) => [edge.key, edge.to]));
    const known = knownEdges.current;
    knownEdges.current = next;
    if (known === null) return;
    const touched: string[] = [];
    for (const [key, to] of next) {
      const before = known.get(key);
      if (before === undefined || before !== to) touched.push(key);
    }
    if (touched.length === 0) return;
    setDrawing(new Set(touched));
    if (drawTimer.current !== null) window.clearTimeout(drawTimer.current);
    drawTimer.current = window.setTimeout(() => {
      drawTimer.current = null;
      setDrawing(EMPTY_EDGE_KEYS);
    }, EDGE_DRAW_MS + 80);
    return () => {
      if (drawTimer.current !== null) window.clearTimeout(drawTimer.current);
    };
  }, [edges]);

  // Travel edges: match flow edges to drawn edges for the travelling
  // indicator.
  const travelEdges = useMemo((): readonly TravelEdge[] => {
    if (flow === null || flow === undefined) return [];
    const byEnds = new Map(edges.map((e) => [`${e.fid}:${e.from}:${e.to}`, e]));
    const joinOutAfter = new Map<number, string>();
    for (const e of edges) {
      if (e.joinTail === true && e.joinIfId !== undefined) {
        joinOutAfter.set(e.from, `${e.fid}:jo:${e.joinIfId}`);
      }
    }
    const travelSeen = new Set<string>();
    const out: TravelEdge[] = [];
    const push = (key: string, selected: boolean): void => {
      if (travelSeen.has(key)) return;
      travelSeen.add(key);
      out.push({ key, selected });
    };
    flow.edges.forEach((edge) => {
      const selected =
        edge.from === selectedCommandId && edge.fid === selectedFunctionId;
      if (edge.kind === "merge") {
        push(`${edge.fid}:merge:${edge.from}`, selected);
        const joinOut = joinOutAfter.get(edge.from);
        if (joinOut !== undefined) push(joinOut, selected);
        return;
      }
      const drawn = byEnds.get(`${edge.fid}:${edge.from}:${edge.to}`);
      if (drawn === undefined) return;
      push(drawn.key, selected);
    });
    return out;
  }, [edges, flow, selectedCommandId, selectedFunctionId]);

  const applyConnectMove = useCallback(
    (
      board: HTMLDivElement,
      clientX: number,
      clientY: number,
      zoom: number,
      fid: number,
      sourceId: number,
      side: BlockSide,
    ): void => {
      const rect = board.getBoundingClientRect();
      const world = screenToWorld(
        clientX,
        clientY,
        rect.left,
        rect.top,
        board.scrollLeft,
        board.scrollTop,
        zoom === 0 ? 1 : zoom,
      );
      setPreview({ fid, sourceId, side, x: world.x, y: world.y });
    },
    [],
  );

  const endConnect = useCallback(
    (
      e: { clientX: number; clientY: number },
      gesture: { readonly fid: number; readonly sourceId: number; readonly side: BlockSide },
      moved: boolean,
    ): void => {
      setPreview(null);
      if (!moved) return;

      const stack =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(e.clientX, e.clientY)
          : [];
      const inPortHit = stack.find(
        (el) => el instanceof HTMLElement && el.dataset.port === "in",
      );
      const portBlock =
        inPortHit instanceof HTMLElement
          ? inPortHit.closest("[data-block-id]")
          : null;
      const bodyBlock = stack.find(
        (el) => el instanceof HTMLElement && el.classList.contains("vblock"),
      );
      const block =
        bodyBlock instanceof HTMLElement
          ? bodyBlock
          : portBlock instanceof HTMLElement &&
              portBlock.classList.contains("vblock")
            ? portBlock
            : null;

      const fid = gesture.fid;
      const sourceId = gesture.sourceId;
      const side = gesture.side;
      const cmdsHere = commandsByFunction[fid] ?? [];

      if (block === null) {
        const joinHit = stack.find(
          (el) =>
            el instanceof HTMLElement && (el as HTMLElement).dataset.joinOf !== undefined,
        );
        if (joinHit instanceof HTMLElement) {
          const joinFid = Number(joinHit.dataset.fid ?? NaN);
          const joinIfId = Number(joinHit.dataset.joinOf ?? NaN);
          if (
            Number.isFinite(joinFid) &&
            joinFid === fid &&
            Number.isFinite(joinIfId)
          ) {
            const resolved = resolveBranchConnect(
              cmdsHere,
              sourceId,
              joinIfId,
            );
            if (resolved.kind === "reject") {
              flashHint(resolved.reason);
              return;
            }
            const applied = onReconnect(fid, sourceId, joinIfId, "after", side);
            if (!applied) {
              flashHint("Those blocks are already connected.");
            } else if (resolved.kind === "append") {
              placeBranchMember(fid, resolved.ifId, resolved.branch, sourceId);
            }
          }
          return;
        }
        const containerHit = stack.find(
          (el) =>
            el instanceof HTMLElement && el.dataset.ifBranch !== undefined,
        );
        const container =
          containerHit instanceof HTMLElement ? containerHit : null;
        if (container === null) {
          const resolved = resolveBranchConnect(cmdsHere, sourceId, null);
          if (resolved.kind === "reject") {
            flashHint(resolved.reason);
            return;
          }
          const applied = onReconnect(fid, sourceId, null, "end", side);
          if (!applied) flashHint("That block is already last.");
          return;
        }
        const containerSide = container.dataset.ifBranch;
        const containerIfId = Number(container.dataset.ifId);
        const containerFid = Number(container.dataset.fid);
        if (
          (containerSide !== "then" && containerSide !== "else") ||
          !Number.isFinite(containerIfId) ||
          !Number.isFinite(containerFid)
        ) {
          return;
        }
        if (containerFid !== fid) {
          flashHint("Connections stay inside one function.");
          return;
        }
        const applied = onReconnect(fid, sourceId, containerIfId, "after", containerSide as BlockSide);
        if (!applied) {
          flashHint("The engine could not wire that connection.");
          return;
        }
        placeBranchMember(fid, containerIfId, containerSide as BranchSide, sourceId);
      } else {
        const targetFid = Number(block.dataset.fid ?? NaN);
        if (!Number.isFinite(targetFid) || targetFid !== fid) {
          if (moved) {
            flashHint("Connections stay inside one function.");
          }
        } else {
          const targetId = Number(block.dataset.blockId);
          if (!Number.isFinite(targetId)) return;
          const resolved = resolveBranchConnect(
            cmdsHere,
            sourceId,
            targetId,
          );
          if (resolved.kind === "reject") {
            if (moved) flashHint(resolved.reason);
            return;
          }
          const inPort =
            inPortHit !== undefined && block.contains(inPortHit)
              ? inPortHit
              : undefined;
          const where = inPort !== undefined ? "before" : "after";
          const applied = onReconnect(
            fid,
            sourceId,
            targetId,
            resolved.kind === "append" ? "after" : where,
            side,
          );
          if (!applied) {
            flashHint("Those blocks are already connected.");
          } else if (resolved.kind === "append") {
            placeBranchMember(fid, resolved.ifId, resolved.branch, targetId);
          } else if (
            side === "then" ||
            side === "else"
          ) {
            placeBranchMember(fid, sourceId, side, targetId);
          }
        }
      }
    },
    [commandsByFunction, onReconnect, placeBranchMember, flashHint],
  );

  const previewNode = useCallback((): React.ReactElement | null => {
    if (preview === null) return null;
    const sourceCmds = commandsByFunction[preview.fid] ?? [];
    const sourceIndex = sourceCmds.findIndex((c) => c.id === preview.sourceId);
    const source = sourceIndex >= 0 ? sourceCmds[sourceIndex] : undefined;
    if (source === undefined) return null;
    const origin = blockWorld(preview.fid, source, Math.max(0, sourceIndex));
    const size = sizes.get(`${preview.fid}:${preview.sourceId}`) ?? FALLBACK_SIZE;
    const join =
      source.kind === "if" && preview.side === "right"
        ? (() => {
            const base = mergeJoins?.[preview.sourceId];
            if (base === undefined || !base.on) return null;
            const pos = base.pos ?? null;
            if (pos === null) return null;
            const s2 = sizes.get(`${preview.fid}:join:${preview.sourceId}`) ?? JOIN_FALLBACK_SIZE;
            const f = funcOrigin(preview.fid);
            return { x: f.x + pos.x, y: f.y + pos.y, w: s2.w, h: s2.h };
          })()
        : null;
    if (join !== null) {
      return (
        <path
          d={edgePath(join.x + join.w, join.y + join.h / 2, preview.x, preview.y, true)}
          markerEnd="url(#arrow-flow)"
          className="edge edge-preview"
        />
      );
    }
    const fraction =
      preview.side === "then"
        ? BRANCH_PORT_FRACTION.then
        : preview.side === "else"
          ? BRANCH_PORT_FRACTION.else
          : null;
    const centerBottom = fraction !== null || preview.side === "bottom";
    const ox = fraction === null
      ? preview.side === "bottom"
        ? origin.x + size.w / 2
        : origin.x + size.w
      : origin.x + size.w * fraction;
    const oy = centerBottom ? origin.y + size.h : origin.y + size.h / 2;
    return (
      <path
        d={edgePath(ox, oy, preview.x, preview.y, true)}
        markerEnd="url(#arrow-flow)"
        className="edge edge-preview"
      />
    );
  }, [preview, commandsByFunction, blockWorld, sizes, mergeJoins, ifShapesByFunction, funcOrigin]);

  return {
    drawing,
    preview,
    setPreview,
    applyConnectMove,
    endConnect,
    travelEdges,
    previewNode,
  };
}
