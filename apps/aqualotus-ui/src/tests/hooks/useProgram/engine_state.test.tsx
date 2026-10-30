/**
 * UI hook <-> real engine integration tests: program state, selection,
 * and function lifecycle.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { setup, type Api } from "./engine_support";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";
import {
  optilotus_listCommands,
  optilotus_listFunctions,
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

describe("PARITY-007 — adding a block reaches the engine", () => {
  it("creates a declare in the engine and shows it in the projection", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "41"));
    });

    expect(api().snapshot.actionError).toBe("");
    expect(api().snapshot.commands).toHaveLength(1);

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(listed.commands).toHaveLength(1);
    expect(listed.commands[0]).toMatchObject({
      kind: "declare",
      var: "x",
      ty: "int32",
      expr: "41",
    });
  });

  it("keeps the user's block when the engine rejects it", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "assign", name: "ghost", expr: "{ghost}" });
    });

    expect(api().snapshot.actionError).not.toBe("");
    expect(api().snapshot.recoveryVar).toBe("ghost");
    const listed = optilotus_listCommands(0);
    if (listed.status !== "ok") return;
    expect(listed.commands).toHaveLength(0);
  });

  it("recovers by declaring the missing variable and retrying", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "assign", name: "ghost", expr: "{ghost}" });
    });
    act(() => {
      api().declareVariable(0, "ghost");
    });
    expect(api().snapshot.actionError).toBe("");
    act(() => {
      api().addCommand(0, { kind: "assign", name: "ghost", expr: "{ghost}" });
    });
    expect(api().snapshot.actionError).toBe("");
    const listed = optilotus_listCommands(0);
    if (listed.status !== "ok") return;
    expect(listed.commands.map((c) => c.kind)).toEqual(["declare", "assign"]);
  });
});

describe("PARITY-004/003 — function lifecycle through the UI", () => {
  it("creates a function and lists it", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().createFunction("helper");
    });

    expect(api().snapshot.actionError).toBe("");
    const functions = api().snapshot.functions;
    expect(functions.some((f) => f.name === "helper")).toBe(true);
    const helper = functions.find((f) => f.name === "helper");
    expect(helper).toBeDefined();

    const listed = optilotus_listFunctions();
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(listed.functions.some((f) => f.name === "helper")).toBe(true);
  });

  it("renames a function", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().createFunction("old");
    });
    const oldFn = api().snapshot.functions.find((f) => f.name === "old");
    expect(oldFn).toBeDefined();
    if (oldFn === undefined) return;
    act(() => {
      api().renameFunction(oldFn.id, "new");
    });

    const renamed = api().snapshot.functions.find((f) => f.name === "new");
    expect(renamed).toBeDefined();
  });

  it("deletes a function", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().createFunction("tmp");
    });
    const tmpFn = api().snapshot.functions.find((f) => f.name === "tmp");
    expect(tmpFn).toBeDefined();
    if (tmpFn === undefined) return;
    act(() => {
      api().deleteFunction(tmpFn.id);
    });

    expect(api().snapshot.functions.find((f) => f.name === "tmp")).toBeUndefined();
  });

  it("restores a deleted function through undo", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().createFunction("helper");
    });
    const helper = api().snapshot.functions.find((f) => f.name === "helper");
    if (helper === undefined) throw new Error("helper not created");

    act(() => {
      api().deleteFunction(helper.id);
    });
    expect(optilotus_listFunctions().functions).toHaveLength(1);

    act(() => {
      api().undo();
    });
    expect(optilotus_listFunctions().functions.map((f) => f.name)).toEqual([
      "main",
      "helper",
    ]);
  });

  it("selects a function", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().createFunction("one");
    });
    act(() => {
      api().createFunction("two");
    });
    const fid = api().snapshot.functions[0].id;
    act(() => {
      api().selectFunction(fid);
    });

    expect(api().snapshot.selectedId).toBe(fid);
  });
});
