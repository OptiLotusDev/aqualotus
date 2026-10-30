/**
 * Option B — the converted value lives in a NEW program variable.
 *
 * The Engine's `optilotus_cast` is **declaration-like**: it converts the
 * source value *and* declares the converted variable (its
 * `Compute -> Cast -> Set` group stores the converted value in that
 * variable). Casting therefore keeps the original variable's
 * declaration, type and value untouched and produces a second, real
 * program variable of the selected target type. It never converts the
 * value back into the original variable's declared type, and it never
 * writes the original variable.
 *
 * Every case below drives the shipped WASM artifact through the public
 * bridge and asserts the Engine's own run output, so the semantics are
 * proven at run time rather than in a UI representation. The conversion
 * *matrix* (all 225 ordered pairs) lives in `castMatrix.engine.test.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRealEngine, useRealEngine } from "../../test-support/realEngine";
import {
  optilotus_assign,
  optilotus_cast,
  optilotus_declare,
  optilotus_listCommands,
  optilotus_print,
  optilotus_runProgram,
  type RunResult,
} from "../../lib/optilotus";

beforeAll(async () => {
  await useRealEngine();
});

beforeEach(() => {
  resetRealEngine();
});

/** The engine's own command list, or a hard failure. */
function list() {
  const listed = optilotus_listCommands(0);
  if (listed.status !== "ok") throw new Error("list_commands failed");
  return listed.commands;
}

function run(): RunResult {
  return optilotus_runProgram();
}

/** The printed lines of a successful run. */
function printed(result: RunResult): string[] {
  expect(result.status).toBe("ok");
  return result.status === "ok" ? result.printed : [];
}

