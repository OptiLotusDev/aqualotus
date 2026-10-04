import { describe, expect, it } from "vitest";
import {
  commandMainLine,
  commandSubLine,
  errorMessage,
  freshName,
  isOptilotusError,
  summaryToDraft,
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

describe("summaryToDraft", () => {
  it("rebuilds editable drafts per kind", () => {
    expect(
      summaryToDraft({ id: 1, kind: "declare", next: null, var: "n", ty: "int32", expr: "41" }),
    ).toEqual({ kind: "declare", name: "n", ty: "int32", init: "41" });
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
});
