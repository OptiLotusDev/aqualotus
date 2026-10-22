import type { Access, CommandSpec, CommandSummary, OptilotusError } from "./optilotus";
import { optilotus_type, type OptilotusType } from "./optilotus";

/** Command kinds the editor supports (mirrors the bridge). */
export type CommandKind = CommandSummary["kind"];

/**
 * A command as the UI's **graph model** sees it.
 *
 * `next` is the logical successor: the engine's own `next` whenever the
 * engine reports one, otherwise the successor the UI planned and the
 * engine accepted but cannot report — the edge into an `if`, whose
 * hidden condition compute sits between the two blocks (see
 * `lib/graph.ts` for the full story).
 *
 * `planned` marks exactly those commands: a planned successor is never
 * presented as an engine-confirmed one. Everything downstream (the
 * canvas edges, the connection notice, the flow animation, the link
 * planners) works on the logical successor, so the canvas and the UI's
 * graph model always agree.
 */
export interface UiCommand extends CommandSummary {
  /** The successor came from the UI's plan, not from the engine. */
  readonly planned?: boolean;
}

/**
 * Fields for creating / replacing a command (one shape per kind).
 *
 * Every kind the bridge can report must appear here: `summaryToDraft`
 * is the undo/restore path, so a kind missing from this union silently
 * loses the user's block on undo. `if` carries its branch bodies as
 * nested specs because that is the shape `optilotus_if` accepts.
 */
export type CommandDraft =
  | {
      kind: "declare";
      name: string;
      ty: OptilotusType;
      /**
       * Visibility. Optional so existing call sites (and drafts built
       * before access existed) keep compiling; an absent value means
       * `private`, which is the engine default and the historical
       * behaviour.
       */
      access?: Access;
      init: string;
    }
  | { kind: "assign"; name: string; expr: string }
  | { kind: "print"; template: string }
  | { kind: "input"; ty: OptilotusType }
  | { kind: "cast"; name: string; to: OptilotusType; expr: string }
  | { kind: "return"; expr: string }
  | {
      kind: "if";
      condition: string;
      then: readonly CommandSpec[];
      else: readonly CommandSpec[] | null;
    };

/**
 * Exhaustiveness guard. A new `CommandKind` in Rust must break the
 * build here rather than degrade to `undefined` at runtime — the
 * failure mode this file previously had for `input`/`cast`/`if`.
 */
function unreachableKind(kind: never): never {
  throw new Error(`Unhandled command kind: ${String(kind)}`);
}

/**
 * Rebuild an editable draft from a stored summary (delete-undo,
 * function restore). Pure projection of bridge data, no semantics.
 *
 * Total over `CommandSummary["kind"]`: the `default` branch is a
 * compile-time error if a kind is unhandled, so undo can never capture
 * `undefined` for a block it is supposed to restore.
 *
 * String/char initializers display quoted (`"hi"`, `'a'`) — the input
 * rectangle and the block always show the literal form; the bridge
 * layer unwraps it again on replay (`normalizeDeclareInit`), so
 * undo/redo round-trips are stable.
 */
export function summaryToDraft(cmd: CommandSummary): CommandDraft {
  switch (cmd.kind) {
    case "declare":
      return {
        kind: "declare",
        name: cmd.var ?? "",
        ty: (cmd.ty ?? optilotus_type.int32) as OptilotusType,
        // Summaries written before access existed omit it; those
        // variables behaved as `private`, which is also the default.
        access: cmd.access ?? "private",
        init: displayDeclareValue(cmd.ty, cmd.expr),
      };
    case "assign":
      return { kind: "assign", name: cmd.var ?? "", expr: cmd.expr ?? "" };
    case "print":
      return { kind: "print", template: cmd.template ?? "" };
    case "input":
      return {
        kind: "input",
        ty: (cmd.ty ?? optilotus_type.int32) as OptilotusType,
      };
    case "cast":
      return {
        kind: "cast",
        name: cmd.var ?? "",
        to: (cmd.ty ?? optilotus_type.int32) as OptilotusType,
        expr: cmd.expr ?? "",
      };
    case "return":
      return { kind: "return", expr: cmd.expr ?? "" };
    case "if":
      // Branch bodies are stored as raw command ids, so a draft never
      // replays them (then/else stay empty). The condition here is the
      // raw summary value (a temp id); the Inspector overlays the real
      // expression via `ifConditionText` before showing it, and editing
      // is routed through `if_set_condition` in place so bodies are
      // never reconstructed.
      return {
        kind: "if",
        condition: cmd.condition !== undefined ? String(cmd.condition) : "",
        then: [],
        else: null,
      };
    default:
      return unreachableKind(cmd.kind);
  }
}

/**
 * How a stored declare value reads on screen (input rectangle and
 * block): string/char values wear their quotes (`"hi"`, `'a'`), empty
 * stays empty, everything else is byte-identical. Presentation only —
 * the engine keeps the unwrapped text.
 */
