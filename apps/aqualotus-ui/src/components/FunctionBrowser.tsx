import { useState, type ReactElement } from "react";
import type { FunctionId, FunctionSummary } from "../lib/optilotus";
import { useExitItems } from "../hooks/useExitItems";

interface FunctionBrowserProps {
  readonly functions: readonly FunctionSummary[];
  readonly selectedId: FunctionId | null;
  readonly busy: boolean;
  readonly onSelect: (id: FunctionId) => void;
  readonly onDelete: (id: FunctionId) => void;
  readonly onRename?: (id: FunctionId, name: string) => void;
}

/**
 * Block navigator: one row per function container on the canvas.
 * Identity is the stable FunctionId; `isMain` marks the entry function
 * without affecting semantics. New functions are created from the
 * Library's Function block (the bridge `createFunction` path), so this
 * list has no creation form — select, jump, delete only. Renaming
 * (pencil → inline input) goes through the bridge `renameFunction`
 * path and keeps the stable id.
 */
export default function FunctionBrowser(
  props: FunctionBrowserProps,
): ReactElement {
  const { functions, selectedId, busy, onSelect, onDelete, onRename } = props;
  const [editingId, setEditingId] = useState<FunctionId | null>(null);
  const [draft, setDraft] = useState<string>("");
  // A deleted function keeps its row for one exit animation: the list
  // change already happened, the row only finishes leaving.
  const exiting = useExitItems(functions, (fn) => String(fn.id));

  function commitRename(id: FunctionId): void {
    if (onRename === undefined) return;
    onRename(id, draft);
    setEditingId(null);
  }

  return (
    <div>
      <ul className="fn-list" aria-label="Blocks">
        {functions.map((fn) => (
          <li key={fn.id}>
            {editingId === fn.id ? (
              <form
                aria-label={`Rename ${fn.name}`}
                style={{ display: "flex", gap: 4 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  commitRename(fn.id);
                }}
              >
                <input
                  aria-label="New function name"
                  className="glass-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoComplete="off"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={busy || draft.trim() === ""}
                >
                  ✓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditingId(null)}
                  aria-label="Cancel rename"
                >
                  ✕
                </button>
              </form>
            ) : (
              <div className="fn-row">
                <button
                  type="button"
                  className="fn-item"
                  data-main={fn.isMain}
                  aria-current={fn.id === selectedId}
                  aria-label={`Select function ${fn.name}`}
                  onClick={() => onSelect(fn.id)}
                >
                  <span className="fn-dot" aria-hidden="true" />
                  <span className="fn-name">{fn.name}</span>
                  {fn.isMain ? (
                    <span className="main-badge">MAIN</span>
                  ) : null}
                </button>
                {onRename !== undefined ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm fn-rename"
                    disabled={busy}
                    onClick={() => {
                      setDraft(fn.name);
                      setEditingId(fn.id);
                    }}
                    title={`Rename ${fn.name}`}
                    aria-label={`Rename ${fn.name}`}
                  >
                    ✎
                  </button>
                ) : null}
              </div>
            )}
          </li>
        ))}
        {exiting.map((ghost) => (
          <li key={`exit-${ghost.key}`} aria-hidden="true">
            <div className="fn-row" data-exiting="true">
              <div className="fn-item" data-main={ghost.item.isMain}>
                <span className="fn-dot" aria-hidden="true" />
                <span className="fn-name">{ghost.item.name}</span>
                {ghost.item.isMain ? (
                  <span className="main-badge">MAIN</span>
                ) : null}
              </div>
            </div>
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
