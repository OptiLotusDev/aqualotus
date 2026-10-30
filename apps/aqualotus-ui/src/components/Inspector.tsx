import { useState, type ReactElement } from "react";
import type { Access, CommandId, CommandSummary } from "../lib/optilotus";
import type { FunctionInfo } from "../lib/optilotus";
import type { OptilotusType } from "../lib/optilotus";
import {
  CAST_TARGET_TYPES,
  CASTING_DISABLED,
  castConvertedVariableNote,
  convertedVariableName,
} from "../lib/casting";
import {
  validateDeclareValue,
  type CommandDraft,
} from "../lib/program";
import {
  TYPES,
  ACCESS_LEVELS,
  accessHint,
  assertNeverKind,
  declareValueHint,
} from "../lib/inspector_helpers";
import { BlockInspector } from "./BlockInspector";
import { FunctionInspector } from "./FunctionInspector";

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
  /**
   * The selected block's If/Else merge state ("End of If Block"): a
   * manual join point the canvas draws when `on` (both branch tails
   * visibly rejoin, the continuation leaves the join). Presentation
   * only — the engine's `if.next` continuation is untouched, `undefined`
   * for blocks that are not an `if`.
   */
  readonly merge?: {
    readonly on: boolean;
    readonly onToggle: (on: boolean) => void;
  };
}

export function KindFields(props: {
  draft: CommandDraft;
  onChange: (next: CommandDraft) => void;
  /** Declared type of the assignment destination, when known. */
  readonly destinationType?: OptilotusType;
  /**
   * Every variable name alive in the function (hidden reserved names
   * included). Used to preview the exact name a created converted
   * variable will get, disambiguated the same way the apply does.
   */
  readonly takenNames?: readonly string[];
}): ReactElement {
  const { draft, onChange, destinationType, takenNames } = props;
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
      // The name the created converted variable will get, when the apply
      // will create one (a target that differs from the destination's
      // declared type). Derived from the live command list so a taken
      // name is disambiguated exactly like the real apply does.
      const convertedVariable =
        casting.enabled === true &&
        casting.targetType !== null &&
        casting.targetType !== destinationType
          ? convertedVariableName(
              takenNames ?? [],
              draft.name,
              casting.targetType,
            )
          : null;
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
              Optional conversion of the assigned value. Off by default; a
              target that differs from the destination's declared type
              creates the converted value in a new variable instead.
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
                the value at run time. A target that differs from the
                destination's declared type creates the converted value in a
                new variable of that target type instead of writing the
                destination.
              </div>
              {convertedVariable !== null ? (
                <div
                  className="field-hint"
                  data-testid="cast-converted-variable"
                  data-cast-converted-name={convertedVariable}
                  data-cast-target-type={casting.targetType ?? ""}
                >
                  Converted variable: {convertedVariable}
                  {casting.targetType !== null ? ` (${casting.targetType})` : ""}
                  {" — "}a new program variable. The original variable keeps
                  its declaration, its type and its value; this block becomes
                  the Engine cast that produces the converted value.
                </div>
              ) : null}
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
            The condition is checked when saved; the branch bodies run
            only when it reads <em>true</em> (a non-boolean result fails
            the run). A branch can hold plain compute commands only —
            wiring a nested If or a Return is rejected by the engine.
          </div>
        </div>
      );
    default:
      return assertNeverKind(draft);
  }
}

/** Inline function rename (function view). Remounted per function id. */
export function FunctionRenameForm(props: {
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
    merge,
  } = props;

  if (selected !== null) {
    return (
      <BlockInspector
        func={func ?? null}
        selected={selected}
        busy={busy}
        recoveryVar={recoveryVar}
        onReplace={onReplace}
        onDeleteBlock={onDeleteBlock}
        onDeclareVariable={onDeclareVariable}
        onConditionText={onConditionText}
        commands={commands}
        merge={merge}
      />
    );
  }

  if (func !== null) {
    return (
      <FunctionInspector
        func={func}
        entry={entry}
        busy={busy}
        onClearEntry={onClearEntry}
        onDeleteFunction={onDeleteFunction}
        onRenameFunction={onRenameFunction}
      />
    );
  }

  return (
    <div className="empty">
      <strong>Inspector</strong>
      <span>Select a block to inspect its properties.</span>
    </div>
  );
}

