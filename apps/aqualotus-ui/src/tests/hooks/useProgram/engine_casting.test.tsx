/**
 * UI hook <-> real engine integration tests: casting through the bridge.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { setup, connectAll, type Api } from "./engine_support";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";
import {
  optilotus_listCommands,
  type CommandSummary,
  type OptilotusType,
} from "../../../lib/optilotus";
import type { CastingInfo } from "../../../lib/casting";
import type { CommandDraft } from "../../../lib/program";

beforeAll(async () => {
  await useRealEngine();
});

beforeEach(() => {
  resetRealEngine();
});

function declareDraft(name: string, init = "1"): CommandDraft {
  return { kind: "declare", name, ty: "int32", init };
}

function declareDraft2(name: string, ty: OptilotusType): CommandDraft {
  return { kind: "declare", name, ty, init: "0" };
}

function ifDraft(condition: string): CommandDraft {
  return { kind: "if", condition, then: [], else: null };
}

function visibleCasting(api: () => Api): CommandSummary & {
  casting?: CastingInfo;
} {
  const command = api().snapshot.commands.find(
    (c) => c.casting !== undefined,
  );
  expect(command).toBeDefined();
  if (command === undefined) throw new Error("no visible casting block");
  return command;
}

function internalNames(): string[] {
  const listed = optilotus_listCommands(0);
  expect(listed.status).toBe("ok");
  if (listed.status !== "ok") return [];
  return listed.commands
    .map((c) => c.var ?? "")
    .filter((name) => name.startsWith("__aqualotus_internal_"));
}

function castingDraft(
  name: string,
  expr: string,
  targetType: OptilotusType,
): CommandDraft {
  return {
    kind: "assign",
    name,
    expr,
    casting: { enabled: true, targetType },
  };
}

function visibleAssign(api: () => Api): {
  id: number;
  casting?: { targetType: string };
} {
  const command = api().snapshot.commands.find((c) => c.kind === "assign");
  expect(command).toBeDefined();
  return command as { id: number; casting?: { targetType: string } };
}

describe("PARITY-013 — assignment with cast executes through the bridge", () => {
  it("creates a hidden conversion group and projects one visible assign", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float64",
        init: "0",
      });
    });
    act(() => {
      api().addCommand(0, castingDraft("f", "{n}", "float64"));
    });

    expect(api().snapshot.actionError).toBe("");
    const assigned = visibleAssign(api);
    expect(assigned.casting?.targetType).toBe("float64");

    const listed = optilotus_listCommands(0);
    if (listed.status !== "ok") return;
    expect(listed.commands.filter((c) => c.kind === "declare")).toHaveLength(3);
    expect(listed.commands.filter((c) => c.kind === "assign")).toHaveLength(1);
  });

  it("executes the conversion and prints the converted value", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float64",
        init: "0",
      });
    });
    act(() => {
      api().addCommand(0, castingDraft("f", "{n}", "float64"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f}"' });
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });

    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["7.0"]);
    expect(api().snapshot.actionError).toBe("");
  });

  it("surfaces the Engine's real runtime conversion failure", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "s",
        ty: "string",
        init: '"abc"',
      });
    });
    act(() => {
      api().addCommand(0, declareDraft("i", "0"));
    });
    act(() => {
      api().addCommand(0, castingDraft("i", "{s}", "int32"));
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });

    const run = api().snapshot.run;
    expect(run?.status).toBe("error");
    if (run?.status !== "error") return;
    expect(run.kind).toBe("TypeMismatch");
    expect(api().snapshot.actionError).toContain("TypeMismatch");
    expect(api().snapshot.error?.detail).toContain(
      'cannot cast string "abc" to integer',
    );
    expect(api().snapshot.errorBlockId).toBeNull();
  });

  it("creates a new converted variable for a cross-type target and executes it", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float64",
        init: "0",
      });
    });
    act(() => {
      api().addCommand(0, castingDraft("f", "{n}", "int32"));
    });

    expect(api().snapshot.actionError).toBe("");
    const converted = visibleCasting(api);
    expect(converted).toMatchObject({
      kind: "cast",
      var: "f_i32",
      ty: "int32",
      expr: "{n}",
      casting: { targetType: "int32" },
    });
    expect(
      api().snapshot.commands.find(
        (c) => c.kind === "declare" && c.var === "f",
      ),
    ).toMatchObject({ ty: "float64", expr: "0" });
    expect(api().snapshot.commands.some((c) => c.kind === "assign")).toBe(false);

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const casts = listed.commands.filter((c) => c.kind === "cast");
    expect(casts).toHaveLength(1);
    expect(casts[0]).toMatchObject({ var: "f_i32", ty: "int32", expr: "{n}" });
    const internal = listed.commands.filter((c) =>
      (c.var ?? "").startsWith("__aqualotus_internal_"),
    );
    expect(internal).toHaveLength(1);
    expect(internal[0]?.var).toBe("__aqualotus_internal_anchor_f_i32");
    expect(
      listed.commands.some((c) => c.kind === "assign" && c.var === "f"),
    ).toBe(false);

    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f_i32}"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f}"' });
    });
    connectAll(api, 0);
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["7", "0.0"]);
  });

  it("gives the converted variable the selected target type (int32 → uint128)", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, declareDraft2("x", "int32"));
    });
    act(() => {
      api().addCommand(0, castingDraft("x", "{n}", "uint128"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x_u128}"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    connectAll(api, 0);

    expect(api().snapshot.actionError).toBe("");
    expect(visibleCasting(api)).toMatchObject({
      kind: "cast",
      var: "x_u128",
      ty: "uint128",
      expr: "{n}",
    });
    expect(
      api().snapshot.commands.find(
        (c) => c.kind === "declare" && c.var === "x",
      ),
    ).toMatchObject({ ty: "int32", expr: "0" });

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["7", "0"]);
  });

  it("surfaces the engine's error for an impossible conversion and keeps the original intact", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "declare", name: "n", ty: "int32", init: "300" });
    });
    act(() => {
      api().addCommand(0, castingDraft("n", "{n}", "int8"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{n_i8}"' });
    });
    connectAll(api, 0);

    expect(visibleCasting(api)).toMatchObject({
      kind: "cast",
      var: "n_i8",
      ty: "int8",
    });

    act(() => {
      api().run();
    });

    const run = api().snapshot.run;
    expect(run?.status).toBe("error");
    if (run?.status !== "error") return;
    expect(run.kind).toBe("TypeMismatch");
    expect(api().snapshot.actionError).toContain("TypeMismatch");
    expect(api().snapshot.error?.detail).toContain("overflow");
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(
      api().snapshot.commands.find(
        (c) => c.kind === "declare" && c.var === "n",
      ),
    ).toMatchObject({ ty: "int32", expr: "300" });
  });

  it("never converts the converted value back into the destination's declared type", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "5"));
    });
    act(() => {
      api().addCommand(0, castingDraft("x", "{x}", "float64"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x_f64}"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    connectAll(api, 0);
    act(() => {
      api().run();
    });

    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["5.0", "5"]);

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const casts = listed.commands.filter((c) => c.kind === "cast");
    expect(casts).toHaveLength(1);
    expect(casts[0]).toMatchObject({
      var: "x_f64",
      ty: "float64",
      expr: "{x}",
    });
    expect(casts.some((c) => c.ty === "int32")).toBe(false);
    expect(
      listed.commands.find((c) => c.kind === "declare" && c.var === "x"),
    ).toMatchObject({ ty: "int32", expr: "5" });
    expect(listed.commands.some((c) => c.kind === "assign")).toBe(false);

    const converted = visibleCasting(api);
    expect(converted).toMatchObject({ kind: "cast", var: "x_f64", ty: "float64" });
    expect(converted.casting?.targetType).toBe("float64");
    expect(converted.casting?.destinationName).toBe("x");
  });

  it("does not create an empty cast when the source expression is empty", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, castingDraft("n", "", "int32"));
    });

    expect(api().snapshot.actionError).toContain(
      "cast expression must not be empty",
    );
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(listed.commands).toHaveLength(1);
    expect(
      listed.commands.some((c) =>
        (c.var ?? "").startsWith("__aqualotus_internal_"),
      ),
    ).toBe(false);
  });

  it("requires a target type and writes nothing for an incomplete draft", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "assign",
        name: "n",
        expr: "{n} + 1",
        casting: { enabled: true, targetType: null },
      });
    });

    expect(api().snapshot.actionError).toContain(
      "Select a target type to complete casting.",
    );
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(listed.commands).toHaveLength(1);
  });

  it("names the converted variable after an undeclared destination", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, castingDraft("ghost", "{n}", "int32"));
    });

    expect(api().snapshot.actionError).toBe("");
    expect(visibleCasting(api)).toMatchObject({
      kind: "cast",
      var: "ghost_i32",
      ty: "int32",
      expr: "{n}",
      casting: { targetType: "int32" },
    });
    expect(internalNames()).toEqual(["__aqualotus_internal_anchor_ghost_i32"]);
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(
      listed.commands.some(
        (c) => (c.var ?? "") === "ghost" && c.kind === "declare",
      ),
    ).toBe(false);
  });

  it("deletes the whole hidden group and restores it through undo/redo", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float64",
        init: "0",
      });
    });
    act(() => {
      api().addCommand(0, castingDraft("f", "{n}", "float64"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f}"' });
    });
    connectAll(api, 0);
    const assignId = visibleAssign(api).id;

    act(() => {
      api().deleteCommand(0, assignId);
    });
    expect(api().snapshot.commands.map((c) => c.kind)).toEqual([
      "declare",
      "declare",
      "print",
    ]);
    let listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(
      listed.commands.some((c) =>
        (c.var ?? "").startsWith("__aqualotus_internal_"),
      ),
    ).toBe(false);

    act(() => {
      api().run();
    });
    let run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status === "ok") expect(run.printed).toEqual(["0.0"]);

    act(() => {
      api().undo();
    });
    const restored = visibleAssign(api);
    expect(restored.casting).toBeDefined();
    expect(restored.casting?.targetType).toBe("float64");
    listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(
      listed.commands.filter((c) =>
        (c.var ?? "").startsWith("__aqualotus_internal_"),
      ),
    ).toHaveLength(2);

    act(() => {
      api().run();
    });
    run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status === "ok") expect(run.printed).toEqual(["7.0"]);

    act(() => {
      api().redo();
    });
    expect(api().snapshot.commands.map((c) => c.kind)).toEqual([
      "declare",
      "declare",
      "print",
    ]);
    listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(
      listed.commands.some((c) =>
        (c.var ?? "").startsWith("__aqualotus_internal_"),
      ),
    ).toBe(false);
  });

  it("deletes and restores a created converted variable through undo/redo without dangling ids", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float64",
        init: "0",
      });
    });
    act(() => {
      api().addCommand(0, castingDraft("f", "{n}", "int32"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f_i32}"' });
    });
    connectAll(api, 0);
    const convertedId = visibleCasting(api).id;
    expect(visibleCasting(api)).toMatchObject({
      kind: "cast",
      var: "f_i32",
      ty: "int32",
    });

    act(() => {
      api().deleteCommand(0, convertedId);
    });
    expect(
      api().snapshot.commands.find((c) => c.kind === "cast"),
    ).toBeUndefined();
    let listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(internalNames()).toHaveLength(0);
    expect(
      listed.commands.find((c) => c.kind === "declare" && c.var === "f"),
    ).toMatchObject({ ty: "float64", expr: "0" });

    act(() => {
      api().undo();
    });
    const restored = visibleCasting(api);
    expect(restored).toMatchObject({
      kind: "cast",
      var: "f_i32",
      ty: "int32",
    });
    expect(restored.casting?.targetType).toBe("int32");
    listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(internalNames()).toHaveLength(1);

    connectAll(api, 0);
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["7"]);

    act(() => {
      api().redo();
    });
    expect(internalNames()).toHaveLength(0);
  });

  it("moves the whole group into an if branch", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float64",
        init: "0",
      });
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "flag",
        ty: "bool",
        init: "true",
      });
    });
    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    act(() => {
      api().addCommand(0, castingDraft("f", "{n}", "float64"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f}"' });
    });

    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    const assignId = visibleAssign(api).id;
    const printId = api().snapshot.commands.find((c) => c.kind === "print")?.id;
    expect(ifId).toBeDefined();
    expect(printId).toBeDefined();
    if (ifId === undefined || printId === undefined) return;

    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", assignId)).toBe(true);
    });
    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", printId)).toBe(true);
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["7.0"]);
  });

  it("turns a casting assignment back into an ordinary assignment", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float64",
        init: "0",
      });
    });
    act(() => {
      api().addCommand(0, castingDraft("f", "{n}", "float64"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f}"' });
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });
    const converted = api().snapshot.run;
    expect(converted?.status).toBe("ok");
    if (converted?.status !== "ok") return;
    expect(converted.printed).toEqual(["7.0"]);

    const assignId = visibleAssign(api).id;
    act(() => {
      api().replaceCommand(0, assignId, {
        kind: "assign",
        name: "f",
        expr: "2.5",
      });
    });

    const ordinary = visibleAssign(api);
    expect(ordinary.casting).toBeUndefined();
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(
      listed.commands.some((c) =>
        (c.var ?? "").startsWith("__aqualotus_internal_"),
      ),
    ).toBe(false);
    expect(
      listed.commands.filter(
        (c) => c.kind === "assign" && c.var === "f",
      ),
    ).toHaveLength(1);
    expect(
      listed.commands.find((c) => c.kind === "assign" && c.var === "f")
        ?.expr,
    ).toBe("2.5");

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["2.5"]);
  });

  it("keeps the user's conversion target when the declaration type changes", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float64",
        init: "0",
      });
    });
    act(() => {
      api().addCommand(0, castingDraft("f", "{n}", "float64"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f}"' });
    });

    connectAll(api, 0);

    expect(visibleCasting(api)).toMatchObject({
      kind: "assign",
      var: "f",
      ty: "float64",
    });

    const fId = api().snapshot.commands.find(
      (c) => c.kind === "declare" && c.var === "f",
    )?.id;
    expect(fId).toBeDefined();
    if (fId === undefined) return;

    act(() => {
      api().replaceCommand(0, fId, {
        kind: "declare",
        name: "f",
        ty: "int64",
        init: "0",
      });
    });

    const converted = visibleCasting(api);
    expect(converted).toMatchObject({
      kind: "cast",
      var: "f_f64",
      ty: "float64",
      expr: "{n}",
    });
    expect(converted.casting?.targetType).toBe("float64");
    expect(converted.casting?.destinationName).toBe("f");

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(
      listed.commands.find((c) => c.kind === "declare" && c.var === "f"),
    ).toMatchObject({ ty: "int64", expr: "0" });
    const casts = listed.commands.filter((c) => c.kind === "cast");
    expect(casts).toHaveLength(1);
    expect(casts[0]).toMatchObject({ var: "f_f64", ty: "float64" });
    expect(
      listed.commands.some((c) => c.kind === "assign" && c.var === "f"),
    ).toBe(false);

    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f_f64}"' });
    });
    connectAll(api, 0);
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["0", "7.0"]);
  });
});
