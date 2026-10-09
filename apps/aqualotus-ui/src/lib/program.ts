import type { CommandSummary, OptilotusError } from "./optilotus";
import { optilotus_type, type OptilotusType } from "./optilotus";

/** Command kinds the editor supports (mirrors the bridge). */
export type CommandKind = CommandSummary["kind"];

/** Fields for creating / replacing a command (one shape per kind). */
export type CommandDraft =
  | { kind: "declare"; name: string; ty: OptilotusType; init: string }
  | { kind: "assign"; name: string; expr: string }
  | { kind: "print"; template: string }
  | { kind: "return"; expr: string };

/**
 * Rebuild an editable draft from a stored summary (delete-undo,
 * function restore). Pure projection of bridge data, no semantics.
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
    case "return":
      return { kind: "return", expr: cmd.expr ?? "" };
    case "if":
      throw new Error("If commands cannot be edited as a simple command draft");
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
    case "return":
      return `return ${cmd.expr ?? ""}`;
    case "if":
      return `if value#${cmd.condition ?? "?"}`;
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
    case "return":
      return "ends the function";
    case "if":
      return `then: ${cmd.then_body?.length ?? 0} commands, else: ${cmd.else_body?.length ?? 0} commands`;
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
