import { useState, type ReactElement } from "react";
import type { Access, CommandId, CommandSummary } from "../lib/optilotus";
import type { FunctionInfo } from "../lib/optilotus";
import { optilotus_type, type OptilotusType } from "../lib/optilotus";
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

interface InspectorProps {
  readonly func: (FunctionInfo & { status: "ok" }) | null;
  readonly selected: CommandSummary | null;
  readonly busy: boolean;
  /** Recovery hint: attempted undeclared variable name, if any. */
  readonly recoveryVar?: string | null;
  readonly onReplace: (id: CommandId, draft: CommandDraft) => void;
  readonly onDeleteBlock: (id: CommandId) => void;
  readonly onDeleteFunction: () => void;
  readonly onClearEntry: () => void;
  readonly onDeclareVariable?: (name: string) => void;
  readonly onRenameFunction?: (name: string) => void;
}

/**
 * Every scalar tag the engine accepts in `declare` (`optilotus_type`
 * minus `void`, which the engine always rejects at creation with
 * "cannot declare a variable of type void"). Derived from the bridge so
 * the list can never drift behind `docs/api.md`. The bridge still
 * validates each declare (unknown tags, duplicates, bad literals);
 * failures surface as typed errors.
 */
const TYPES: readonly OptilotusType[] = (
  Object.values(optilotus_type) as OptilotusType[]
).filter((t) => t !== optilotus_type.void);

/** Access modifiers offered for a variable declaration. */
const ACCESS_LEVELS: readonly Access[] = ["private", "protected", "public"];

/**
 * Explain what the selected modifier means *today*.
 *
 * The language has one package and no classes, so `public` and
 * `protected` are currently equivalent and `private` matches the
 * runtime's existing per-call variable scope. Saying so plainly is
 * better than implying an enforcement that does not exist yet.
 */
function accessHint(access: Access): string {
  switch (access) {
    case "public":
      return "Visible to every package. Currently the same as protected: only one package exists.";
    case "protected":
      return "Visible within this package. Currently the same as public: all functions are in one package.";
    case "private":
      return "Visible only inside the function that declares it (the default).";
  }
}

/**
 * Exhaustiveness guard for the per-kind editor. A new `CommandDraft`
 * kind must get an editor here; reaching this means one was added
 * without UI, so fail loudly instead of rendering nothing.
 */
function assertNeverKind(draft: never): never {
  throw new Error(
    `Unhandled draft kind in inspector: ${String((draft as { kind?: string }).kind)}`,
  );
}

/**
 * Per-type value demo for the declare editor (P17: UI vocabulary only).
 * Each entry shows the exact literal shape the Optilotus engine parses
 * for that type — the bridge still validates, this only teaches it.
 * Notably: integers/floats take bare numbers (no quotes), `bool` is
 * lowercase-only (`true`/`false`), `char` is one bare character, and
 * `string` is raw text (typed quotes become part of the string).
 */