describe("Option B — Case 1: int32 5 converted to float64", () => {
  it("creates a new float64 variable holding 5.0 and leaves x an int32 with 5", () => {
    expect(optilotus_declare(0, "x", "int32", "5")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_assign(0, "x", "5")).toMatchObject({ status: "ok" });
    expect(optilotus_cast(0, "x_f64", "float64", "{x}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{x_f64}"')).toMatchObject({ status: "ok" });
    expect(optilotus_print(0, '"{x}"')).toMatchObject({ status: "ok" });

    const commands = list();
    // The original declaration and assignment are untouched: still an
    // `int32` variable `x` assigned `5`.
    expect(commands.find((c) => c.kind === "declare" && c.var === "x")).toMatchObject({
      var: "x",
      ty: "int32",
      expr: "5",
    });
    expect(commands.find((c) => c.kind === "assign" && c.var === "x")).toMatchObject({
      var: "x",
      ty: "int32",
      expr: "5",
    });
    // The conversion is a second, real declaration of the target type.
    expect(commands.find((c) => c.kind === "cast")).toMatchObject({
      var: "x_f64",
      ty: "float64",
      expr: "{x}",
    });
    // Exactly one conversion — no second, hidden "store" leg exists.
    expect(commands.filter((c) => c.kind === "cast")).toHaveLength(1);

    // The real values: 5.0 in the new float64 variable, 5 in the
    // original int32 variable.
    expect(printed(run())).toEqual(["5.0", "5"]);
  });

  it("gives the converted variable a distinct name when the base is taken", () => {
    expect(optilotus_declare(0, "x", "int32", "5")).toMatchObject({
      status: "ok",
    });
    // A user variable already holds the derived name.
    expect(optilotus_declare(0, "x_f64", "float64", "9.5")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_cast(0, "x_f64_2", "float64", "{x}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{x_f64_2}"')).toMatchObject({ status: "ok" });
    expect(optilotus_print(0, '"{x_f64}"')).toMatchObject({ status: "ok" });
    // The existing variable keeps its own value; the conversion lives in
    // the disambiguated one.
    expect(printed(run())).toEqual(["5.0", "9.5"]);
  });
});

describe("Option B — Case 2: float64 converted to int32", () => {
  it("creates a new int32 variable and leaves the float64 variable unchanged", () => {
    expect(optilotus_declare(0, "f", "float64", "2.5")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_cast(0, "f_i32", "int32", "{f}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{f_i32}"')).toMatchObject({ status: "ok" });
    expect(optilotus_print(0, '"{f}"')).toMatchObject({ status: "ok" });

    expect(list().find((c) => c.kind === "cast")).toMatchObject({
      var: "f_i32",
      ty: "int32",
    });
    expect(
      list().find((c) => c.kind === "declare" && c.var === "f"),
    ).toMatchObject({ ty: "float64", expr: "2.5" });

    // 2.5 truncates toward zero; `f` keeps the floating-point value.
    expect(printed(run())).toEqual(["2", "2.5"]);
  });
});

describe("Option B — Case 3: fractional values converted to an integer", () => {
  it("truncates toward zero for 2.75", () => {
    expect(optilotus_declare(0, "f", "float64", "2.75")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_cast(0, "f_i32", "int32", "{f}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{f_i32}"')).toMatchObject({ status: "ok" });
    expect(optilotus_print(0, '"{f}"')).toMatchObject({ status: "ok" });
    expect(printed(run())).toEqual(["2", "2.75"]);
  });

  it("truncates toward zero for -2.75 (not floor)", () => {
    expect(optilotus_declare(0, "f", "float64", "-2.75")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_cast(0, "f_i32", "int32", "{f}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{f_i32}"')).toMatchObject({ status: "ok" });
    expect(optilotus_print(0, '"{f}"')).toMatchObject({ status: "ok" });
    expect(printed(run())).toEqual(["-2", "-2.75"]);
  });

  it("keeps the converted variable's declared type int32 for a whole float64", () => {
    expect(optilotus_declare(0, "f", "float64", "7.0")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_cast(0, "f_i32", "int32", "{f}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{f_i32}"')).toMatchObject({ status: "ok" });
    // An int32 value renders without a decimal point: the target type is
    // real, not a display of the float64 source.
    expect(printed(run())).toEqual(["7"]);
  });
});

describe("Option B — Case 4: invalid conversions", () => {
  it("fails at run time with the engine's own error and stores nothing", () => {
    expect(optilotus_declare(0, "s", "string", "abc")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_declare(0, "n", "int32", "7")).toMatchObject({
      status: "ok",
    });
    // The builder accepts the conversion (it is a legal type pair); the
    // value is what the engine can only reject at run time.
    expect(optilotus_cast(0, "n_i32", "int32", "{s}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{n_i32}"')).toMatchObject({ status: "ok" });

    const result = run();
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.kind).toBe("TypeMismatch");
    expect(result.detail).toContain('cannot cast string "abc" to integer');
    // The run aborts at the conversion itself, so the print of the
    // converted variable never runs and no converted value is produced.
    expect(typeof result.command).toBe("number");
    // The converted variable exists only as the cast's own declaration:
    // nothing else in the program stores into it.
    const commands = list();
    expect(commands.find((c) => c.kind === "cast")).toMatchObject({
      var: "n_i32",
      ty: "int32",
    });
    expect(
      commands.some((c) => c.kind === "assign" && c.var === "n_i32"),
    ).toBe(false);
    // The original variable is untouched by the failed conversion.
    expect(
      commands.find((c) => c.kind === "declare" && c.var === "n"),
    ).toMatchObject({ ty: "int32", expr: "7" });
  });

  it("stores the converted value only when the conversion succeeds", () => {
    // The same program with a parsable source: the converted variable
    // holds the converted value, and the original variable still holds
    // (and prints) its own value.
    expect(optilotus_declare(0, "s", "string", "12")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_declare(0, "n", "int32", "7")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_cast(0, "n_i32", "int32", "{s}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{n_i32}"')).toMatchObject({ status: "ok" });
    expect(optilotus_print(0, '"{n}"')).toMatchObject({ status: "ok" });

    expect(
      list().find((c) => c.kind === "declare" && c.var === "n"),
    ).toMatchObject({ ty: "int32", expr: "7" });
    expect(printed(run())).toEqual(["12", "7"]);
  });

  it("rejects an out-of-range conversion without touching the source", () => {
    expect(optilotus_declare(0, "n", "int32", "300")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_cast(0, "n_i8", "int8", "{n}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{n_i8}"')).toMatchObject({ status: "ok" });

    const result = run();
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.kind).toBe("TypeMismatch");
    expect(result.detail).toContain("overflow");
    // The source variable is still an int32 holding 300.
    expect(
      list().find((c) => c.kind === "declare" && c.var === "n"),
    ).toMatchObject({ ty: "int32", expr: "300" });
  });
});

describe("Option B — the converted value is never converted back", () => {
  it("does not add a second conversion into the original's declared type", () => {
    expect(optilotus_declare(0, "x", "int32", "5")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_cast(0, "x_f64", "float64", "{x}")).toMatchObject({
      status: "ok",
    });
    expect(optilotus_print(0, '"{x_f64}"')).toMatchObject({ status: "ok" });
    expect(optilotus_print(0, '"{x}"')).toMatchObject({ status: "ok" });

    const commands = list();
    // One conversion, into the target type. No conversion into `int32`
    // (the original's declared type) exists anywhere in the program.
    const casts = commands.filter((c) => c.kind === "cast");
    expect(casts).toHaveLength(1);
    expect(casts[0]?.ty).toBe("float64");
    expect(commands.some((c) => c.ty === "int32" && c.kind === "cast")).toBe(
      false,
    );
    // Nothing is stored into `x` beyond the assignment the user wrote.
    expect(
      commands.filter((c) => c.kind === "assign" && c.var === "x"),
    ).toHaveLength(0);

    // The target-typed value is observable: the same source prints as
    // `5.0` through the converted variable and as `5` through `x`. Had
    // the value been converted back into `x`'s int32 declaration, the
    // converted variable could not exist at all.
    expect(printed(run())).toEqual(["5.0", "5"]);
  });
});
