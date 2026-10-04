import { useEffect, useState, type ReactElement } from "react";
import type { CommandId, CommandSummary } from "../lib/optilotus";
import type { FunctionInfo } from "../lib/optilotus";
import { optilotus_type, type OptilotusType } from "../lib/optilotus";
import { summaryToDraft, type CommandDraft } from "../lib/program";

interface InspectorProps {
  readonly func: (FunctionInfo & { status: "ok" }) | null;
  readonly selected: CommandSummary | null;
  readonly busy: boolean;
  readonly onReplace: (id: CommandId, draft: CommandDraft) => void;
  readonly onDeleteBlock: (id: CommandId) => void;
  readonly onDeleteFunction: () => void;
}

const TYPES: readonly OptilotusType[] = [
  optilotus_type.int32,
  optilotus_type.int64,
  optilotus_type.float64,
  optilotus_type.bool,
  optilotus_type.string,
];

function KindFields(props: {
  draft: CommandDraft;
  onChange: (next: CommandDraft) => void;
}): ReactElement {
  const { draft, onChange } = props;
  switch (draft.kind) {
    case "declare":
      return (
        <>
          <div className="field">
            <span>
              <label htmlFor="in-name">Name</label>
            </span>
            <input
              id="in-name"
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              placeholder="n"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <span>
              <label htmlFor="in-type">Type</label>
            </span>
            <select
              id="in-type"
              value={draft.ty}
              onChange={(e) =>
                onChange({ ...draft, ty: e.target.value as OptilotusType })
              }
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>
              <label htmlFor="in-value">Value</label>
            </span>
            <input
              id="in-value"
              value={draft.init}
              onChange={(e) => onChange({ ...draft, init: e.target.value })}
              placeholder="41"
              autoComplete="off"
            />
          </div>
        </>
      );
    case "assign":
      return (
        <>
          <div className="field">
            <span>
              <label htmlFor="in-name">Name</label>
            </span>
            <input
              id="in-name"
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              placeholder="n"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <span>
              <label htmlFor="in-value">Value</label>
            </span>
            <input
              id="in-value"
              value={draft.expr}
              onChange={(e) => onChange({ ...draft, expr: e.target.value })}
              placeholder="{n} + 1"
              autoComplete="off"
            />
          </div>
        </>
      );
    case "print":
      return (
        <div className="field">
          <span>
            <label htmlFor="in-value">Value</label>
          </span>
          <input
            id="in-value"
            value={draft.template}
            onChange={(e) => onChange({ ...draft, template: e.target.value })}
            placeholder='"{n}"'
            autoComplete="off"
          />
        </div>
      );
    case "return":
      return (
        <div className="field">
          <span>
            <label htmlFor="in-value">Expression / Value</label>
          </span>
          <input
            id="in-value"
            value={draft.expr}
            onChange={(e) => onChange({ ...draft, expr: e.target.value })}
            placeholder="{n}"
            autoComplete="off"
          />
        </div>
      );
  }
}

/**
 * Contextual block inspector (evolved from the command editor). Shows
 * function properties when nothing is selected, per-kind block
 * properties when a block is selected. Edits replace the command
 * (delete + recreate, spliced into position) since the bridge offers
 * no in-place update; deletes call the existing bridge mutation.
 */
export default function Inspector(props: InspectorProps): ReactElement {
  const { func, selected, busy, onReplace, onDeleteBlock, onDeleteFunction } =
    props;
  const [edit, setEdit] = useState<CommandDraft | null>(null);

  useEffect(() => {
    setEdit(selected === null ? null : summaryToDraft(selected));
  }, [selected]);

  if (selected !== null && edit !== null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="pane-title">
          {selected.kind} · #{selected.id}
        </div>
        <form
          aria-label="Edit selected block"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            onReplace(selected.id, edit);
          }}
        >
          <KindFields draft={edit} onChange={setEdit} />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Apply edit
          </button>
        </form>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={() => onDeleteBlock(selected.id)}
        >
          Delete Block
        </button>
      </div>
    );
  }

  if (func !== null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="pane-title">
          {func.name}
          {func.isMain ? " · MAIN" : ""}
        </div>
        <dl className="props">
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
            <dd>{func.isMain ? "Yes — Run executes main()" : "No"}</dd>
          </div>
        </dl>
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

  return (
    <div className="empty">
      <strong>Inspector</strong>
      <span>Select a block to inspect its properties.</span>
    </div>
  );
}
