import { optilotus_type } from "./optilotus";
import type { CommandDraft } from "./program";

/**
 * Presentation metadata for the block library (P17/P24). UI vocabulary
 * only — never program semantics. `status` is authoritative for what
 * the user may add: `available` maps to a real bridge-supported draft
 * (or the `create-function` action); `coming-soon` blocks are visible
 * but inert and must never produce runtime behavior.
 */
export type BlockStatus = "available" | "coming-soon";

export interface BlockDefinition {
  readonly kind: string;
  readonly label: string;
  readonly category: BlockCategory;
  readonly description: string;
  readonly status: BlockStatus;
  readonly aliases: readonly string[];
  readonly draft?: CommandDraft;
  readonly action?: "create-function";
}

export type BlockCategory =
  | "Program"
  | "Variables"
  | "Values"
  | "Arithmetic"
  | "Comparison"
  | "Logic"
  | "Control Flow"
  | "Output"
  | "Data"
  | "String"
  | "Types"
  | "Advanced";

export const BLOCK_CATEGORIES: readonly BlockCategory[] = [
  "Program",
  "Variables",
  "Values",
  "Arithmetic",
  "Comparison",
  "Logic",
  "Control Flow",
  "Output",
  "Data",
  "String",
  "Types",
  "Advanced",
] as const;

function soon(
  kind: string,
  label: string,
  category: BlockCategory,
  description: string,
  aliases: readonly string[] = [],
): BlockDefinition {
  return { kind, label, category, description, status: "coming-soon", aliases };
}

