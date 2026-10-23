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
  /**
   * The block runs inside an `if`'s branch (the engine's branch lists).
   * Members carry the vertical pair — a top in-port (the branch enters
   * where its body starts) and a bottom out-port (column links run
   * downward) — beside their ordinary left-in / right-out ports.
   * `undefined` for blocks outside any branch.
   */
  readonly branchMember?: "then" | "else";
  /**
   * The condition expression the engine reports for this `if`
   * (`if_condition` — the summary's own `condition` field is a hidden
   * value id). `null`/`undefined` falls back to the engine summary's
   * raw line; nothing is invented here — the canvas shows whatever the
   * engine can recover, or the raw id.
   */
  readonly conditionText?: string | null;
  /** The block left the model and is only playing its exit animation. */
  readonly exiting?: boolean;
}

/**
 * One hand-drawn node. Purely presentational: geometry comes from the
 * layout map (relative to its function container), semantics from the
 * Optilotus projection. Port presence follows the flow the block really
 * carries:
 *
 * - an ordinary block carries exactly two ports (left in, right out) —
 *   chains read left → right;
 * - a branch member adds the vertical pair (top in, bottom out) beside
 *   its side pair — the body's columns read top → bottom;
 * - the `if` card carries exactly three: a left in-port (the chain
 *   feeding it), and the TRUE/FALSE pair on its bottom edge (30%/70%
 *   width). No right out: the card's continuation draws through its
 *   branch tails' merge rails (join off) or the manual "End of If
 *   Block" join point's own wire (join on) — never straight out of the
 *   card.
 *
 * The fractions pair with `BRANCH_PORT_FRACTION` in src/lib/graph.ts;
 * the offsets centre the circles on the block borders (P3/P17), which
 * src/index.css mirrors so edges anchor exactly on the visible dots.
 * Blocks in the non-selected function are preview-only.
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
    branchMember,
    conditionText = null,
    exiting = false,
  } = props;
  const casting = command.casting;
  const showCasting = castingIndicatorVisible(command);
  const isIf = command.kind === "if";
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
      {/* Every block shares the left in-port: the chain feeds it here,
        * including the `if` card (its condition runs off that wire). */}
      <span className="vport vport-left" data-port="in" aria-hidden="true" />
      {branchMember !== undefined && !isIf ? (
        // Vertical member pair: the branch enters the body's top and
        // column links leave through the body's bottom edge.
        <>
          <span className="vport vport-top" data-port="in" aria-hidden="true" />
          <span
            className="vport vport-out-bottom"
            data-port="out"
            data-side="bottom"
            data-block-id={command.id}
            data-fid={fid}
            aria-hidden="true"
            title="branch flow"
          />
        </>
      ) : null}
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
          <span className="vblock-main">
            {command.kind === "if" && conditionText !== null && conditionText !== ""
              ? `if ${conditionText}`
              : commandMainLine(command)}
          </span>
        </>
      )}
      {failed ? (
        <span className="vblock-error" role="alert">
          Error reported here
        </span>
      ) : null}
      {isIf ? (
        <>
          {/* Vertical If/Else: the two branch ports sit on the card's
            * bottom edge at 30%/70% width — branching downward into the
            * TRUE/FALSE body containers. The fractions must match
            * `BRANCH_PORT_FRACTION` in src/lib/graph.ts. */}
          <span
            className="vport vport-bottom vport-then"
            data-port="out"
            data-side="then"
            data-block-id={command.id}
            data-fid={fid}
            aria-hidden="true"
            title="true branch"
          />
          <span className="vport-label vport-label-then">true</span>
          <span
            className="vport vport-bottom vport-else"
            data-port="out"
            data-side="else"
            data-block-id={command.id}
            data-fid={fid}
            aria-hidden="true"
            title="false branch"
          />
          <span className="vport-label vport-label-else">false</span>
        </>
      ) : null}
      {/* The right out-port every block except the `if` card carries.
        * An `if`'s continuation is drawn through its branch tails'
        * merge rails (join off) or the manual "End of If Block" join
        * point's own wire (join on) — never straight out of the card. */}
      {isIf ? null : (
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
