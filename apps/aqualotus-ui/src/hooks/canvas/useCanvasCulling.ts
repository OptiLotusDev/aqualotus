/**
 * Canvas culling: computes pinned blocks and visible commands for viewport
 * culling. Pure over explicit inputs.
 */

import { useCallback, useMemo } from "react";
import type { CommandSummary } from "../../lib/optilotus";
import type { ViewRect } from "../../lib/history";
import { filterVisibleBlocks } from "../../lib/history";
import type { Pos } from "../../lib/layout";
import type { Size } from "../../components/visualEditor_constants";
import { VIEW_OVERSCAN } from "../../components/visualEditor_constants";

interface PinnedBlocksArgs {
  readonly selectedCommandId: number | null;
  readonly errorId: number | null;
  readonly preview: { readonly fid: number; readonly sourceId: number; readonly side: string; readonly x: number; readonly y: number } | null;
  readonly dragPos: { readonly fid: number; readonly id: number; readonly pos: Pos } | null;
}

export function usePinnedBlocks(args: PinnedBlocksArgs): ReadonlySet<number> {
  const { selectedCommandId, errorId, preview, dragPos } = args;

  return useMemo(() => {
    const pinned = new Set<number>();
    if (selectedCommandId !== null) pinned.add(selectedCommandId);
    if (errorId !== null) pinned.add(errorId);
    if (preview !== null) pinned.add(preview.sourceId);
    if (dragPos !== null) pinned.add(dragPos.id);
    return pinned;
  }, [selectedCommandId, errorId, preview, dragPos]);
}

interface VisibleCmdsDeps {
  readonly layout: {
    readonly funcOrigin: (fid: number) => Pos;
    readonly posOf: (fid: number, cmd: CommandSummary, index: number) => Pos;
  };
  readonly sizes: ReadonlyMap<string, Size>;
  readonly viewport: ViewRect | null;
  readonly pinnedBlocks: ReadonlySet<number>;
}

export function useVisibleCmdsGetter(deps: VisibleCmdsDeps): (fid: number, cmds: readonly CommandSummary[]) => { readonly cmd: CommandSummary; readonly index: number }[] {
  const { layout, sizes, viewport, pinnedBlocks } = deps;

  return useCallback(
    (fid: number, cmds: readonly CommandSummary[]) => {
      const items = cmds.map((cmd, index) => {
        const origin = {
          x: layout.funcOrigin(fid).x + layout.posOf(fid, cmd, index).x,
          y: layout.funcOrigin(fid).y + layout.posOf(fid, cmd, index).y,
        };
        const size = sizes.get(`${fid}:${cmd.id}`) ?? { w: 216, h: 104 };
        return {
          cmd,
          index,
          id: cmd.id,
          rect: { x: origin.x, y: origin.y, w: size.w, h: size.h },
        };
      });
      return filterVisibleBlocks(items, viewport, VIEW_OVERSCAN, pinnedBlocks).visible;
    },
    [layout, sizes, viewport, pinnedBlocks],
  );
}

interface CulledBlocksArgs {
  readonly functions: readonly { readonly id: number }[];
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
  readonly layout: {
    readonly funcOrigin: (fid: number) => Pos;
    readonly posOf: (fid: number, cmd: CommandSummary, index: number) => Pos;
  };
  readonly sizes: ReadonlyMap<string, Size>;
  readonly viewport: ViewRect | null;
  readonly pinnedBlocks: ReadonlySet<number>;
}

export function useCulledBlocks(args: CulledBlocksArgs): number {
  const { functions, commandsByFunction, layout, sizes, viewport, pinnedBlocks } = args;

  return useMemo(() => {
    if (viewport === null) return 0;
    let culledBlocks = 0;
    for (const fn of functions) {
      const cmds = commandsByFunction[fn.id] ?? [];
      const items = cmds.map((cmd, index) => {
        const origin = {
          x: layout.funcOrigin(fn.id).x + layout.posOf(fn.id, cmd, index).x,
          y: layout.funcOrigin(fn.id).y + layout.posOf(fn.id, cmd, index).y,
        };
        const size = sizes.get(`${fn.id}:${cmd.id}`) ?? { w: 216, h: 104 };
        return {
          id: cmd.id,
          rect: { x: origin.x, y: origin.y, w: size.w, h: size.h },
        };
      });
      culledBlocks += filterVisibleBlocks(items, viewport, VIEW_OVERSCAN, pinnedBlocks).culled;
    }
    return culledBlocks;
  }, [functions, commandsByFunction, layout, sizes, viewport, pinnedBlocks]);
}