export const BLOCKS: readonly BlockDefinition[] = [
  {
    kind: "function",
    label: "Function",
    category: "Program",
    description: "Define a new function in the package.",
    status: "available",
    aliases: ["def", "new function"],
    action: "create-function",
  },
  {
    kind: "return",
    label: "Return",
    category: "Program",
    description: "End the function with an expression value.",
    status: "available",
    aliases: ["ret"],
    draft: { kind: "return", expr: "" },
  },
  {
    kind: "call",
    label: "Call Function",
    category: "Program",
    description:
      "Calls another function and stores its result in a declared variable (uses the first one).",
    status: "available",
    aliases: ["call", "invoke"],
    draft: { kind: "assign", name: "result", expr: "helper()" },
  },
  {
    kind: "declare",
    label: "Declare Variable",
    category: "Variables",
    description: "Introduce a typed variable with an optional initial value.",
    status: "available",
    aliases: ["declare", "let", "var"],
    draft: { kind: "declare", name: "", ty: optilotus_type.int32, init: "" },
  },
  {
    kind: "assign",
    label: "Assign Variable",
    category: "Variables",
    description: "Update a declared variable with an expression.",
    status: "available",
    aliases: ["assign", "set", "="],
    draft: { kind: "assign", name: "", expr: "" },
  },
  soon(
    "read",
    "Read Variable",
    "Variables",
    "No standalone read block yet — read variables inside expressions with {name}.",
    ["read", "get"],
  ),
  soon(
    "constant",
    "Constant",
    "Variables",
    "Use Declare with an initial value until constants exist.",
    ["const"],
  ),
  {
    kind: "print",
    label: "Print",
    category: "Output",
    description: "Append a template line to the program output.",
    status: "available",
    aliases: ["print", "output", "log"],
    draft: { kind: "print", template: "" },
  },
  soon("input", "Input", "Output", "Runtime input is not supported yet.", [
    "read input",
  ]),
  soon(
    "integer",
    "Integer",
    "Values",
    "Integer literals live inside initial values and expressions.",
    ["int", "number"],
  ),
  soon(
    "unsigned",
    "Unsigned Integer",
    "Values",
    "Unsigned literals live inside initial values and expressions.",
    ["uint"],
  ),
  soon(
    "float",
    "Float",
    "Values",
    "Float literals live inside initial values and expressions.",
  ),
  soon(
    "boolean",
    "Boolean",
    "Values",
    "Boolean literals live inside initial values and expressions.",
    ["bool"],
  ),
  soon(
    "string-value",
    "String",
    "Values",
    "String literals live inside initial values and expressions.",
    ["str", "text"],
  ),
  soon(
    "char",
    "Character",
    "Values",
    "Character literals live inside initial values and expressions.",
    ["char"],
  ),
  soon(
    "void-value",
    "Void",
    "Values",
    "The void type tag exists; no standalone void block yet.",
    ["void", "unit", "null"],
  ),
  soon(
    "add",
    "Add",
    "Arithmetic",
    "Write arithmetic inside expressions, e.g. {n} + 1.",
    ["+", "plus"],
  ),
  soon(
    "subtract",
    "Subtract",
    "Arithmetic",
    "Write arithmetic inside expressions, e.g. {n} - 1.",
    ["-", "minus"],
  ),
  soon(
    "multiply",
    "Multiply",
    "Arithmetic",
    "Write arithmetic inside expressions, e.g. {n} * 2.",
    ["*", "times"],
  ),
  soon(
    "divide",
    "Divide",
    "Arithmetic",
    "Write arithmetic inside expressions, e.g. {n} / 2.",
    ["/", "div"],
  ),
  soon(
    "modulo",
    "Modulo",
    "Arithmetic",
    "Write arithmetic inside expressions, e.g. {n} % 2.",
    ["%", "mod", "remainder"],
  ),
  soon(
    "negate",
    "Negate",
    "Arithmetic",
    "Write negation inside expressions, e.g. -{n}.",
    ["neg", "unary minus"],
  ),
  soon(
    "increment",
    "Increment",
    "Arithmetic",
    "Use Assign with {n} + 1 until an increment block exists.",
    ["++", "inc"],
  ),
  soon(
    "decrement",
    "Decrement",
    "Arithmetic",
    "Use Assign with {n} - 1 until a decrement block exists.",
    ["--", "dec"],
  ),
  soon("equal", "Equal", "Comparison", "Comparisons live in expressions.", [
    "==",
    "eq",
  ]),
  soon(
    "not-equal",
    "Not Equal",
    "Comparison",
    "Comparisons live in expressions.",
    ["!=", "ne"],
  ),
  soon(
    "less-than",
    "Less Than",
    "Comparison",
    "Comparisons live in expressions.",
    ["<", "lt"],
  ),
  soon(
    "less-equal",
    "Less Than Or Equal",
    "Comparison",
    "Comparisons live in expressions.",
    ["<=", "lte"],
  ),
  soon(
    "greater-than",
    "Greater Than",
    "Comparison",
    "Comparisons live in expressions.",
    [">", "gt"],
  ),
  soon(
    "greater-equal",
    "Greater Than Or Equal",
    "Comparison",
    "Comparisons live in expressions.",
    [">=", "gte"],
  ),
  soon("and", "AND", "Logic", "Logic lives in expressions.", ["&&"]),
  soon("or", "OR", "Logic", "Logic lives in expressions.", ["||"]),
  soon("not", "NOT", "Logic", "Logic lives in expressions.", ["!"]),
  soon("xor", "XOR", "Logic", "Logic lives in expressions.", ["^"]),
  soon("if", "If", "Control Flow", "Branching is not supported yet.", [
    "branch",
    "condition",
  ]),
  soon(
    "else-if",
    "Else If",
    "Control Flow",
    "Branching is not supported yet.",
    ["elif"],
  ),
  soon("else", "Else", "Control Flow", "Branching is not supported yet."),
  soon("while", "While", "Control Flow", "Loops are not supported yet.", [
    "loop",
  ]),
  soon("for", "For", "Control Flow", "Loops are not supported yet."),
  soon("break", "Break", "Control Flow", "Loops are not supported yet."),
  soon(
    "continue",
    "Continue",
    "Control Flow",
    "Loops are not supported yet.",
  ),
  soon("array", "Array", "Data", "Collections are not supported yet.", [
    "list",
    "vector",
  ]),
  soon("map", "Map", "Data", "Collections are not supported yet.", ["dict"]),
  soon("tuple", "Tuple", "Data", "Tuples are not supported yet."),
  soon("set", "Set", "Data", "Sets are not supported yet."),
  soon(
    "concat",
    "Concatenate",
    "String",
    "Use string templates in Print instead.",
    ["join", "+"],
  ),
  soon("length", "Length", "String", "String operations are not supported yet.", [
    "len",
    "size",
  ]),
  soon(
    "contains",
    "Contains",
    "String",
    "String operations are not supported yet.",
  ),
  soon(
    "cast",
    "Cast",
    "Types",
    "Type casts are not supported yet.",
    ["convert", "as"],
  ),
  soon(
    "type-check",
    "Type Check",
    "Types",
    "Type checks are not supported yet.",
    ["is", "typeof"],
  ),
  soon("try", "Try", "Advanced", "Error handling is not supported yet.", [
    "catch",
    "throw",
  ]),
  soon(
    "async",
    "Async",
    "Advanced",
    "Concurrency is a later roadmap phase.",
    ["await", "spawn"],
  ),
];

/**
 * Honest filter (P3): match name, category, description, and aliases.
 * Empty query returns every definition, grouped by the caller.
 */
export function filterBlocks(
  query: string,
): readonly BlockDefinition[] {
  const q = query.trim().toLowerCase();
  if (q === "") return BLOCKS;
  return BLOCKS.filter((b) => {
    const hay = `${b.label} ${b.category} ${b.description} ${b.aliases.join(" ")}`.toLowerCase();
    return q
      .split(/\s+/)
      .every((word) => hay.includes(word));
  });
}

/** Look up an available (addable) definition by kind. */
export function findAvailableBlock(
  kind: string,
): BlockDefinition | null {
  const found = BLOCKS.find((b) => b.kind === kind);
  if (found === undefined || found.status !== "available") return null;
  return found;
}
