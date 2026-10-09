import type { ReactElement, ReactNode } from "react";
import type { FunctionSummary } from "../lib/optilotus";

interface FunctionContainerProps {
  readonly func: FunctionSummary;
  readonly selected: boolean;
  readonly blockCount: number;
  readonly width: number;
  readonly height: number;
  readonly position: { x: number; y: number };
  readonly children: ReactNode;
  readonly onSelect: () => void;
}

/**
 * Real visual owner of a runtime function (blue outline, tiny title
 * above the top edge like the reference). Blocks render inside; the
 * container auto-sizes from its blocks (width/height props). Click /
 * keyboard on the header selects the function.
 */
export default function FunctionContainer(
  props: FunctionContainerProps,
): ReactElement {
  const { func, selected, blockCount, width, height, position, children, onSelect } =
    props;
  return (
    <section
      id={`func-${func.id}`}
      className="funcc"
      data-selected={selected}
      aria-label={`Function ${func.name}`}
      style={{ left: position.x, top: position.y, width, height }}
    >
      <header
        className="funcc-head"
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="funcc-name">
          {func.name}
          <span className="fn-call">()</span>
        </span>
        {func.isMain ? <span className="main-badge">MAIN</span> : null}
        <span className="cmd-count">
          {blockCount} {blockCount === 1 ? "block" : "blocks"}
        </span>
      </header>
      <div className="funcc-body">{children}</div>
    </section>
  );
}
