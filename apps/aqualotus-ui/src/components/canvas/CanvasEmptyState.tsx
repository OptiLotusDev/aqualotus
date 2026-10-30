/**
 * Canvas empty state: shown when there are no functions. Preserves the
 * existing animation and actions exactly.
 */

import type { ReactElement } from "react";
import RevealText from "../RevealText";
import { breadcrumbPath } from "../../lib/workspace";

interface CanvasEmptyStateProps {
  readonly selectedFunc: { readonly name: string | null } | null;
  readonly onRequestLibrary: () => void;
}

export default function CanvasEmptyState(
  props: CanvasEmptyStateProps,
): ReactElement {
  const { selectedFunc, onRequestLibrary } = props;
  return (
    <div className="canvas-empty enter-up enter-delay-heading">
      <strong>No blocks yet</strong>
      <span>
        <RevealText
          text={`Drag a block from the library to start building ${breadcrumbPath(selectedFunc?.name ?? null)}.`}
          delay={700}
          stagger={28}
        />
      </span>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onRequestLibrary}
      >
        Open block library
      </button>
    </div>
  );
}
