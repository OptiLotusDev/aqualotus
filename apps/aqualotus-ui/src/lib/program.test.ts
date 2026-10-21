import { describe, expect, it } from "vitest";
import {
  commandDraftEqual,
  commandMainLine,
  commandSubLine,
  declareEditAffected,
  displayDeclareValue,
  errorMessage,
  freshName,
  isOptilotusError,
  normalizeDeclareInit,
  renameRefs,
  summaryToDraft,
  validateDeclareValue,
} from "./program";
import type { CommandSummary } from "./optilotus";

function declareCmd(id: number): CommandSummary {
  return { id, kind: "declare", next: null, var: "n", ty: "int32", expr: "41" };
}

describe("isOptilotusError", () => {
  it("narrows bridge results by status", () => {
    expect(isOptilotusError({ status: "ok" })).toBe(false);
    expect(
      isOptilotusError({
        status: "error",
        kind: "UnknownFunction",
        command: null,
        message: "nope",
      }),
    ).toBe(true);
  });
});

describe("errorMessage", () => {
  it("renders kind plus message without raw JSON", () => {
    const text = errorMessage({
      status: "error",
      kind: "UnknownFunction",
      command: null,
      message: "Unknown function: helper",
    });
    expect(text).toBe("UnknownFunction: Unknown function: helper");
    expect(text).not.toContain("{");
  });

  it("falls back to kind when the message is missing", () => {
    const text = errorMessage({
      status: "error",
      kind: "LoopLimit",
      command: null,
      message: "",
    });
    expect(text).toBe("LoopLimit: LoopLimit");
  });
});

describe("commandMainLine / commandSubLine", () => {
  it("covers every command kind", () => {
    const declare = declareCmd(1);
    expect(commandMainLine(declare)).toBe("n: int32");
    expect(commandSubLine(declare)).toBe("initial 41");

    const assign: CommandSummary = {
      id: 2,
      kind: "assign",
      next: null,
      var: "n",
      expr: "{n} + 1",
    };
    expect(commandMainLine(assign)).toBe("n = {n} + 1");

    const print: CommandSummary = {
      id: 3,
      kind: "print",
      next: null,
      template: '"{n}"',
    };
    expect(commandMainLine(print)).toBe('"{n}"');
    expect(commandSubLine(print)).toBe("print to output");

    const ret: CommandSummary = {
      id: 4,
      kind: "return",
      next: null,
      expr: "{n}",
    };
    expect(commandMainLine(ret)).toBe("return {n}");
    expect(commandSubLine(ret)).toBe("ends the function");
  });
});

describe("freshName", () => {
  it("suggests the first unused name", () => {
    expect(freshName([], "x")).toBe("x");
    expect(freshName(["x"], "x")).toBe("x1");
    expect(freshName(["x", "x1"], "x")).toBe("x2");
  });
});

describe("variable access", () => {
  it("defaults a declare draft to private", () => {
    // A summary written before access existed omits the field; it must
    // read back as `private`, which is what those variables behaved as.
    const draft = summaryToDraft({
      id: 1,
      kind: "declare",
      next: null,
      var: "n",
      ty: "int32",
      expr: "1",
    });
    expect(draft.kind).toBe("declare");
    expect(draft.kind === "declare" && draft.access).toBe("private");
  });

  it("round-trips an explicit access modifier", () => {
    for (const access of ["public", "protected", "private"] as const) {
      const draft = summaryToDraft({
        id: 1,
        kind: "declare",
        next: null,
        var: "n",
        ty: "int32",
        access,
        expr: "1",
      });
      expect(draft.kind === "declare" && draft.access).toBe(access);
    }
  });

  it("treats an absent access as private when comparing drafts", () => {
    // Regression: comparing raw fields made a draft without `access`
    // look different from the stored one, so a no-op Apply churned
    // history and one undo no longer removed the block.
    const withoutAccess = { kind: "declare", name: "x", ty: "int32", init: "1" } as const;
    const withPrivate = {
      kind: "declare",
      name: "x",
      ty: "int32",
      access: "private",
      init: "1",
    } as const;
    expect(commandDraftEqual(withoutAccess, withPrivate)).toBe(true);
    expect(commandDraftEqual(withPrivate, withoutAccess)).toBe(true);
  });

  it("detects a real access change", () => {
    const asPrivate = {
      kind: "declare",
      name: "x",
      ty: "int32",
      access: "private",
      init: "1",
    } as const;
    const asPublic = {
      kind: "declare",
      name: "x",
      ty: "int32",
      access: "public",
      init: "1",
    } as const;
    expect(commandDraftEqual(asPrivate, asPublic)).toBe(false);
  });
});

