/**
 * Pure presentation helpers for the inspector panel.
 *
 * No React state, no bridge calls — pure functions over input data.
 */

import type { Access, OptilotusType } from "../lib/optilotus";
import { optilotus_type } from "../lib/optilotus";

/** Every scalar tag the engine accepts in `declare` (`optilotus_type`
 * minus `void`, which the engine always rejects at creation with
 * "cannot declare a variable of type void"). Derived from the bridge so
 * the list can never drift behind `docs/api.md`. The bridge still
 * validates each declare (unknown tags, duplicates, bad literals);
 * failures surface as typed errors. */
export const TYPES: readonly OptilotusType[] = (
  Object.values(optilotus_type) as OptilotusType[]
).filter((t) => t !== optilotus_type.void);

/** Access modifiers offered for a variable declaration. */
export const ACCESS_LEVELS: readonly Access[] = ["private", "protected", "public"];

/**
 * Explain what the selected modifier means *today*.
 *
 * The language has one package and no classes, so `public` and
 * `protected` are currently equivalent and `private` matches the
 * runtime's existing per-call variable scope. Saying so plainly is
 * better than implying an enforcement that does not exist yet. */
export function accessHint(access: Access): string {
  switch (access) {
    case "public":
      return "Visible to every package. Currently the same as protected: only one package exists.";
    case "protected":
      return "Visible within this package. Currently the same as public: all functions are in one package.";
    case "private":
      return "Visible only inside the function that declares it (the default).";
  }
}

/** Exhaustiveness guard for the per-kind editor. A new `CommandDraft`
 * kind must get an editor here; reaching this means one was added
 * without UI, so fail loudly instead of rendering nothing. */
export function assertNeverKind(draft: never): never {
  throw new Error(
    `Unhandled draft kind in inspector: ${String((draft as { kind?: string }).kind)}`,
  );
}

/** Per-type value demo for the declare editor (P17: UI vocabulary only).
 * Each entry shows the exact literal shape the Optilotus engine parses
 * for that type — the bridge still validates, this only teaches it.
 * Notably: integers/floats take bare numbers (no quotes), `bool` is
 * lowercase-only (`true`/`false`), `char` is one bare character, and
 * `string` is raw text (typed quotes become part of the string). */
export function declareValueHint(ty: OptilotusType): {
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
