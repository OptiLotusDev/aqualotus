/**
 * Bridge ↔ real engine contract tests.
 *
 * These tests drive the **real** Optilotus WASM artifact through the
 * real TypeScript bridge wrappers (`src/lib/optilotus.ts`). They are
 * the evidence that the wire contract (`docs/api.md`) actually holds,
 * not just that a mock returns what the UI expects.
 *
 * Every `describe` block names the `PARITY-xxx` id from
 * `docs/feature-parity-audit.md`. Tests that pin a *gap* are named
 * "documents the gap" so a future engine change flips them loudly.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRealEngine, useRealEngine } from "../test-support/realEngine";
import {
  optilotus_assign,
  optilotus_cast,
  optilotus_clearPackage,
  optilotus_createFunction,
  optilotus_debugMode,
  optilotus_declare,
  optilotus_declareWithAccess,
  optilotus_deleteCommand,
  optilotus_deleteFunction,
  optilotus_getFunction,
  optilotus_health,
  optilotus_if,
  optilotus_if_append,
  optilotus_if_condition,
  optilotus_if_set_condition,
  optilotus_input,
  optilotus_lastError,
  optilotus_listCommands,
  optilotus_listFunctions,
  optilotus_peekPendingInput,
  optilotus_print,
  optilotus_renameFunction,
  optilotus_return,
  optilotus_runProgram,
  optilotus_runProgramCancel,
  optilotus_runProgramProvideInput,
  optilotus_runProgramProvideInputTyped,
  optilotus_runProgramProvideInputs,
  optilotus_runProgramReset,
  optilotus_runProgramStart,
  optilotus_runProgramStatus,
  optilotus_runProgramWithInputs,
  optilotus_setEntry,
  optilotus_setNext,
  optilotus_type,
  optilotus_version,
} from "./optilotus";
import type { CommandSpec } from "./optilotus";
import * as bridgeModule from "../wasm/optilotus/optilotus.js";

/** A print spec in the exact shape the UI sends (`lib/blocks.ts`). */
function printSpec(template: string): CommandSpec {
  return {
    kind: "print",
    var: null,
    ty: null,
    access: null,
    init: null,
    expr: null,
    template,
    to: null,
  };
}

beforeAll(async () => {
  await useRealEngine();
});

beforeEach(() => {
  resetRealEngine();
});