export function displayDeclareValue(
  ty: OptilotusType | undefined,
  expr: string | undefined,
): string {
  if (expr === undefined || expr === "") return "";
  if (ty === optilotus_type.string) return `"${expr}"`;
  if (ty === optilotus_type.char) return `'${expr}'`;
  return expr;
}

/**
 * `true` when an edit draft changes nothing about the stored command.
 * Lets `replaceCommand` skip no-op Applies (no churn, no history entry)
 * — with quoted display, re-applying an untouched string/char block
 * must not rebuild the world.
 */
export function commandDraftEqual(
  current: CommandDraft,
  next: CommandDraft,
): boolean {
  if (current.kind !== next.kind) return false;
  switch (current.kind) {
    case "declare":
      return (
        next.kind === "declare" &&
        next.name === current.name &&
        next.ty === current.ty &&
        // An absent modifier means `private` (the engine default), so
        // compare the resolved values: otherwise re-applying a draft that
        // omits `access` would look like an edit and churn history.
        (next.access ?? "private") === (current.access ?? "private") &&
        next.init === current.init
      );
    case "assign":
      return (
        next.kind === "assign" &&
        next.name === current.name &&
        next.expr === current.expr
      );
    case "print":
      return next.kind === "print" && next.template === current.template;
    case "input":
      return next.kind === "input" && next.ty === current.ty;
    case "cast":
      return (
        next.kind === "cast" &&
        next.name === current.name &&
        next.to === current.to &&
        next.expr === current.expr
      );
    case "return":
      return next.kind === "return" && next.expr === current.expr;
    case "if":
      return (
        next.kind === "if" &&
        next.condition === current.condition &&
        commandSpecListEqual(next.then, current.then) &&
        commandSpecListEqual(next.else, current.else)
      );
    default:
      return unreachableDraft(current);
  }
}

/**
 * Exhaustiveness guard for `commandDraftEqual`. Takes the whole draft
 * because the `kind` field is already narrowed to `never` by the
 * preceding `kind` comparison.
 */
function unreachableDraft(draft: never): never {
  throw new Error(
    `Unhandled command draft kind: ${String((draft as { kind?: string }).kind)}`,
  );
}