function declareValueHint(ty: OptilotusType): {
  placeholder: string;
  hint: string;
  inputMode: "text" | "numeric" | "decimal";
} {
  switch (ty) {
    case optilotus_type.int8:
      return {
        placeholder: "e.g. 41",
        hint: "Whole number from −128 to 127, no quotes.",
        inputMode: "numeric",
      };
    case optilotus_type.int16:
      return {
        placeholder: "e.g. 41",
        hint: "Whole number from −32,768 to 32,767, no quotes.",
        inputMode: "numeric",
      };
    case optilotus_type.int32:
      return {
        placeholder: "e.g. 41",
        hint: "Whole number, no quotes.",
        inputMode: "numeric",
      };
    case optilotus_type.int64:
    case optilotus_type.int128:
      return {
        placeholder: "e.g. 41",
        hint: "Whole number of any size, no quotes.",
        inputMode: "numeric",
      };
    case optilotus_type.uint8:
      return {
        placeholder: "e.g. 41",
        hint: "Number from 0 to 255, no quotes or minus sign.",
        inputMode: "numeric",
      };
    case optilotus_type.uint16:
      return {
        placeholder: "e.g. 41",
        hint: "Number from 0 to 65,535, no quotes or minus sign.",
        inputMode: "numeric",
      };
    case optilotus_type.uint32:
    case optilotus_type.uint64:
    case optilotus_type.uint128:
      return {
        placeholder: "e.g. 41",
        hint: "Zero or more, no quotes or minus sign.",
        inputMode: "numeric",
      };
    case optilotus_type.float32:
    case optilotus_type.float64:
      return {
        placeholder: "e.g. 2.0",
        hint: "A decimal number — stored exactly as typed.",
        inputMode: "decimal",
      };
    case optilotus_type.bool:
      return {
        placeholder: "true",
        hint: "true or false here — comparisons live in Assign: declare a bool, then assign it e.g. 3 > 2 or {x} == 2.",
        inputMode: "text",
      };
    case optilotus_type.char:
      return {
        placeholder: "'a'",
        hint: "'single quotes' required, e.g. 'a'.",
        inputMode: "text",
      };
    case optilotus_type.string:
      return {
        placeholder: '"hello"',
        hint: '"double quotes" required, e.g. "hello".',
        inputMode: "text",
      };
    default:
      return {
        placeholder: "41 — empty uses the type default",
        hint: "Empty uses the type default.",
        inputMode: "text",
      };
  }
}

