import { useState, type ReactElement } from "react";
import type { Access, CommandId, CommandSummary } from "../lib/optilotus";
import type { FunctionInfo } from "../lib/optilotus";
import { optilotus_type, type OptilotusType } from "../lib/optilotus";
import {
  CAST_TARGET_TYPES,
  CASTING_DISABLED,
  castConvertedVariableNote,
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

interface InspectorProps {
  readonly func: (FunctionInfo & { status: "ok" }) | null;
  /**
   * The user-visible entry point of the shown function.
   *
   * The engine's own entry can name a hidden node (an `if`'s condition
   * compute); the UI resolves it to the block the chain starts at, so
   * the panel never shows a block id that does not exist.
   */
  readonly entry: number | null;
  readonly selected: CommandSummary | null;
  readonly busy: boolean;
  /** Recovery hint: attempted undeclared variable name, if any. */
  readonly recoveryVar?: string | null;
  readonly onReplace: (id: CommandId, draft: CommandDraft) => void;
  /**
   * The visible commands of the selected function. Used to resolve the
   * destination variable's declared type while its name is being edited,
   * so a cast target can be checked against the real declaration the
   * Engine will enforce.
   */
  readonly commands?: readonly CommandSummary[];
  /** The expression an `if`'s condition was built from (null on error). */
  readonly onConditionText?: (ifId: CommandId) => string | null;
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
  /** Declared type of the assignment destination, when known. */
  readonly destinationType?: OptilotusType;
}): ReactElement {
  const { draft, onChange, destinationType } = props;
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
    case "assign": {
      // Casting is part of this draft, not parent configuration state:
      // toggling only edits the local draft and never submits or creates
      // an Engine command by itself.
      const casting = draft.casting ?? CASTING_DISABLED;
      // The destination's declaration is never rewritten by casting:
      // when the chosen target differs from the declared type (or the
      // destination is not declared), applying replaces this block with
      // a real Engine cast that creates the converted value in a new
      // variable. The note explains that; it never blocks the choice.
      const convertedNote = castConvertedVariableNote(
        casting,
        destinationType,
        draft.name,
      );
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
          <div className="field field-check" data-testid="assign-casting">
            <label className="field-check-label" htmlFor="in-casting">
              <input
                id="in-casting"
                type="checkbox"
                checked={casting.enabled === true}
                onChange={(e) => {
                  const enabled = e.target.checked === true;
                  onChange({
                    ...draft,
                    casting: enabled
                      ? {
                          enabled: true,
                          // Enabling never invents a target: the user must
                          // choose one.
                          targetType: casting.targetType,
                        }
                      : // Disabling removes the whole configuration, so
                        // Apply restores a plain assignment.
                        CASTING_DISABLED,
                  });
                }}
              />
              <span>Casting</span>
            </label>
            <div className="field-hint">
              Optional conversion before storing. Off by default; ordinary
              assignments are unchanged.
            </div>
          </div>
          {casting.enabled === true ? (
            <div className="field">
              <span>
                <label htmlFor="in-cast-type">Cast to type</label>
              </span>
              <select
                id="in-cast-type"
                value={casting.targetType ?? ""}
                aria-describedby="in-cast-hint"
                onChange={(e) => {
                  const raw = e.target.value;
                  onChange({
                    ...draft,
                    casting: {
                      enabled: true,
                      // The empty option is the deliberate "not chosen
                      // yet" state; it maps to null, never a default.
                      targetType:
                        raw === "" ? null : (raw as OptilotusType),
                    },
                  });
                }}
              >
                <option value="" disabled>
                  Select a target type…
                </option>
                {CAST_TARGET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                    {destinationType === t ? " (destination type)" : ""}
                  </option>
                ))}
              </select>
              <div className="field-hint" id="in-cast-hint" data-testid="cast-preview">
                Source: {draft.expr || "—"} · Destination:{" "}
                {draft.name || "—"}
                {destinationType !== undefined ? (
                  <span data-testid="destination-type"> ({destinationType})</span>
                ) : (
                  <span data-testid="destination-unresolved">
                    {" "}
                    (type not resolved)
                  </span>
                )}
                . Every legal target can be selected; the Engine converts
                the value at run time. For a target that differs from the
                destination's declared type, applying replaces this block
                with a Cast that creates the converted value in a new
                variable.
              </div>
              {convertedNote !== null ? (
                <div
                  className="field-hint"
                  data-testid="cast-converted-note"
                >
                  {convertedNote}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      );
    }
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
      // Internal/editor support for programs that already contain an
      // Engine cast command (a declaration that converts then stores).
      // Users cannot create a standalone Cast block from the library;
      // assignment casting is configured in the `assign` case above.
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
                <option key={t} value={t}>{t}</option>
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
      // Editing touches only the condition expression — the engine
      // applies it in place (`if_set_condition`), so the branch bodies
      // and their wiring are never reconstructed by this edit.
      return (
        <div className="field">
          <span>
            <label htmlFor="in-cond">Condition</label>
          </span>
          <input
            id="in-cond"
            value={draft.condition}
            onChange={(e) =>
              onChange({ ...draft, condition: e.target.value })
            }
            placeholder="{x} > 5"
            autoComplete="off"
          />
          <div className="hint">
            Only the condition changes; branch bodies keep their wiring.
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
    entry,
    selected,
    busy,
    recoveryVar,
    commands,
    onReplace,
    onConditionText,
    onDeleteBlock,
    onDeleteFunction,
    onClearEntry,
    onDeclareVariable,
    onRenameFunction,
  } = props;
  // An `if` draft's raw summary condition is a temp id; when the engine
  // can report the expression the block was built from, overlay it so
  // the field shows (and edits) the real text.
  const initDraft = (sel: CommandSummary | null): CommandDraft | null => {
    if (sel === null) return null;
    const draft = summaryToDraft(sel);
    if (draft.kind === "if" && onConditionText !== undefined) {
      const text = onConditionText(sel.id);
      if (text !== null) draft.condition = text;
    }
    return draft;
  };
  // Edit draft derived from the selection during render (not synced in
  // an effect): when a different block is selected, the draft resets to
  // it; typing only touches local state. This keeps the "adjust state
  // during render" pattern instead of set-state-in-effect.
  const [edit, setEdit] = useState<CommandDraft | null>(() =>
    initDraft(selected),
  );
  const [editFor, setEditFor] = useState<CommandId | null>(
    selected?.id ?? null,
  );
  if ((selected?.id ?? null) !== editFor) {
    setEditFor(selected?.id ?? null);
    setEdit(initDraft(selected));
  }

  if (selected !== null && edit !== null) {
    // Casting is incomplete when enabled but no target type has been
    // chosen. The empty option never counts as a selection. No other
    // casting state blocks Apply: any legal target builds — a target
    // differing from the destination's type creates the converted value
    // in a new variable instead of writing the destination.
    const casting = edit.kind === "assign" ? edit.casting : undefined;
    const castIncomplete =
      edit.kind === "assign" && castingIncomplete(casting);
    // Resolve the destination from the live command list (the name may
    // be edited in this draft); fall back to the selected summary's type.
    const destinationType =
      edit.kind === "assign"
        ? (declaredTypeOf(commands ?? [], edit.name) ??
          // No command list (or no declaration yet): only trust the
          // selected summary while the name still matches it.
          ((selected.var ?? "").trim() === edit.name.trim()
            ? selected.ty
            : undefined))
        : undefined;
    const editBlocked =
      castIncomplete ||
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
              {entry === null
                ? "Cleared — run is a no-op"
                : func.isMain
                  ? `Yes — starts at #${entry}`
                  : `Starts at #${entry}`}
            </dd>
          </div>
        </dl>
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

  return (
    <div className="empty">
      <strong>Inspector</strong>
      <span>Select a block to inspect its properties.</span>
    </div>
  );
}
