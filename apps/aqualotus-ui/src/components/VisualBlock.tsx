import { memo, type ReactElement } from "react";
import type { CommandSummary } from "../lib/optilotus";
import { commandMainLine } from "../lib/program";
import type { Pos } from "../lib/layout";

interface VisualBlockProps {
  readonly command: CommandSummary;
  readonly fid: number;
  readonly functionName: string;
  readonly index: number;
  readonly position: Pos;
  readonly selected: boolean;
  readonly failed: boolean;
  readonly connectFrom: boolean;
  readonly interactive: boolean;
}

/**
 * One hand-drawn node. Purely presentational: geometry comes from the
 * layout map (relative to its function container), semantics from the
 * Optilotus projection. Exactly two ports: left (in) and right (out),
 * so chains run left → right like the reference sketch.
 *
 * Declare blocks use the reference palette: red `var: name`, green
 * `type:` / `value:` lines. Other kinds render their engine content in
 * light ink. Blocks in the non-selected function are preview-only.
 *
 * Memoized (Issue 9): a block re-renders only when its own props change,
 * so edits/selection elsewhere do not rebuild the whole canvas tree.
 */
function VisualBlock(props: VisualBlockProps): ReactElement {
  const {
    command,
    fid,
    functionName,
    index,
    position,
    selected,
    failed,
    connectFrom,
    interactive,
  } = props;
  return (
    <div
      id={`vblock-${fid}-${command.id}`}
      data-block-id={command.id}
      data-fid={fid}
      className="vblock"
      data-kind={command.kind}
      data-selected={selected}
      data-error={failed}
      data-connect-from={connectFrom}
      data-interactive={interactive}
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-pressed={selected}
      aria-label={`${command.kind} block ${index + 1} in ${functionName}: ${commandMainLine(command)}`}
      style={{ left: position.x, top: position.y }}
    >
      <span className="vport vport-left" data-port="in" aria-hidden="true" />
      {command.kind === "declare" ? (
        <>
          <span className="vblock-var">var: {command.var ?? "?"}</span>
          <span className="vblock-type">type: {command.ty ?? "?"}</span>
          <span className="vblock-type">
            value:{" "}
            {command.expr !== undefined && command.expr !== ""
              ? command.expr
              : "—"}
          </span>
        </>
      ) : (
        <>
          <span className="vblock-kind">{command.kind}</span>
          <span className="vblock-main">{commandMainLine(command)}</span>
        </>
      )}
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
        data-fid={fid}
        aria-hidden="true"
      />
    </div>
  );
}

export default memo(VisualBlock);
