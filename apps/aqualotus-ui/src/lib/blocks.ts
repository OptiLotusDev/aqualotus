import { optilotus_type } from "./optilotus";
import type { CommandDraft } from "./program";

/**
 * Block library vocabulary (P17/P24). UI vocabulary only — never program
 * semantics. This list contains EXACTLY what `docs/api.md` supports: the
 * four commands (`declare`, `assign`, `print`, `return`), function
 * creation, and calls (which the engine expresses as `name()` inside an
 * `assign` expression). Nothing here is invented: every entry maps to a
 * real `optilotus_*` bridge operation.
 */
export interface BlockDefinition {
  readonly kind: string;
  readonly label: string;
  readonly category: BlockCategory;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly draft?: CommandDraft;
  readonly action?: "create-function";
}

export type BlockCategory = "Program" | "Variables" | "Output";

export const BLOCK_CATEGORIES: readonly BlockCategory[] = [
  "Program",
  "Variables",
  "Output",
] as const;

export const BLOCKS: readonly BlockDefinition[] = [
  {
    kind: "function",
    label: "Function",
    category: "Program",
    description: "Define a new function in the package.",
    aliases: ["def", "new function"],
    action: "create-function",
  },
  {
    kind: "return",
    label: "Return",
    category: "Program",
    description: "End the function with an expression value.",
    aliases: ["ret"],
    draft: { kind: "return", expr: "" },
  },
  {
    kind: "call",
    label: "Call Function",
    category: "Program",
    description:
      "Calls another function and stores its result in a declared variable (uses the first one).",
    aliases: ["call", "invoke"],
    draft: { kind: "assign", name: "result", expr: "helper()" },
  },
  {
    kind: "declare",
    label: "Declare Variable",
    category: "Variables",
    description: "Introduce a typed variable with an optional initial value.",
    aliases: ["declare", "let", "var"],
    draft: { kind: "declare", name: "", ty: optilotus_type.int32, init: "" },
  },
  {
    kind: "assign",
    label: "Assign Variable",
    category: "Variables",
    description: "Update a declared variable with an expression.",
    aliases: ["assign", "set", "="],
    draft: { kind: "assign", name: "", expr: "" },
  },
  {
    kind: "print",
    label: "Print",
    category: "Output",
    description: "Append a template line to the program output.",
    aliases: ["print", "output", "log"],
    draft: { kind: "print", template: "" },
  },
];

/**
 * Exact matcher: the trimmed query must equal a block label or one of
 * its aliases (case-insensitive). Substring/category/description
 * matching is deliberately gone — searching "program" finds nothing
 * because no block is named that, while "function" finds only Function.
 * Empty query returns every definition, grouped by the caller.
 */
export function filterBlocks(
  query: string,
): readonly BlockDefinition[] {
  const q = query.trim().toLowerCase();
  if (q === "") return BLOCKS;
  return BLOCKS.filter(
    (b) =>
      b.label.toLowerCase() === q ||
      b.aliases.some((a) => a.toLowerCase() === q),
  );
}

/** Look up an addable definition by kind. */
export function findAvailableBlock(
  kind: string,
): BlockDefinition | null {
  const found = BLOCKS.find((b) => b.kind === kind);
  if (found === undefined) return null;
  return found;
}