function KindFields(props: {
  draft: CommandDraft;
  onChange: (next: CommandDraft) => void;
}): ReactElement {
  const { draft, onChange } = props;
  switch (draft.kind) {
    case "declare": {
      const valueHint = declareValueHint(draft.ty);
      // String/char literals must be quoted (`"hi"`, `'a'`); anything
      // else is rejected here with a message instead of reaching the
      // engine. Other types are engine-validated on Apply.
      const valueError = validateDeclareValue(draft.ty, draft.init);
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
              onChange={(e) => {
                const nextTy = e.target.value as OptilotusType;
                // A literal typed for the old type is usually invalid for
                // the new one (e.g. "41" kept while switching to `bool`),
                // and the engine would reject the edit — leaving the block
                // visibly "frozen" on the old type. Reset to empty (the
                // engine default, valid for every type) on an actual type
                // switch; the name is untouched.
                onChange(
                  nextTy === draft.ty
                    ? { ...draft, ty: nextTy }
                    : { ...draft, ty: nextTy, init: "" },
                );
              }}
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
              <label htmlFor="in-access">Access</label>
            </span>
            <select
              id="in-access"
              value={draft.access ?? "private"}
              onChange={(e) =>
                onChange({ ...draft, access: e.target.value as Access })
              }
            >
              {ACCESS_LEVELS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <div className="hint">{accessHint(draft.access ?? "private")}</div>
          </div>
          <div className="field">
            <span>
              <label htmlFor="in-value">Value (optional)</label>
            </span>
            <input
              id="in-value"
              value={draft.init}
              onChange={(e) => onChange({ ...draft, init: e.target.value })}
              placeholder={valueHint.placeholder}
              autoComplete="off"
              inputMode={valueHint.inputMode}
              aria-describedby="in-value-hint"
              aria-invalid={valueError !== null}
            />
            <div className="field-hint" id="in-value-hint">
              {valueHint.hint} Empty uses the type default.
            </div>
            {valueError !== null ? (
              <div
                className="field-hint field-hint-error"
                role="alert"
                data-testid="declare-value-error"
              >
                {valueError}
              </div>
            ) : null}
          </div>
        </>
      );
    }
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
              aria-describedby="in-value-hint"
            />
            <div className="field-hint" id="in-value-hint">
              Math (`+ - * / %`) and comparisons (`== != &lt; &lt;= &gt;
              &gt;=`, e.g. `3 &gt; 2`) produce values — assign a
              comparison into a bool variable for true/false.
            </div>
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
    case "input":
      return (
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
      );
    case "cast":
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
              placeholder="y"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <span>
              <label htmlFor="in-type">To type</label>
            </span>
            <select
              id="in-type"
              value={draft.to}
              onChange={(e) =>
                onChange({ ...draft, to: e.target.value as OptilotusType })
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
              value={draft.expr}
              onChange={(e) => onChange({ ...draft, expr: e.target.value })}
              placeholder="{x}"
              autoComplete="off"
            />
          </div>
        </>
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
    case "if":
      // Branch bodies are raw command ids in the summary and the bridge
      // exposes no body→spec projection, so an `if` cannot be rebuilt
      // as an editable draft. Show the condition read-only rather than
      // pretending the branches are editable (editing would drop them).
      return (
        <div className="field">
          <span>
            <label htmlFor="in-cond">Condition (read-only)</label>
          </span>
          <input
            id="in-cond"
            value={draft.condition}
            readOnly
            placeholder="{x} > 5"
            autoComplete="off"
          />
          <div className="hint">
            Branch bodies cannot be edited from the inspector yet.
          </div>
        </div>
      );
    default:
      return assertNeverKind(draft);
  }
}

/** Inline function rename (function view). Remounted per function id. */
function FunctionRenameForm(props: {
  readonly name: string;
  readonly busy: boolean;
  readonly onRename: (name: string) => void;
}): ReactElement {
  const { name, busy, onRename } = props;
  const [value, setValue] = useState<string>(name);
  return (
    <form
      aria-label="Rename function"
      style={{ display: "flex", gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        onRename(value);
      }}
    >
      <input
        aria-label="Function name"
        className="glass-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="function name"
        autoComplete="off"
        style={{ flex: 1, minWidth: 0 }}
      />
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={busy || value.trim() === "" || value.trim() === name}
      >
        Rename
      </button>
    </form>
  );
}
/**
 * Contextual block inspector (evolved from the command editor). Shows
 * function properties when nothing is selected, per-kind block
 * properties when a block is selected. Edits replace the command
 * (delete + recreate, spliced into position) since the bridge offers
 * no in-place update; deletes call the existing bridge mutation.
 */
export default function Inspector(props: InspectorProps): ReactElement {
  const {
    func,
    selected,
    busy,
    recoveryVar,
    onReplace,
    onDeleteBlock,
    onDeleteFunction,
    onClearEntry,
    onDeclareVariable,
    onRenameFunction,
  } = props;
  // Edit draft derived from the selection during render (not synced in
  // an effect): when a different block is selected, the draft resets to
  // it; typing only touches local state. This keeps the "adjust state
  // during render" pattern instead of set-state-in-effect.
  const [edit, setEdit] = useState<CommandDraft | null>(() =>
    selected === null ? null : summaryToDraft(selected),
  );
  const [editFor, setEditFor] = useState<CommandId | null>(
    selected?.id ?? null,
  );
  if ((selected?.id ?? null) !== editFor) {
    setEditFor(selected?.id ?? null);
    setEdit(selected === null ? null : summaryToDraft(selected));
  }

  if (selected !== null && edit !== null) {
    // An unquotable string/char value blocks Apply with the field-level
    // message instead of failing at the engine.
    const editBlocked =
      edit.kind === "declare" &&
      validateDeclareValue(edit.ty, edit.init) !== null;
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
          <KindFields draft={edit} onChange={setEdit} />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || editBlocked || edit.kind === "if"}
            title={
              editBlocked
                ? "Fix the value error first (see above)"
                : undefined
            }
          >
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
        </dl>
        <div className="pane-title">
          {func.name}
          {func.isMain ? " · MAIN" : ""}
        </div>
        {onRenameFunction !== undefined ? (
          <FunctionRenameForm
            key={func.id}
            name={func.name}
            busy={busy}
            onRename={onRenameFunction}
          />
        ) : null}
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
            <dd>
              {func.entry === null || func.entry === undefined
                ? "Cleared — run is a no-op"
                : func.isMain
                  ? `Yes — starts at #${func.entry}`
                  : `Starts at #${func.entry}`}
            </dd>
          </div>
        </dl>
        {func.entry !== null && func.entry !== undefined ? (
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

  return (
    <div className="empty">
      <strong>Inspector</strong>
      <span>Select a block to inspect its properties.</span>
    </div>
  );
}
