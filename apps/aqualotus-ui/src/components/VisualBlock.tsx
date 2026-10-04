import type { ReactElement } from "react";
import type { CommandSummary } from "../lib/optilotus";
import { commandMainLine, commandSubLine } from "../lib/program";
import type { Pos } from "../lib/layout";

interface VisualBlockProps {
  readonly command: CommandSummary;
  readonly index: number;
  readonly position: Pos;
  readonly selected: boolean;
  readonly failed: boolean;
  readonly connectFrom: boolean;
}

/**
 * One visual node. Purely presentational: geometry comes from the
 * layout map, semantics from the Optilotus projection. Ports are
 * visual anchors at top-center (in) and bottom-center (out).
 */
export default function VisualBlock(props: VisualBlockProps): ReactElement {
  const { command, index, position, selected, failed, connectFrom } = props;
  return (
    <div
      id={`vblock-${command.id}`}
      data-block-id={command.id}
      className="vblock"
      data-kind={command.kind}
      data-selected={selected}
      data-error={failed}
      data-connect-from={connectFrom}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${command.kind} block ${index + 1}: ${commandMainLine(command)}`}
      style={{ left: position.x, top: position.y }}
    >
      <span className="vport vport-top" data-port="in" aria-hidden="true" />
      <span className="vport vport-left" data-port="in" aria-hidden="true" />
      <span className="vblock-kind">
        {index + 1} · {command.kind}
      </span>
      <span className="vblock-main">{commandMainLine(command)}</span>
      <span className="vblock-sub">{commandSubLine(command)}</span>
      {failed ? (
        <span className="vblock-error" role="alert">
          Error reported here
        </span>
      ) : null}
      <span
        className="vport vport-right"
        data-port="out"
        data-side="right"
        data-block-id={command.id}
        aria-hidden="true"
      />
      <span
        className="vport vport-bottom"
        data-port="out"
        data-side="bottom"
        data-block-id={command.id}
        aria-hidden="true"
      />
    </div>
  );
}