describe("PARITY-001..006 — package & function lifecycle", () => {
  it("lists, creates, inspects, renames and deletes functions", () => {
    const listed = optilotus_listFunctions();
    expect(listed.status).toBe("ok");
    expect(listed.functions).toEqual([{ id: 0, name: "main", isMain: true }]);

    const created = optilotus_createFunction("helper");
    expect(created).toMatchObject({
      status: "ok",
      id: 1,
      name: "helper",
      isMain: false,
    });

    const info = optilotus_getFunction(1);
    expect(info).toMatchObject({
      status: "ok",
      id: 1,
      name: "helper",
      isMain: false,
      entry: null,
      commandCount: 0,
    });

    const renamed = optilotus_renameFunction(1, "worker");
    expect(renamed).toMatchObject({ status: "ok", id: 1, name: "worker" });
    // Identity is the stable id: the rename keeps it.
    expect(optilotus_getFunction(1)).toMatchObject({ id: 1, name: "worker" });

    const deleted = optilotus_deleteFunction(1);
    expect(deleted).toMatchObject({ status: "ok", deleted: 1 });
    expect(optilotus_listFunctions().functions).toHaveLength(1);
  });

  it("protects `main` from deletion and rejects duplicate names", () => {
    const deleted = optilotus_deleteFunction(0);
    expect(deleted.status).toBe("error");
    if (deleted.status !== "error") return;
    expect(deleted.message).toContain("main");

    expect(optilotus_createFunction("helper").status).toBe("ok");
    const duplicate = optilotus_createFunction("helper");
    expect(duplicate.status).toBe("error");
    if (duplicate.status !== "error") return;
    expect(duplicate.kind).toBe("PackageError");
  });

  it("clears the package back to an empty `main`", () => {
    optilotus_createFunction("helper");
    const cleared = optilotus_clearPackage();
    expect(cleared).toMatchObject({ status: "ok", cleared: 1 });
    expect(optilotus_listFunctions().functions).toEqual([
      { id: 0, name: "main", isMain: true },
    ]);
  });

  it("reports the engine version and health", () => {
    expect(optilotus_health()).toBe("ok");
    expect(optilotus_version()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("PARITY-007..011 — command builders", () => {
  it("declares, assigns, prints and returns through the bridge", () => {
    const declared = optilotus_declare(0, "n", optilotus_type.int32, "41");
    expect(declared).toMatchObject({ status: "ok" });
    expect(optilotus_assign(0, "n", "{n} + 1")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{n}"')).toMatchObject({ status: "ok" });
    expect(optilotus_return(0, "{n}")).toMatchObject({ status: "ok" });

    const commands = optilotus_listCommands(0);
    expect(commands.status).toBe("ok");
    if (commands.status !== "ok") return;
    expect(commands.commands.map((c) => c.kind)).toEqual([
      "declare",
      "assign",
      "print",
      "return",
    ]);
    expect(commands.commands[0]).toMatchObject({ var: "n", ty: "int32" });
  });

  it("records the access modifier and surfaces it on the summary", () => {
    const declared = optilotus_declareWithAccess(
      0,
      "shared",
      optilotus_type.int32,
      "public",
      "1",
    );
    expect(declared.status).toBe("ok");
    const commands = optilotus_listCommands(0);
    if (commands.status !== "ok") return;
    expect(commands.commands[0]?.access).toBe("public");
  });

  it("rejects an unknown access modifier with a typed error", () => {
    const bad = optilotus_declareWithAccess(
      0,
      "x",
      optilotus_type.int32,
      "internal" as "public",
      "1",
    );
    expect(bad.status).toBe("error");
    if (bad.status !== "error") return;
    expect(bad.kind).toBe("UnknownAccess");
  });

  it("rejects an assign to an undeclared variable", () => {
    const bad = optilotus_assign(0, "ghost", "{ghost}");
    expect(bad.status).toBe("error");
    if (bad.status !== "error") return;
    expect(bad.message).toContain("declare it first");
  });
});

describe("PARITY-013 — cast", () => {
  it("builds a cast command and converts the value at run time", () => {
    expect(optilotus_declare(0, "n", optilotus_type.int32, "7")).toMatchObject({
      status: "ok",
    });
    expect(
      optilotus_cast(0, "y", optilotus_type.float64, "{n}"),
    ).toMatchObject({ status: "ok" });
    optilotus_print(0, '"{y}"');
    const run = optilotus_runProgram();
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    // A float keeps its decimal point, so it is never read as an int.
    expect(run.printed).toEqual(["7.0"]);
  });
});

describe("PARITY-012 — input", () => {
  it("builds an input command, but the value it reads has no name", () => {
    expect(optilotus_input(0, optilotus_type.int32)).toMatchObject({
      status: "ok",
    });
    const commands = optilotus_listCommands(0);
    if (commands.status !== "ok") return;
    // The engine binds the read value to a `ValueId`, never to a
    // variable name, so no expression can read it back.
    expect(commands.commands[0]?.kind).toBe("input");
    expect(commands.commands[0]?.var).toBeUndefined();
  });

  it("cannot read the input value through an expression", () => {
    optilotus_input(0, optilotus_type.int32);
    optilotus_print(0, '"{n}"');
    const run = optilotus_runProgramWithInputs(["7"]);
    // The input reads the line successfully; the print then reads an
    // undeclared variable, because the input never bound one.
    expect(run.status).toBe("error");
    if (run.status !== "error") return;
    expect(run.kind).toBe("UnknownVariable");
  });
});

describe("PARITY-014..017 — linkage", () => {
  it("sets the entry, links commands and deletes one", () => {
    const a = optilotus_declare(0, "a", optilotus_type.int32, "1");
    const b = optilotus_print(0, '"a"');
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;

    expect(optilotus_setEntry(0, a.id)).toMatchObject({ status: "ok" });
    expect(optilotus_setNext(0, a.id, b.id)).toMatchObject({ status: "ok" });

    const commands = optilotus_listCommands(0);
    if (commands.status !== "ok") return;
    expect(commands.commands.map((c) => [c.id, c.next])).toEqual([
      [a.id, b.id],
      [b.id, null],
    ]);

    expect(optilotus_deleteCommand(0, b.id)).toMatchObject({
      status: "ok",
      deleted: b.id,
    });
    const after = optilotus_listCommands(0);
    if (after.status !== "ok") return;
    expect(after.commands).toHaveLength(1);
  });

  it("clears the entry point, leaving the commands as orphans", () => {
    const a = optilotus_declare(0, "a", optilotus_type.int32, "1");
    if (a.status !== "ok") return;
    optilotus_setEntry(0, a.id);
    expect(optilotus_setEntry(0, null)).toMatchObject({ status: "ok" });
    expect(optilotus_getFunction(0)).toMatchObject({ entry: null });
  });

  it("rejects a link to an unknown command", () => {
    const bad = optilotus_setNext(0, 999, 998);
    expect(bad.status).toBe("error");
    if (bad.status !== "error") return;
    expect(bad.kind).toBe("PackageError");
  });
});

describe("PARITY-018..021 — conditional blocks", () => {
  it("creates an `if` with a condition and branch bodies", () => {
    optilotus_declare(0, "x", optilotus_type.int32, "10");
    const created = optilotus_if(
      0,
      "{x} > 5",
      [printSpec('"big"')],
      [printSpec('"small"')],
    );
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;

    const commands = optilotus_listCommands(0);
    if (commands.status !== "ok") return;
    const ifCommand = commands.commands.find((c) => c.id === created.id);
    expect(ifCommand?.kind).toBe("if");
    // The branch lists carry every *raw* id of the body group (the
    // visible head plus its hidden pair), not one id per spec.
    expect(ifCommand?.then_body?.length).toBe(2);
    expect(ifCommand?.else_body?.length).toBe(2);
  });

  it("reads and replaces the condition expression in place", () => {
    const created = optilotus_if(0, "true", [printSpec('"yes"')], null);
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;

    const condition = optilotus_if_condition(0, created.id);
    expect(condition).toMatchObject({ status: "ok", expr: "true" });

    expect(optilotus_if_set_condition(0, created.id, "false")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_if_condition(0, created.id)).toMatchObject({
      status: "ok",
      expr: "false",
    });
  });

  it("appends an existing command to a branch", () => {
    const created = optilotus_if(0, "true", [printSpec('"yes"')], null);
    if (created.status !== "ok") return;
    const extra = optilotus_print(0, '"more"');
    if (extra.status !== "ok") return;
    expect(optilotus_if_append(0, created.id, "then", extra.id)).toMatchObject({
      status: "ok",
    });
    const commands = optilotus_listCommands(0);
    if (commands.status !== "ok") return;
    const ifCommand = commands.commands.find((c) => c.id === created.id);
    expect(ifCommand?.then_body?.length).toBe(4);
  });

  it("reports an invalid `if` as an error envelope", () => {
    const bad = optilotus_if(0, "", [printSpec('"x"')], null);
    expect(bad.status).toBe("error");
    if (bad.status !== "error") return;
    expect(bad.kind).toBe("PackageError");
    expect(bad.message).toContain("condition expression must not be empty");
  });

  it("rejects a non-default access modifier on an if-body declare", () => {
    const bad = optilotus_if(
      0,
      "true",
      [
        {
          kind: "declare",
          var: "x",
          ty: optilotus_type.int32,
          access: "public",
          init: "1",
          expr: null,
          template: null,
          to: null,
        },
      ],
      null,
    );
    expect(bad.status).toBe("error");
    if (bad.status !== "error") return;
    expect(bad.message).toContain("not supported on an if-body declare");
  });

  it("runs the branch that matches the condition", () => {
    optilotus_declare(0, "x", optilotus_type.int32, "10");
    const created = optilotus_if(
      0,
      "{x} > 5",
      [printSpec('"big"')],
      [printSpec('"small"')],
    );
    if (created.status !== "ok") return;
    // The engine appends the hidden condition compute and the `if` at
    // the chain tail, so the chain already reaches the `if`.
    const commands = optilotus_listCommands(0);
    if (commands.status !== "ok") return;
    const declare = commands.commands.find((c) => c.kind === "declare");
    if (declare === undefined) return;
    optilotus_setEntry(0, declare.id);

    const run = optilotus_runProgram();
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["big"]);
  });

  it("documents the gap: a user-level rewire drops the condition compute", () => {
    // The condition lives in a hidden compute command that the
    // user-level `next` edges cannot address. Linking a block straight
    // to the `if` therefore orphans the compute and the condition dangles.
    const declare = optilotus_declare(0, "x", optilotus_type.int32, "10");
    if (declare.status !== "ok") return;
    const created = optilotus_if(0, "{x} > 5", [printSpec('"big"')], null);
    if (created.status !== "ok") return;
    optilotus_setNext(0, declare.id, created.id);
    optilotus_setEntry(0, declare.id);

    const broken = optilotus_runProgram();
    expect(broken.status).toBe("error");
    if (broken.status !== "error") return;
    expect(broken.kind).toBe("MissingValue");

    // The engine's own repair primitive (`if_set_condition`) re-splices
    // the compute in front of the `if`. The UI does this automatically
    // after every rewire — see `useProgram.repairIfCondition`.
    const condition = optilotus_if_condition(0, created.id);
    if (condition.status !== "ok") return;
    expect(
      optilotus_if_set_condition(0, created.id, condition.expr),
    ).toMatchObject({ status: "ok" });

    const repaired = optilotus_runProgram();
    expect(repaired.status).toBe("ok");
    if (repaired.status !== "ok") return;
    expect(repaired.printed).toEqual(["big"]);
  });
});

describe("PARITY-022 — running a program", () => {
  it("runs `main` and reports the printed output", () => {
    optilotus_declare(0, "n", optilotus_type.int32, "41");
    optilotus_assign(0, "n", "{n} + 1");
    optilotus_print(0, '"{n}"');
    const run = optilotus_runProgram();
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["42"]);
    expect(run.prints).toBe(1);
    expect(run.steps).toBeGreaterThan(0);
  });

  it("reports a typed execution error", () => {
    optilotus_declare(0, "n", optilotus_type.int32, "1");
    optilotus_assign(0, "n", '"{n}"');
    const run = optilotus_runProgram();
    expect(run.status).toBe("error");
    if (run.status !== "error") return;
    expect(run.kind).toBe("TypeMismatch");
    expect(run.detail).toContain("int32");
  });

  it("documents the gap: the error command id is a raw id, not a block id", () => {
    // The engine reports the id of the *raw* node that failed. A print
    // owns a hidden pair, so the reported id belongs to that hidden
    // node — the canvas has no block with that id.
    const printed = optilotus_print(0, '"hi {ghost}"');
    if (printed.status !== "ok") return;
    const run = optilotus_runProgram();
    expect(run.status).toBe("error");
    if (run.status !== "error") return;
    expect(run.kind).toBe("UnknownVariable");
    expect(run.var).toBe("ghost");
    expect(run.command).not.toBe(printed.id);
    expect(run.command).toBe(printed.id + 1);
  });

  it("consumes supplied input lines", () => {
    const read = optilotus_input(0, optilotus_type.int32);
    expect(read.status).toBe("ok");
    const run = optilotus_runProgramWithInputs(["7"]);
    // The input reads the line successfully; the program itself only
    // holds the input command, so nothing is printed.
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    expect(run.printed).toEqual([]);
  });

  it("reports a parse failure for a line that is not an int32", () => {
    optilotus_input(0, optilotus_type.int32);
    const run = optilotus_runProgramWithInputs(["not a number"]);
    expect(run.status).toBe("error");
    if (run.status !== "error") return;
    expect(run.kind).toBe("InputParse");
  });
});

describe("PARITY-024 — resumable execution", () => {
  it("pauses at an input, reports the pending type, and resumes", () => {
    optilotus_input(0, optilotus_type.int32);

    const started = optilotus_runProgramStart();
    expect(started.status).toBe("waiting_input");
    if (started.status !== "waiting_input") return;
    expect(started.ty).toBe("int32");
    expect(started.command).toBeGreaterThan(0);

    // Peek does not consume the pending input.
    const peeked = optilotus_peekPendingInput();
    expect(peeked).toMatchObject({ status: "waiting_input" });

    const status = optilotus_runProgramStatus();
    expect(status).toMatchObject({ status: "waiting_input" });

    const finished = optilotus_runProgramProvideInput("7");
    expect(finished.status).toBe("ok");
    if (finished.status !== "ok") return;
    expect(finished.prints).toBe(0);
  });

  it("provides a batch of inputs", () => {
    optilotus_input(0, optilotus_type.int32);
    optilotus_input(0, optilotus_type.int32);
    optilotus_runProgramStart();
    const status = optilotus_runProgramProvideInputs(["1", "2"]);
    expect(status.status).toBe("ok");
  });

  it("provides a typed input value", () => {
    optilotus_input(0, optilotus_type.int32);
    optilotus_runProgramStart();
    const status = optilotus_runProgramProvideInputTyped("5");
    expect(status.status).toBe("ok");
  });

  it("rejects a typed input value that does not match the pending type", () => {
    optilotus_input(0, optilotus_type.int32);
    optilotus_runProgramStart();
    const status = optilotus_runProgramProvideInputTyped('"not a number"');
    expect(status.status).toBe("error");
    if (status.status !== "error") return;
    expect(status.kind).toBe("InputParse");
  });

  it("cancels and resets the active run", () => {
    optilotus_input(0, optilotus_type.int32);
    optilotus_runProgramStart();
    expect(optilotus_runProgramStatus().status).toBe("waiting_input");
    optilotus_runProgramCancel();
    expect(optilotus_runProgramStatus().status).toBe("idle");
    expect(optilotus_runProgramReset()).toMatchObject({ status: "idle" });
  });

  it("reports `NoRun` when input is provided without an active run", () => {
    const status = optilotus_runProgramProvideInput("1");
    expect(status.status).toBe("error");
    if (status.status !== "error") return;
    expect(status.kind).toBe("NoRun");
  });
});

describe("PARITY-025 — last error", () => {
  it("records the last resumable-run error", () => {
    optilotus_input(0, optilotus_type.int32);
    optilotus_runProgramStart();
    const failed = optilotus_runProgramProvideInputTyped('"not a number"');
    expect(failed.status).toBe("error");
    const last = optilotus_lastError();
    expect(last.status).toBe("error");
    if (last.status !== "error") return;
    expect(last.kind).toBe("InputParse");
  });
});

describe("PARITY-026 — debug mode", () => {
  it("adds the step count on the resumable status path", () => {
    optilotus_declare(0, "n", optilotus_type.int32, "1");
    optilotus_debugMode(true);
    const status = optilotus_runProgramStart();
    expect(status.status).toBe("ok");
    if (status.status !== "ok") return;
    expect(status.step_count).toBe(status.steps);
    optilotus_debugMode(false);
  });

  it("documents the gap: a plain run carries no step count", () => {
    optilotus_declare(0, "n", optilotus_type.int32, "1");
    optilotus_debugMode(true);
    const plain = optilotus_runProgram();
    expect(plain.status).toBe("ok");
    if (plain.status !== "ok") return;
    // The debug fields are added by the resumable status path only.
    expect(plain.step_count).toBeUndefined();
    optilotus_debugMode(false);
  });
});

describe("PARITY-027 — the returned value", () => {
  it("documents the gap: a plain run reports no returned value", () => {
    optilotus_declare(0, "n", optilotus_type.int32, "41");
    optilotus_return(0, "{n}");
    const run = optilotus_runProgram();
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    // The engine can capture `main`'s return value
    // (`Package::run_main_returning`), but the bridge's plain run path
    // never asks for it.
    expect(run.returned).toBeNull();
  });

  it("is captured on the resumable run path", () => {
    optilotus_declare(0, "n", optilotus_type.int32, "41");
    optilotus_return(0, "{n}");
    const status = optilotus_runProgramStart();
    expect(status.status).toBe("ok");
    if (status.status !== "ok") return;
    expect(status.returned).toEqual({ Int32: 41 });
  });
});

describe("PARITY-031 — helper function calls", () => {
  it("calls a helper and uses its return value", () => {
    const helper = optilotus_createFunction("helper");
    if (helper.status !== "ok") return;
    optilotus_declare(helper.id, "x", optilotus_type.int32, "20");
    optilotus_return(helper.id, "{x}");

    optilotus_declare(0, "result", optilotus_type.int32);
    optilotus_assign(0, "result", "helper()");
    optilotus_print(0, '"{result}"');

    const run = optilotus_runProgram();
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["20"]);
  });

  it("reports an unknown callee as a typed error", () => {
    optilotus_declare(0, "result", optilotus_type.int32);
    optilotus_assign(0, "result", "ghost()");
    const run = optilotus_runProgram();
    expect(run.status).toBe("error");
    if (run.status !== "error") return;
    expect(run.kind).toBe("UnknownFunction");
    expect(run.function).toBe("ghost");
  });

  it("reports a callee without a `return` as `MissingReturn`", () => {
    optilotus_createFunction("helper");
    optilotus_declare(0, "result", optilotus_type.int32);
    optilotus_assign(0, "result", "helper()");
    const run = optilotus_runProgram();
    expect(run.status).toBe("error");
    if (run.status !== "error") return;
    expect(run.kind).toBe("MissingReturn");
  });
});

describe("PARITY-034 — value types", () => {
  it("accepts every scalar type tag except void", () => {
    const tags = [
      "int8",
      "int16",
      "int32",
      "int64",
      "int128",
      "uint8",
      "uint16",
      "uint32",
      "uint64",
      "uint128",
      "float32",
      "float64",
      "bool",
      "char",
      "string",
    ];
    tags.forEach((tag, index) => {
      const created = optilotus_declare(0, `v${index}`, tag as "int32");
      expect(created.status, `declare ${tag}`).toBe("ok");
    });
    const voidDeclare = optilotus_declare(0, "v", "void" as "int32");
    expect(voidDeclare.status).toBe("error");
  });

  it("keeps a float distinguishable from an integer when printed", () => {
    optilotus_declare(0, "f", optilotus_type.float64, "2.0");
    optilotus_print(0, '"{f}"');
    const run = optilotus_runProgram();
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["2.0"]);
  });
});

describe("PARITY-028/029/030 — expressions", () => {
  it("evaluates arithmetic and comparisons", () => {
    optilotus_declare(0, "x", optilotus_type.int32, "10");
    optilotus_declare(0, "y", optilotus_type.int32, "5");
    optilotus_declare(0, "z", optilotus_type.int32);
    optilotus_assign(0, "z", "{x} + {y}");
    optilotus_declare(0, "flag", optilotus_type.bool);
    optilotus_assign(0, "flag", "{x} > {y}");
    optilotus_print(0, '"{z}"');
    const run = optilotus_runProgram();
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["15"]);
  });

  it("interpolates a template and evaluates the arithmetic in it", () => {
    optilotus_declare(0, "x", optilotus_type.int32, "10");
    optilotus_declare(0, "y", optilotus_type.int32, "5");
    optilotus_print(0, '"{x} + {y}"');
    const run = optilotus_runProgram();
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["15"]);
  });

  it("rejects a comparison between incompatible types", () => {
    optilotus_declare(0, "x", optilotus_type.int32, "3");
    optilotus_declare(0, "flag", optilotus_type.bool);
    optilotus_assign(0, "flag", '{x} > "hello"');
    const run = optilotus_runProgram();
    expect(run.status).toBe("error");
    if (run.status !== "error") return;
    expect(run.kind).toBe("TypeMismatch");
  });
});

