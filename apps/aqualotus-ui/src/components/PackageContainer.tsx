import type { ReactElement, ReactNode } from "react";
import { PACKAGE_NAME } from "../lib/workspace";

interface PackageContainerProps {
  readonly children: ReactNode;
  readonly functionCount: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Outermost sketch container (white outline, title centered above the
 * top edge like the reference). Presentation-only grouping: the single
 * runtime package is always `app`; this owns no semantics.
 */
export default function PackageContainer(
  props: PackageContainerProps,
): ReactElement {
  const { children, functionCount, width, height } = props;
  return (
    <section
      className="pkg"
      aria-label={`Package ${PACKAGE_NAME}`}
      style={{ width, height }}
    >
      <header className="pkg-head">
        <span className="pkg-name">{PACKAGE_NAME}</span>
        <span className="pkg-meta">
          {functionCount} {functionCount === 1 ? "function" : "functions"}
        </span>
      </header>
      <div className="pkg-body">{children}</div>
    </section>
  );
}
