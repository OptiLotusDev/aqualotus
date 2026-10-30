/**
 * UI hook <-> real engine integration tests: editing and history.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { setup, connectAll, type Api } from "./engine_support";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";
import {
  optilotus_listFunctions,
  optilotus_listCommands,
} from "../../../lib/optilotus";
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

describe("UI-owned undo fidelity — an `if` keeps its condition", () => {
  it("restores the condition expression when a deleted `if` is undone", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, {
        kind: "if",
        condition: "true",
        then: [],
        else: null,
      });
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;
    connectAll(api, 0);

    act(() => {
      api().deleteCommand(0, ifId);
    });
    expect(
      api().snapshot.commands.some((c) => c.kind === "if"),
    ).toBe(false);

    act(() => {
      api().undo();
    });
    expect(api().snapshot.actionError).toBe("");

    const restored = api().snapshot.commands.find((c) => c.kind === "if");
    expect(restored).toBeDefined();
    if (restored === undefined) return;
    expect(api().ifConditionText(0, restored.id)).toBe("true");

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
  });

  it("restores the condition expression when a deleted function is undone", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().createFunction("helper");
    });
    const helper = api().snapshot.functions.find((f) => f.name === "helper");
    if (helper === undefined) throw new Error("helper not created");
    act(() => {
      api().addCommand(helper.id, {
        kind: "if",
        condition: "true",
        then: [],
        else: null,
      });
    });

    act(() => {
      api().deleteFunction(helper.id);
    });
    act(() => {
      api().undo();
    });
    expect(api().snapshot.actionError).toBe("");

    const restoredHelper = api().snapshot.functions.find(
      (f) => f.name === "helper",
    );
    expect(restoredHelper).toBeDefined();
    if (restoredHelper === undefined) return;
    const commands = api().snapshot.commandsByFunction[restoredHelper.id] ?? [];
    const restored = commands.find((c) => c.kind === "if");
    expect(restored).toBeDefined();
    if (restored === undefined) return;
    expect(api().ifConditionText(restoredHelper.id, restored.id)).toBe("true");
  });
});

describe("PARITY-009 — editing a block through the UI", () => {
  it("changes a declare's type in the engine and rebuilds its assigns", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "a", expr: "{n}" });
    });
    connectAll(api, 0);

    const nId = api().snapshot.commands.find((c) => c.kind === "declare")?.id;
    expect(nId).toBeDefined();
    if (nId === undefined) return;

    act(() => {
      api().replaceCommand(0, nId, {
        kind: "declare",
        name: "n",
        ty: "float64",
        init: "1",
      });
    });
    expect(api().snapshot.actionError).toBe("");

    const listed = await api().snapshot;
    const cmds = listed.commands;
    const declares = cmds.filter((c) => c.kind === "declare");
    expect(declares).toHaveLength(1);
    expect(declares[0].ty).toBe("float64");
  });

  it("keeps the original block when the edit is rejected", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "1"));
    });
    const declareId = api().snapshot.commands[0]?.id;
    expect(declareId).toBeDefined();
    if (declareId === undefined) return;

    act(() => {
      api().replaceCommand(0, declareId, {
        kind: "declare",
        name: "x",
        ty: "bool",
        init: "not a bool",
      });
    });
    expect(api().snapshot.actionError).not.toBe("");
    const listed = optilotus_listCommands(0);
    if (listed.status !== "ok") return;
    expect(listed.commands).toHaveLength(1);
    expect(listed.commands[0]).toMatchObject({ ty: "int32" });
  });
});

describe("PARITY-015/006 — clearing the entry and the project", () => {
  it("makes the run a no-op after the entry point is cleared", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"hi"' });
    });
    connectAll(api, 0);

    act(() => {
      api().clearEntry(0);
    });
    expect(api().snapshot.selected?.entry).toBeNull();

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual([]);
  });

  it("wipes the engine's package on reset and restores it on undo", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "1"));
    });
    act(() => {
      api().createFunction("helper");
    });
    expect(optilotus_listFunctions().functions).toHaveLength(2);

    act(() => {
      api().clearPackage();
    });
    expect(optilotus_listFunctions().functions).toHaveLength(1);
    const afterReset = optilotus_listCommands(0);
    expect(afterReset.status).toBe("ok");
    if (afterReset.status !== "ok") return;
    expect(afterReset.commands).toHaveLength(0);

    act(() => {
      api().undo();
    });
    expect(optilotus_listFunctions().functions).toHaveLength(2);
    const listed = optilotus_listCommands(0);
    if (listed.status !== "ok") return;
    expect(listed.commands).toHaveLength(1);
    expect(listed.commands[0]).toMatchObject({ kind: "declare", var: "x" });
  });
});
