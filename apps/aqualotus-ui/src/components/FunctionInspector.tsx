/**
 * Function inspector view: renders function-level properties (name,
 * block count, entry point) plus rename and delete actions when no
 * block is selected.
 *
 * Extracted from `Inspector.tsx`.
 */

import type { ReactElement } from "react";
import type { FunctionInfo } from "../lib/optilotus";
import { PACKAGE_NAME, PRESENTATION_STRUCT_NAME, breadcrumbPath } from "../lib/workspace";
import { FunctionRenameForm } from "./Inspector";

interface FunctionInspectorProps {
  readonly func: FunctionInfo & { status: "ok" };
  readonly entry: number | null;
  readonly busy: boolean;
  readonly onClearEntry: () => void;
  readonly onDeleteFunction: () => void;
  readonly onRenameFunction?: (name: string) => void;
}

export function FunctionInspector(props: FunctionInspectorProps): ReactElement {
  const { func, entry, busy, onClearEntry, onDeleteFunction, onRenameFunction } =
    props;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="pane-title">Inspector</div>
      <div className="insp-path" title="Package / Struct / Function">
        {breadcrumbPath(func.name)}
      </div>
      <dl className="props">
        <div>
          <dt>Package</dt>
          <dd>{PACKAGE_NAME}</dd>
        </div>
        <div>
          <dt>Struct</dt>
          <dd>{PRESENTATION_STRUCT_NAME} · preview</dd>
        </div>
        <div>
          <dt>Function</dt>
          <dd>{func.name}</dd>
        </div>
        <div>
          <dt>Blocks</dt>
          <dd>{func.commandCount}</dd>
        </div>
        <div>
          <dt>Entry point</dt>
          <dd>
            {entry === null
              ? "Cleared — run is a no-op"
              : func.isMain
                ? `Yes — starts at #${entry}`
                : `Starts at #${entry}`}
          </dd>
        </div>
      </dl>
      {onRenameFunction !== undefined ? (
        <FunctionRenameForm
          key={func.id}
          name={func.name}
          busy={busy}
          onRename={onRenameFunction}
        />
      ) : null}
      {entry !== null ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-danger"
          disabled={busy}
          onClick={onClearEntry}
          title="Detach the entry head; commands are kept as orphans and runs become a no-op"
        >
          Clear entry point
        </button>
      ) : null}
      {!func.isMain ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-danger"
          disabled={busy}
          onClick={onDeleteFunction}
        >
          Delete function
        </button>
      ) : null}
    </div>
  );
}