/** Structural equality for `if` branch bodies (specs are flat objects). */
function commandSpecListEqual(
  a: readonly CommandSpec[] | null,
  b: readonly CommandSpec[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((spec, i) => {
    const other = b[i];
    if (other === undefined) return false;
    const keys = new Set([...Object.keys(spec), ...Object.keys(other)]);
    for (const key of keys) {
      if (
        (spec as Record<string, unknown>)[key] !==
        (other as Record<string, unknown>)[key]
      ) {
        return false;
      }
    }
    return true;
  });
}

export const COMMAND_KINDS: readonly CommandKind[] = [
  "declare",
  "assign",
  "print",
  "return",
] as const;

/** Narrow a bridge result to its error shape (P9: no `any`). */
export function isOptilotusError(
  value: { status: string } & Record<string, unknown>,
): value is OptilotusError {
  return value.status === "error";
}

/** One-line human message for a typed bridge error. Never dumps raw JSON. */
export function errorMessage(err: OptilotusError): string {
  const detail =
    typeof err["message"] === "string" && err["message"].length > 0
      ? (err["message"] as string)
      : err.kind;
  return `${err.kind}: ${detail}`;
}

/** Primary mono line shown on a command card. */
export function commandMainLine(cmd: CommandSummary): string {
  switch (cmd.kind) {
    case "declare":
      return `${cmd.var ?? "?"}: ${cmd.ty ?? "?"}`;
    case "assign":
      return `${cmd.var ?? "?"} = ${cmd.expr ?? ""}`;
    case "print":
      return cmd.template ?? "";
    case "input":
      return `input ${cmd.ty ?? "?"}`;
    case "cast":
      return `${cmd.var ?? "?"} = cast(${cmd.expr ?? ""}, ${cmd.ty ?? "?"})`;
    case "return":
      return `return ${cmd.expr ?? ""}`;
    case "if":
      return `if ${cmd.condition ?? "?"}`;
    default:
      return unreachableKind(cmd.kind);
  }
}

/** Secondary line shown under the primary line on a command card. */
export function commandSubLine(cmd: CommandSummary): string {
  switch (cmd.kind) {
    case "declare": {
      const shown = displayDeclareValue(cmd.ty, cmd.expr);
      return shown !== "" ? `initial ${shown}` : "no initial value";
    }
    case "assign":
      return "assignment";
    case "print":
      return "print to output";
    case "input":
      return "read from input";
    case "cast":
      return "converts and stores";
    case "return":
      return "ends the function";
    case "if":
      return "conditional branch";
    default:
      return unreachableKind(cmd.kind);
  }
}

/**
 * Normalize a typed declare value before it crosses the bridge (P3/P17:
 * input sugar only — the engine still validates everything):
 * - `string`: one outer `"..."` (or `'...'`) pair is unwrapping, not
 *   content — `"hello"` stores `hello`. The editor requires the quotes
 *   (see `validateDeclareValue`); bare text from older programs stays
 *   verbatim so replays keep working.
 * - `char`: `'a'` (or `"a"`) stores `a`. Anything else is left for the
 *   engine to accept or reject honestly.
 * - `bool`: `True`/`FALSE`/etc. fold to lowercase (`true`/`false` are
 *   the engine's only spellings); anything else passes through.
 * Input text is otherwise stored byte-identical (`input is input`):
 * floats keep `2` as `2`, integers keep their digits.
 * Idempotent: normalized output normalizes to itself, so undo/redo
 * replays are stable.
 */
export function normalizeDeclareInit(ty: OptilotusType, init: string): string {
  switch (ty) {
    case optilotus_type.string:
      return (
        stripOuterQuotes(init, '"') ?? stripOuterQuotes(init, "'") ?? init
      );
    case optilotus_type.char:
      return (
        stripOuterQuotes(init, "'") ?? stripOuterQuotes(init, '"') ?? init
      );
    case optilotus_type.bool: {
      const trimmed = init.trim();
      if (trimmed === "true" || trimmed === "false") return trimmed;
      const lowered = trimmed.toLowerCase();
      if (lowered === "true" || lowered === "false") return lowered;
      return init;
    }
    default:
      return init;
  }
}

/**
 * Field-level literal rule for the declare editor: string and char
 * values must be wrapped in quotes (`"hello"`, `'a'`) — bare text is
 * rejected with a message instead of reaching the engine. Empty stays
 * valid (omitted initializer). Every other type is engine-validated on
 * Apply, so this returns `null` for them. Returns the message to show,
 * or `null` when the value may be applied.
 */
export function validateDeclareValue(
  ty: OptilotusType,
  init: string,
): string | null {
  if (init === "") return null;
  if (ty === optilotus_type.string) {
    if (
      init.length >= 2 &&
      init.startsWith('"') &&
      init.endsWith('"')
    ) {
      return null;
    }
    return 'Wrap the text in "double quotes", e.g. "hello".';
  }
  if (ty === optilotus_type.char) {
    const inner =
      stripOuterQuotes(init, "'") ?? stripOuterQuotes(init, '"');
    if (inner !== null && [...inner].length === 1) return null;
    return "Use one character in 'single quotes', e.g. 'a'.";
  }
  return null;
}

/** Remove one outer quote pair (`""` → empty); `null` when not wrapped. */
function stripOuterQuotes(text: string, quote: '"' | "'"): string | null {
  if (text.length >= 2 && text.startsWith(quote) && text.endsWith(quote)) {
    return text.slice(1, -1);
  }
  return null;
}

/**
 * Honest helper (P3): suggest the first unused `base`, `base1`, …
 * against `taken`. UI sugar only — the bridge still validates.
 */
export function freshName(
  taken: readonly string[],
  base: string,
): string {
  if (!taken.includes(base)) return base;
  let n = 1;
  while (taken.includes(`${base}${n}`)) {
    n += 1;
  }
  return `${base}${n}`;
}

/**
 * Which command ids a declare-to-declare edit recreates (P3: pure
 * projection of bridge data). Always the declare itself; plus bound
 * assigns (their baked-in engine type follows the declaration); plus,
 * on a rename, every block whose expression/template text references
 * `{old}`. Shared by the mutation (`useProgram`) and the position
 * capture (`AppShell`) so the two always agree. Order follows `cmds`.
 */
export function declareEditAffected(
  cmds: readonly CommandSummary[],
  oldId: number,
  newName: string,
): readonly number[] {
  const old = cmds.find((c) => c.id === oldId);
  if (old === undefined || old.kind !== "declare") return [];
  const oldName = (old.var ?? "").trim();
  const renamed = newName.trim() !== "" && newName.trim() !== oldName;
  const out: number[] = [];
  for (const c of cmds) {
    if (c.id === oldId) {
      out.push(c.id);
      continue;
    }
    if (c.kind === "assign" && (c.var ?? "") === oldName) {
      out.push(c.id);
      continue;
    }
    if (!renamed) continue;
    const text =
      c.kind === "assign"
        ? (c.expr ?? "")
        : c.kind === "print"
          ? (c.template ?? "")
          : c.kind === "return"
            ? (c.expr ?? "")
            : null;
    if (text !== null && renameRefs(text, oldName, newName) !== text) {
      out.push(c.id);
    }
  }
  return out;
}

/**
 * Rewrite `{old}` variable references as `{next}` inside expression or
 * template text (P3: pure text, no semantics). Only brace references
 * match — bare identifiers and `name()` calls are untouched, so
 * renaming variable `x` never rewrites a call to function `x()`.
 * Surrounding whitespace inside the braces is normalized away. The
 * bridge still validates every rebuilt command.
 */
export function renameRefs(
  text: string,
  oldName: string,
  nextName: string,
): string {
  const old = oldName.trim();
  const next = nextName.trim();
  if (old === "" || old === next) return text;
  const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`\\{\\s*${escaped}\\s*\\}`, "g"),
    `{${next}}`,
  );
}
