import type { ReactElement } from "react";
import type { FunctionId, FunctionSummary } from "../lib/optilotus";

interface FunctionBrowserProps {
  readonly functions: readonly FunctionSummary[];
  readonly selectedId: FunctionId | null;
  readonly busy: boolean;
  readonly onSelect: (id: FunctionId) => void;
  readonly onDelete: (id: FunctionId) => void;
}

/**
 * Block navigator: one row per function container on the canvas.
 * Identity is the stable FunctionId; `isMain` marks the entry function
 * without affecting semantics. New functions are created from the
 * Library's Function block (the bridge `createFunction` path), so this
 * list has no creation form — select, jump, delete only.
 */
export default function FunctionBrowser(
  props: FunctionBrowserProps,
): ReactElement {
  const { functions, selectedId, busy, onSelect, onDelete } = props;

  return (
    <div>
      <ul className="fn-list" aria-label="Blocks">
        {functions.map((fn) => (
          <li key={fn.id}>
            <button
              type="button"
              className="fn-item"
              data-main={fn.isMain}
              aria-current={fn.id === selectedId}
              onClick={() => onSelect(fn.id)}
            >
              <span className="fn-dot" aria-hidden="true" />
              <span className="fn-name">{fn.name}</span>
              {fn.isMain ? (
                <span className="main-badge">MAIN</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {functions.length === 0 ? (
        <div className="empty">
          <strong>No blocks</strong>
          <span>Create a function from the Library to start.</span>
        </div>
      ) : null}
      {selectedId !== null &&
      functions.some((f) => f.id === selectedId && !f.isMain) ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-danger"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => onDelete(selectedId)}
        >
          Delete selected function
        </button>
      ) : null}
    </div>
  );
}
