import { useState, type ReactElement } from "react";
import type { FunctionId, FunctionSummary } from "../lib/optilotus";

interface FunctionBrowserProps {
  readonly functions: readonly FunctionSummary[];
  readonly selectedId: FunctionId | null;
  readonly busy: boolean;
  readonly onSelect: (id: FunctionId) => void;
  readonly onCreate: (name: string) => void;
  readonly onDelete: (id: FunctionId) => void;
}

/**
 * Project / function navigation. Identity is the stable FunctionId;
 * `isMain` marks the entry function without affecting semantics.
 */
export default function FunctionBrowser(
  props: FunctionBrowserProps,
): ReactElement {
  const { functions, selectedId, busy, onSelect, onCreate, onDelete } = props;
  const [draft, setDraft] = useState<string>("");

  function submit(): void {
    if (draft.trim() === "") return;
    onCreate(draft);
    setDraft("");
  }

  return (
    <div>
      <ul className="fn-list" aria-label="Functions">
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
          <strong>No functions</strong>
          <span>Create one to start building.</span>
        </div>
      ) : null}
      <form
        className="field"
        style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span>
          <label htmlFor="fn-name">New function</label>
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="fn-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="helper"
            autoComplete="off"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            type="submit"
            className="btn btn-sm"
            disabled={busy || draft.trim() === ""}
          >
            Add
          </button>
        </div>
      </form>
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