describe("engine-level capability limits", () => {
  it("exposes exactly one package per WASM instance", () => {
    // The bridge owns a single global package: a second `main` cannot
    // coexist. This is a documented engine limitation, not a UI bug.
    expect(optilotus_listFunctions().functions).toHaveLength(1);
  });

  it("does not expose a program snapshot or a step-limit setter", () => {
    // Documented engine gaps (verified by the absence of a bridge
    // export): there is no program snapshot/export and no way to set
    // the step limit — the engine always uses `MAX_STEPS`.
    const names = Object.keys(bridgeModule);
    expect(names).not.toContain("optilotus_exportProgram");
    expect(names).not.toContain("optilotus_setStepLimit");
    expect(names).not.toContain("optilotus_runProgramWithLimit");
  });

  it("exposes every engine operation the UI bridge wraps", () => {
    // The bridge exports and the TypeScript wrappers must stay in step:
    // a wrapper without an export would fail at call time, and an
    // export without a wrapper is an engine-only capability.
    const names = Object.keys(bridgeModule);
    for (const expected of [
      "optilotus_version",
      "optilotus_health",
      "optilotus_listFunctions",
      "optilotus_createFunction",
      "optilotus_getFunction",
      "optilotus_deleteFunction",
      "optilotus_renameFunction",
      "optilotus_clearPackage",
      "optilotus_declare",
      "optilotus_declareWithAccess",
      "optilotus_assign",
      "optilotus_print",
      "optilotus_input",
      "optilotus_cast",
      "optilotus_return",
      "optilotus_listCommands",
      "optilotus_setEntry",
      "optilotus_setNext",
      "optilotus_deleteCommand",
      "optilotus_if",
      "optilotus_if_append",
      "optilotus_if_condition",
      "optilotus_if_set_condition",
      "optilotus_runProgram",
      "optilotus_runProgramWithInputs",
      "optilotus_runProgramStart",
      "optilotus_runProgramProvideInput",
      "optilotus_runProgramProvideInputs",
      "optilotus_runProgramProvideInputTyped",
      "optilotus_runProgramStatus",
      "optilotus_runProgramPeekPending",
      "optilotus_runProgramCancel",
      "optilotus_runProgramReset",
      "optilotus_lastError",
      "optilotus_debugMode",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });
});
