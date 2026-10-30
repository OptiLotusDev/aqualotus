/**
 * Canvas blocks: rendering visible blocks, exiting blocks, and empty
 * function content. Passes interaction properties to VisualBlock.
 */

import type { ReactElement } from "react";
import type { CommandSummary } from "../../lib/optilotus";
import type { Pos } from "../../lib/layout";
import VisualBlock from "../VisualBlock";

interface VisibleCmd {
  readonly cmd: CommandSummary;
  readonly index: number;
}

interface ExitingGhost {
  readonly item: { readonly fid: number; readonly cmd: CommandSummary; readonly index: number };
  readonly key: string;
}

interface CanvasBlocksProps {
  readonly fid: number;
  readonly fn: { readonly id: number; readonly name: string; readonly isMain: boolean };
  readonly cmds: readonly CommandSummary[];
  readonly visibleCmds: readonly VisibleCmd[];
  readonly exitingBlocks: readonly ExitingGhost[];
  readonly selectedCommandId: number | null;
  readonly selectedFunctionId: number | null;
  readonly errorId: number | null;
  readonly errorFunctionId: number | null;
  readonly conditionTextFor?: (fid: number, ifId: number) => string | null;
  readonly blockPositions: ReadonlyMap<string, Pos>;
  readonly dragEffectivePos: (fid: number, cmd: CommandSummary, index: number) => Pos;
  readonly memberSideOf: (fid: number, id: number) => "then" | "else" | undefined;
  readonly onRequestLibrary: () => void;
}

export default function CanvasBlocks(
  props: CanvasBlocksProps,
): ReactElement {
  const {
    fid,
    fn,
    cmds,
    visibleCmds: visible,
    exitingBlocks: exiting,
    selectedCommandId,
    selectedFunctionId,
    errorId,
    errorFunctionId,
    conditionTextFor,
    blockPositions,
    dragEffectivePos,
    memberSideOf,
    onRequestLibrary,
  } = props;

  return (
    <>
      {visible.map(({ cmd, index }) => {
        return (
          <div
            key={cmd.id}
            ref={(el) => {
              if (el !== null) {
                const inner = el.querySelector(".vblock");
                if (inner instanceof HTMLDivElement) {
                  // ref callback is used by parent for blockEls map
                }
              }
            }}
          >
            <VisualBlock
              command={cmd}
              fid={fid}
              functionName={fn.name}
              index={index}
              position={dragEffectivePos(fid, cmd, index)}
              selected={cmd.id === selectedCommandId && fid === selectedFunctionId}
              failed={cmd.id === errorId && (errorFunctionId === null || fid === errorFunctionId)}
              connectFrom={false}
              conditionText={
                cmd.kind === "if" && conditionTextFor !== undefined
                  ? conditionTextFor(fid, cmd.id)
                  : undefined
              }
              branchMember={memberSideOf(fid, cmd.id)}
              interactive={fid === selectedFunctionId}
            />
          </div>
        );
      })}
      {exiting
        .filter((ghost) => ghost.item.fid === fid)
        .map((ghost) => {
          const cmd = ghost.item.cmd;
          const key = `${ghost.item.fid}:${cmd.id}`;
          return (
            <div key={`exit-${key}`}>
              <VisualBlock
                command={cmd}
                fid={ghost.item.fid}
                functionName={fn.name}
                index={ghost.item.index}
                position={
                  blockPositions.get(key) ??
                  { x: 48, y: 36 + ghost.item.index * 264 }
                }
                selected={false}
                failed={false}
                connectFrom={false}
                conditionText={
                  cmd.kind === "if" && conditionTextFor !== undefined
                    ? conditionTextFor(ghost.item.fid, cmd.id)
                    : undefined
                }
                branchMember={memberSideOf(ghost.item.fid, cmd.id)}
                interactive={false}
                exiting
              />
            </div>
          );
        })}
      {cmds.length === 0 ? (
        <div className="funcc-empty">
          <strong>No blocks yet</strong>
          <span>
            {fid === selectedFunctionId
              ? "Drag a block from the library to start building this function."
              : "Select this function, then add blocks."}
          </span>
          {fid === selectedFunctionId ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onRequestLibrary}
            >
              Open block library
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
