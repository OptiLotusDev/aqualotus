/**
 * Pure comparison helpers for command replacement.
 *
 * Extracted from `program_replace.ts` so draft equality can be tested
 * in isolation without a mutation context or the engine bridge.
 */

import type { CommandDraft } from "../lib/program";

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
        (next.access ?? "private") === (current.access ?? "private") &&
        next.init === current.init
      );
    case "assign":
      return (
        next.kind === "assign" &&
        next.name === current.name &&
        next.expr === current.expr &&
        castingSettingsEqual(next.casting, current.casting)
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

export function castingSettingsEqual(
  a: { enabled: boolean; targetType: string | null } | undefined,
  b: { enabled: boolean; targetType: string | null } | undefined,
): boolean {
  const left = a ?? { enabled: false, targetType: null };
  const right = b ?? { enabled: false, targetType: null };
  return left.enabled === right.enabled && left.targetType === right.targetType;
}

export function unreachableDraft(_draft: never): never {
  throw new Error("Unhandled command draft kind");
}

export function commandSpecListEqual(
  a: readonly { kind: string }[] | null,
  b: readonly { kind: string }[] | null,
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