describe("summaryToDraft", () => {
  it("rebuilds editable drafts per kind", () => {
    expect(
      summaryToDraft({ id: 1, kind: "declare", next: null, var: "n", ty: "int32", expr: "41" }),
    ).toEqual({ kind: "declare", name: "n", ty: "int32", access: "private", init: "41" });
    expect(
      summaryToDraft({ id: 2, kind: "assign", next: null, var: "n", expr: "{n}" }),
    ).toEqual({ kind: "assign", name: "n", expr: "{n}" });
    expect(
      summaryToDraft({ id: 3, kind: "print", next: null, template: '"{n}"' }),
    ).toEqual({ kind: "print", template: '"{n}"' });
    expect(
      summaryToDraft({ id: 4, kind: "return", next: null, expr: "0" }),
    ).toEqual({ kind: "return", expr: "0" });
  });

  // Regression: these three kinds were absent from `CommandDraft`, so
  // `summaryToDraft` fell off the end of the switch and returned
  // `undefined` — silently losing the block on undo/redo.
  it("rebuilds input and cast drafts instead of returning undefined", () => {
    expect(
      summaryToDraft({ id: 5, kind: "input", next: null, ty: "int32" }),
    ).toEqual({ kind: "input", ty: "int32" });
    expect(
      summaryToDraft({
        id: 6,
        kind: "cast",
        next: null,
        var: "y",
        ty: "int64",
        expr: "{x}",
      }),
    ).toEqual({ kind: "cast", name: "y", to: "int64", expr: "{x}" });
  });

  it("defaults a missing type to int32 rather than undefined", () => {
    expect(summaryToDraft({ id: 7, kind: "input", next: null })).toEqual({
      kind: "input",
      ty: "int32",
    });
  });

  // An `if` summary carries raw command ids for its branches, which the
  // bridge cannot project back to specs. Rebuild with empty branches so
  // the inspector can open; Apply is disabled to avoid corruption.
  it("rebuilds an if draft with empty branches (not recoverable)", () => {
    expect(
      summaryToDraft({
        id: 8,
        kind: "if",
        next: null,
        condition: 3,
        then_body: [4, 5],
        else_body: [6],
      }),
    ).toEqual({
      kind: "if",
      condition: "3",
      then: [],
      else: null,
    });
  });

  it("quotes string/char initializers for display", () => {
    expect(
      summaryToDraft({ id: 1, kind: "declare", next: null, var: "s", ty: "string", expr: "hi" }),
    ).toEqual({ kind: "declare", name: "s", ty: "string", access: "private", init: '"hi"' });
    expect(
      summaryToDraft({ id: 2, kind: "declare", next: null, var: "c", ty: "char", expr: "a" }),
    ).toEqual({ kind: "declare", name: "c", ty: "char", access: "private", init: "'a'" });
    expect(
      summaryToDraft({ id: 3, kind: "declare", next: null, var: "e", ty: "string" }),
    ).toEqual({ kind: "declare", name: "e", ty: "string", access: "private", init: "" });
  });
});

describe("displayDeclareValue", () => {
  it("quotes strings and chars, passes everything else through", () => {
    expect(displayDeclareValue("string", "hi")).toBe('"hi"');
    expect(displayDeclareValue("char", "a")).toBe("'a'");
    expect(displayDeclareValue("int32", "41")).toBe("41");
    expect(displayDeclareValue("string", "")).toBe("");
    expect(displayDeclareValue("string", undefined)).toBe("");
    expect(displayDeclareValue(undefined, "41")).toBe("41");
  });
});

describe("commandDraftEqual", () => {
  it("compares drafts field by field", () => {
    expect(
      commandDraftEqual(
        { kind: "declare", name: "x", ty: "int32", init: "1" },
        { kind: "declare", name: "x", ty: "int32", init: "1" },
      ),
    ).toBe(true);
    expect(
      commandDraftEqual(
        { kind: "declare", name: "x", ty: "int32", init: "1" },
        { kind: "declare", name: "x", ty: "string", init: "1" },
      ),
    ).toBe(false);
    expect(
      commandDraftEqual(
        { kind: "print", template: '"a"' },
        { kind: "assign", name: "x", expr: "1" },
      ),
    ).toBe(false);
    expect(
      commandDraftEqual(
        { kind: "print", template: '"a"' },
        { kind: "print", template: '"a"' },
      ),
    ).toBe(true);
  });
});

