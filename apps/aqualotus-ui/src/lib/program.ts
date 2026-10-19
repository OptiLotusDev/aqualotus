import type { CommandSpec, CommandSummary, OptilotusError } from "./optilotus";
import { optilotus_type, type OptilotusType } from "./optilotus";

/** Command kinds the editor supports (mirrors the bridge). */
export type CommandKind = CommandSummary["kind"];

/**
 * Fields for creating / replacing a command (one shape per kind).
 *
 * Every kind the bridge can report must appear here: `summaryToDraft`
 * is the undo/restore path, so a kind missing from this union silently
 * loses the user's block on undo. `if` carries its branch bodies as
 * nested specs because that is the shape `optilotus_if` accepts.
 */
export type CommandDraft =
  | { kind: "declare"; name: string; ty: OptilotusType; init: string }
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
 */
export function summaryToDraft(cmd: CommandSummary): CommandDraft {
  switch (cmd.kind) {
    case "declare":
      return {
        kind: "declare",
        name: cmd.var ?? "",
        ty: (cmd.ty ?? optilotus_type.int32) as OptilotusType,
        init: cmd.expr ?? "",
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
      // Branch bodies are stored as raw command ids; a draft carries
      // specs. The bridge does not expose a body-id → spec projection,
      // so an `if` cannot be faithfully rebuilt here. Failing loudly
      // beats restoring a block with silently empty branches.
      throw new Error(
        `Cannot rebuild a draft for 'if' (#${cmd.id}): branch bodies are not recoverable from a summary.`,
      );
    default:
      return unreachableKind(cmd.kind);
  }
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
    case "declare":
      return cmd.expr !== undefined && cmd.expr !== ""
        ? `initial ${cmd.expr}`
        : "no initial value";
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
