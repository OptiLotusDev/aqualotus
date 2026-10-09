import type { ReactElement, ReactNode } from "react";
import { PRESENTATION_STRUCT_NAME } from "../lib/workspace";

interface StructContainerProps {
  readonly children: ReactNode;
  readonly width: number;
  readonly height: number;
}

/**
 * Presentation-only struct grouping (green outline, title above the
 * top edge like the reference). The runtime has no struct API yet, so
 * this container is visual architecture: it groups the package's
 * functions so a future struct layer slots in without a UI rewrite.
 * No inheritance semantics are implemented or implied.
 */
export default function StructContainer(
  props: StructContainerProps,
): ReactElement {
  const { children, width, height } = props;
  return (
    <section
      className="structc"
      aria-label={`Struct ${PRESENTATION_STRUCT_NAME} preview`}
      style={{ width, height }}
    >
      <header className="structc-head">
        <span className="structc-name">{PRESENTATION_STRUCT_NAME}</span>
        <span className="preview-badge" title="Visual grouping only — the runtime has no structs yet">
          Preview
        </span>
      </header>
      <div className="structc-body">{children}</div>
    </section>
  );
}
