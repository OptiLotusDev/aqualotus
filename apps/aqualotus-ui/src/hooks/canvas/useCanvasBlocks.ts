/**
 * Canvas blocks: computes live blocks, their positions, and exiting blocks.
 * Pure over explicit inputs.
 */

import { useMemo, useRef } from "react";
import { useExitItems } from "../../hooks/useExitItems";
import type { CommandSummary } from "../../lib/optilotus";
import type { Pos } from "../../lib/layout";

interface UseCanvasBlocksArgs {
  readonly functions: readonly { readonly id: number }[];
  readonly commandsByFunction: Readonly<Record<number, readonly CommandSummary[]>>;
  readonly dragEffectivePos: (fid: number, cmd: CommandSummary, index: number) => Pos;
}

interface LiveBlock {
  readonly fid: number;
  readonly cmd: CommandSummary;
  readonly index: number;
}

export function useCanvasBlocks(args: UseCanvasBlocksArgs): {
  readonly liveBlocks: readonly LiveBlock[];
  readonly blockPos: ReadonlyMap<string, Pos>;
  readonly exitingBlocks: readonly { readonly key: string; readonly item: LiveBlock }[];
} {
  const { functions, commandsByFunction, dragEffectivePos } = args;

  const liveBlocks = useMemo<LiveBlock[]>(
    () =>
      functions.flatMap((fn) =>
        (commandsByFunction[fn.id] ?? []).map((cmd, index) => ({
          fid: fn.id,
          cmd,
          index,
        })),
      ),
    [functions, commandsByFunction],
  );

  const blockPos = useRef(new Map<string, Pos>());
  for (const block of liveBlocks) {
    blockPos.current.set(
      `${block.fid}:${block.cmd.id}`,
      dragEffectivePos(block.fid, block.cmd, block.index),
    );
  }

  const exitingBlocks = useExitItems(
    liveBlocks,
    (block) => `${block.fid}:${block.cmd.id}`,
  );

  return { liveBlocks, blockPos: blockPos.current, exitingBlocks };
}