describe("normalizeDeclareInit", () => {
  it("unwraps quoted strings and chars", () => {
    expect(normalizeDeclareInit("string", '"hello"')).toBe("hello");
    expect(normalizeDeclareInit("string", "'hello'")).toBe("hello");
    expect(normalizeDeclareInit("string", "hello")).toBe("hello");
    expect(normalizeDeclareInit("string", '""')).toBe("");
    expect(normalizeDeclareInit("char", "'a'")).toBe("a");
    expect(normalizeDeclareInit("char", '"a"')).toBe("a");
    expect(normalizeDeclareInit("char", "a")).toBe("a");
    // Unbalanced quotes are left for the engine to reject honestly.
    expect(normalizeDeclareInit("string", '"half')).toBe('"half');
    expect(normalizeDeclareInit("char", "'ab'")).toBe("ab");
  });

  it("repairs bool casing and leaves other text byte-identical", () => {
    expect(normalizeDeclareInit("bool", "True")).toBe("true");
    expect(normalizeDeclareInit("bool", "FALSE")).toBe("false");
    expect(normalizeDeclareInit("bool", " true ")).toBe("true");
    expect(normalizeDeclareInit("bool", "maybe")).toBe("maybe");
    // Input is input: floats and integers are never rewritten.
    expect(normalizeDeclareInit("float32", "2")).toBe("2");
    expect(normalizeDeclareInit("float32", "2.3")).toBe("2.3");
    expect(normalizeDeclareInit("int32", "41")).toBe("41");
  });

  it("is idempotent", () => {
    const cases = [
      ["string", "hello"],
      ["char", "a"],
      ["bool", "true"],
      ["float32", "2.0"],
      ["int32", "41"],
    ] as const;
    for (const [ty, init] of cases) {
      expect(normalizeDeclareInit(ty, normalizeDeclareInit(ty, init))).toBe(
        normalizeDeclareInit(ty, init),
      );
    }
  });
});

describe("validateDeclareValue", () => {
  it("requires quotes for strings and chars", () => {
    expect(validateDeclareValue("string", "")).toBe(null);
    expect(validateDeclareValue("string", '"hello"')).toBe(null);
    expect(validateDeclareValue("string", "hello")).toContain("double quotes");
    expect(validateDeclareValue("char", "'b'")).toBe(null);
    expect(validateDeclareValue("char", "b")).toContain("single quotes");
    expect(validateDeclareValue("char", "'ab'")).toContain("single quotes");
    expect(validateDeclareValue("char", "")).toBe(null);
  });

  it("leaves other types to the engine", () => {
    expect(validateDeclareValue("int32", "abc")).toBe(null);
    expect(validateDeclareValue("bool", "maybe")).toBe(null);
    expect(validateDeclareValue("float32", "2")).toBe(null);
  });
});

describe("renameRefs", () => {
  it("rewrites brace references only", () => {
    expect(renameRefs("{x} + {x}", "x", "y")).toBe("{y} + {y}");
    expect(renameRefs('"{x}!"', "x", "y")).toBe('"{y}!"');
    expect(renameRefs("{ x }", "x", "y")).toBe("{y}");
    expect(renameRefs("x + helper()", "x", "y")).toBe("x + helper()");
    expect(renameRefs("x()", "x", "y")).toBe("x()");
    expect(renameRefs("{xyz}", "x", "y")).toBe("{xyz}");
    expect(renameRefs("{x}", "x", "x")).toBe("{x}");
  });
});

describe("declareEditAffected", () => {
  const cmds: CommandSummary[] = [
    { id: 1, kind: "declare", next: 2, var: "x", ty: "int32", expr: "1" },
    { id: 2, kind: "assign", next: 3, var: "x", expr: "{x} + 1" },
    { id: 3, kind: "print", next: null, template: '"{x}"' },
  ];

  it("covers the declare plus bound assigns on a type change", () => {
    expect(declareEditAffected(cmds, 1, "x")).toEqual([1, 2]);
  });

  it("also covers ref-holding blocks on a rename", () => {
    expect(declareEditAffected(cmds, 1, "y")).toEqual([1, 2, 3]);
  });

  it("ignores unrelated blocks and unknown ids", () => {
    const extended: CommandSummary[] = [
      ...cmds,
      { id: 4, kind: "print", next: null, template: '"fixed"' },
    ];
    expect(declareEditAffected(extended, 1, "y")).toEqual([1, 2, 3]);
    expect(declareEditAffected(extended, 9, "y")).toEqual([]);
    expect(
      declareEditAffected(extended, 4, "whatever"),
    ).toEqual([]);
  });
});
