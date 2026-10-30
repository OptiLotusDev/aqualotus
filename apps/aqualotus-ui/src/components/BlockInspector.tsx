/**
 * Block editor view: renders per-kind form fields for the selected
 * command, with casting controls, merge toggle, and delete action.
 *
 * Extracted from `Inspector.tsx`.
 */

import { useState, type ReactElement } from "react";
import type { CommandId, CommandSummary } from "../lib/optilotus";
import {
  castingIncomplete,
  declaredTypeOf,
} from "../lib/casting";
import {
  summaryToDraft,
  validateDeclareValue,
  type CommandDraft,
} from "../lib/program";
import {
  PACKAGE_NAME,
  PRESENTATION_STRUCT_NAME,
  breadcrumbPath,
} from "../lib/workspace";
import { KindFields } from "./Inspector";

interface BlockInspectorProps {
  readonly func: (import("../lib/optilotus").FunctionInfo & {
    status: "ok";
  }) | null;
  readonly selected: CommandSummary;
  readonly busy: boolean;
  readonly recoveryVar?: string | null;
  readonly onReplace: (id: CommandId, draft: CommandDraft) => void;
  readonly onDeleteBlock: (id: CommandId) => void;
  readonly onDeclareVariable?: (name: string) => void;
  readonly onConditionText?: (ifId: CommandId) => string | null;
  readonly commands?: readonly CommandSummary[];
  readonly merge?: {
    readonly on: boolean;
    readonly onToggle: (on: boolean) => void;
  };
}

export function BlockInspector(props: BlockInspectorProps): ReactElement {
  const {
    func,
    selected,
    busy,
    recoveryVar,
    onReplace,
    onDeleteBlock,
    onDeclareVariable,
    onConditionText,
    commands,
    merge,
  } = props;

  const initDraft = (sel: CommandSummary): CommandDraft => {
    const draft = summaryToDraft(sel);
    if (draft.kind === "if" && onConditionText !== undefined) {
      const text = onConditionText(sel.id);
      if (text !== null) draft.condition = text;
    }
    return draft;
  };

  const [edit, setEdit] = useState<CommandDraft>(() => initDraft(selected));
  const [editFor, setEditFor] = useState<CommandId | null>(selected.id);
  if (selected.id !== editFor) {
    setEditFor(selected.id);
    setEdit(initDraft(selected));
  }

  const casting =
    edit.kind === "assign" ? edit.casting : undefined;
  const castIncomplete =
    edit.kind === "assign" && castingIncomplete(casting);
  const destinationType =
    edit.kind === "assign"
      ? (declaredTypeOf(commands ?? [], edit.name) ??
        ((selected.var ?? "").trim() === edit.name.trim()
          ? selected.ty
          : undefined))
      : undefined;
  const editBlocked =
    castIncomplete ||
    edit.kind === "cast" ||
    (edit.kind === "declare" &&
      validateDeclareValue(edit.ty, edit.init) !== null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="pane-title">Inspector</div>
      {recoveryVar !== null &&
      recoveryVar !== undefined &&
      recoveryVar !== "" &&
      onDeclareVariable !== undefined ? (
        <div className="notice notice-error" role="alert">
          <div className="notice-title">Undeclared variable</div>
          <div>
            Variable &ldquo;{recoveryVar}&rdquo; is not declared yet. The
            block was kept — declare it first, then retry.
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={() => onDeclareVariable(recoveryVar)}
          >
            Declare &ldquo;{recoveryVar}&rdquo; (int32)
          </button>
        </div>
      ) : null}
      {castIncomplete ? (
        <div className="notice notice-error" role="alert">
          <div className="notice-title">Incomplete casting</div>
          <div data-testid="cast-incomplete">
            Select a target type to complete casting.
          </div>
        </div>
      ) : null}
      {edit.kind === "cast" ? (
        <div className="notice notice-error" role="alert">
          <div className="notice-title">
            Engine cast is not editable in place
          </div>
          <div data-testid="cast-edit-blocked">
            The block runs from a hidden conversion compute the engine
            does not expose, so the editor cannot re-link it after a
            rebuild. Delete the block and add an assignment with casting
            instead (the public conversion flow).
          </div>
        </div>
      ) : null}
      <div className="insp-path" title="Package / Struct / Function">
        {breadcrumbPath(func?.name ?? null)}
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
          <dd>{func?.name ?? "—"}</dd>
        </div>
      </dl>
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
        <KindFields
          draft={edit}
          onChange={setEdit}
          destinationType={destinationType}
          takenNames={(commands ?? []).flatMap((c) =>
            c.var === undefined ? [] : [c.var],
          )}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || editBlocked}
          title={
            editBlocked
              ? "Fix the highlighted error first (see above)"
              : undefined
          }
        >
          Apply edit
        </button>
      </form>
      {selected.kind === "if" && merge !== undefined ? (
        <div className="field" data-testid={`merge-controls-${selected.id}`}>
          <button
            type="button"
            className={`btn ${merge.on ? "btn-ghost" : "btn-primary"} btn-sm`}
            disabled={busy}
            aria-pressed={merge.on}
            data-testid="merge-toggle"
            onClick={() => merge.onToggle(!merge.on)}
          >
            {merge.on ? "Unmerge branches" : "Merge branches"}
          </button>
          <div className="hint">
            {merge.on
              ? "Both branches flow through the visible “End of If Block” point before the next block. Drag that point to move it."
              : "Draw one visible join point the TRUE and FALSE branches both reconnect at. Unmerging detaches the block after the If — it stays on canvas, ready to re-wire."}
          </div>
        </div>
      ) : null}
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
