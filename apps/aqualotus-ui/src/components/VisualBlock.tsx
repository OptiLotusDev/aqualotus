import { memo, type ReactElement } from "react";
import { commandMainLine, displayDeclareValue, type UiCommand } from "../lib/program";
import { castingIndicatorVisible } from "../lib/casting";
import type { Pos } from "../lib/layout";

interface VisualBlockProps {
  readonly command: UiCommand;
  readonly fid: number;
  readonly functionName: string;
  readonly index: number;
  readonly position: Pos;
  readonly selected: boolean;
  readonly failed: boolean;
  readonly connectFrom: boolean;
  readonly interactive: boolean;
  /** The block left the model and is only playing its exit animation. */
  readonly exiting?: boolean;
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
    exiting = false,
  } = props;
  const casting = command.casting;
  const showCasting = castingIndicatorVisible(command);
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
      data-exiting={exiting ? "true" : undefined}
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-pressed={selected}
      aria-hidden={exiting ? true : undefined}
      aria-label={`${command.kind} block ${index + 1} in ${functionName}: ${commandMainLine(command)}`}
      style={{ left: position.x, top: position.y }}
    >
      <span className="vport vport-left" data-port="in" aria-hidden="true" />
      {showCasting && casting !== undefined ? (
        <span
          className="vblock-casting"
          data-testid={`casting-enabled-${command.id}`}
          data-casting-assignment={command.id}
          data-casting-target={casting.targetType}
          title={
            command.kind === "cast"
              ? `This cast creates ${casting.tempName} of type ${casting.targetType}`
              : `This assignment converts to ${casting.targetType} before storing`
          }
        >
          <span
            className="vblock-casting-link"
            data-testid={`casting-connector-${command.id}`}
            aria-hidden="true"
          />
          <span className="vblock-casting-label">Casting Enabled</span>
          <span
            className="vblock-casting-type"
            data-testid={`casting-target-type-${command.id}`}
          >
            type: {casting.targetType}
          </span>
        </span>
      ) : null}
      {command.kind === "declare" ? (
        <>
          <span className="vblock-var">var: {command.var ?? "?"}</span>
          <span className="vblock-type">type: {command.ty ?? "?"}</span>
          <span className="vblock-type">
            value: {displayDeclareValue(command.ty, command.expr) || "—"}
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
      {command.kind === "if" ? (
        <>
          <span
            className="vport vport-right vport-then"
            data-port="out"
            data-side="then"
            data-block-id={command.id}
            data-fid={fid}
            aria-hidden="true"
            title="then branch"
          />
          <span className="vport-label vport-label-then">true</span>
          <span
            className="vport vport-right vport-else"
            data-port="out"
            data-side="else"
            data-block-id={command.id}
            data-fid={fid}
            aria-hidden="true"
            title="else branch"
          />
          <span className="vport-label vport-label-else">false</span>
        </>
      ) : (
        <span
          className="vport vport-right"
          data-port="out"
          data-side="right"
          data-block-id={command.id}
          data-fid={fid}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export default memo(VisualBlock);
