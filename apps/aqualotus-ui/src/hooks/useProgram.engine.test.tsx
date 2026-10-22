/**
 * UI hook ↔ real engine integration tests.
 *
 * `useProgram` is the UI's only writer to the engine. These tests run
 * it against the **real** Optilotus WASM artifact: every assertion
 * checks the engine's own state (`list_commands`, `get_function`,
 * `run_program`), not a mock's echo of what the UI sent.
 *
 * The `describe` blocks name the `PARITY-xxx` ids from
 * `docs/feature-parity-audit.md`.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resetRealEngine, useRealEngine } from "../test-support/realEngine";
import {
  optilotus_getFunction,
  optilotus_listCommands,
  optilotus_listFunctions,
  optilotus_runProgram,
  type CommandSpec,
} from "../lib/optilotus";
import { planChainAll } from "../lib/graph";
import type { CommandDraft } from "../lib/program";
import { useProgram } from "./useProgram";

let seq = 0;
function issueSeq(): number {
  seq += 1;
  return seq;
}

/** A print body spec in the exact shape the UI sends. */
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
  seq = 0;
});

type Api = ReturnType<typeof useProgram>;

/** Mount the hook and let its initial projection load settle. */
async function setup(): Promise<{ result: { current: Api } }> {
  const view = renderHook(() => useProgram(true, issueSeq));
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

/**
 * Connect every block of a function head-to-tail, exactly like the
 * canvas' "Connect blocks in order" action does.
 */
function connectAll(api: () => Api, fid: number): void {
  const cmds = api().snapshot.commands.map((c) => ({
    id: c.id,
    next: c.next ?? null,
    then_body: c.then_body,
    else_body: c.else_body,
  }));
  const entry = api().snapshot.selected?.entry ?? null;
  const plan = planChainAll(cmds, entry);
  if (plan === null) return;
  act(() => {
    api().applyLinks(fid, plan);
  });
}

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

    // The engine really holds the declaration.
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
    // Nothing was created in the engine.
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

describe("PARITY-022 — the UI run path produces the engine's output", () => {
  it("shows the printed output of a real run", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "41"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: "{n} + 1" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{n}"' });
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });

    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["42"]);
    expect(run.prints).toBe(1);
    expect(api().snapshot.actionError).toBe("");
  });

  it("surfaces a typed engine error and attributes it to no block", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: '"{n}"' });
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
    // The engine reports a raw command id, so the UI has no block to
    // point at (see the audit report, PARITY-022).
    expect(api().snapshot.commandErrorId).toBe(run.command);
  });
});

describe("PARITY-015 — linking blocks reaches the engine", () => {
  it("chains the blocks so the engine runs them in order", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "7"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{n}"' });
    });
    connectAll(api, 0);

    const info = optilotus_getFunction(0);
    expect(info.status).toBe("ok");
    if (info.status !== "ok") return;
    expect(info.entry).not.toBeNull();

    const run = optilotus_runProgram();
    expect(run.status).toBe("ok");
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["7"]);
  });
});

describe("PARITY-018/019/020 — conditional blocks through the UI", () => {
  it("runs the branch of an `if` the user connected", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "if",
        condition: "{x} > 5",
        then: [printSpec('"big"')],
        else: [printSpec('"small"')],
      });
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });

    // Regression: rewiring a block to an `if` used to orphan the
    // engine's hidden condition compute, and the run failed with
    // "missing value N at M".
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["big"]);
  });

  it("edits the condition of an `if` and the other branch runs", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, {
        kind: "if",
        condition: "{x} > 5",
        then: [printSpec('"big"')],
        else: [printSpec('"small"')],
      });
    });
    connectAll(api, 0);
    act(() => {
      api().run();
    });
    expect(api().snapshot.run?.status).toBe("ok");

    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;

    // The inspector reads the condition the engine holds.
    expect(api().ifConditionText(0, ifId)).toBe("{x} > 5");

    act(() => {
      api().replaceCommand(0, ifId, {
        kind: "if",
        condition: "{x} > 50",
        then: [],
        else: null,
      });
    });
    expect(api().snapshot.actionError).toBe("");
    expect(api().ifConditionText(0, ifId)).toBe("{x} > 50");

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["small"]);
  });

  it("wires a block into a branch port and the branch runs it", async () => {
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

    act(() => {
      api().addCommand(0, { kind: "print", template: '"in branch"' });
    });
    const printId = api().snapshot.commands.find((c) => c.kind === "print")
      ?.id;
    expect(printId).toBeDefined();
    if (printId === undefined) return;

    let appended = false;
    act(() => {
      appended = api().applyIfAppend(0, ifId, "then", printId);
    });
    expect(appended).toBe(true);
    expect(api().snapshot.actionError).toBe("");

    // The engine put the print into the `then` branch.
    const listed = optilotus_listCommands(0);
    if (listed.status !== "ok") return;
    const ifCommand = listed.commands.find((c) => c.id === ifId);
    expect(ifCommand?.then_body).toContain(printId);

    connectAll(api, 0);
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["in branch"]);
  });
});

describe("PARITY-004/003 — function lifecycle through the UI", () => {
  it("creates, renames and deletes a helper in the engine", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().createFunction("helper");
    });
    expect(api().snapshot.functions.map((f) => f.name)).toEqual([
      "main",
      "helper",
    ]);
    const helper = api().snapshot.functions.find((f) => f.name === "helper");
    expect(helper).toBeDefined();
    if (helper === undefined) return;

    act(() => {
      api().renameFunction(helper.id, "worker");
    });
    expect(api().snapshot.actionError).toBe("");
    const listed = optilotus_listFunctions();
    expect(listed.functions.map((f) => f.name)).toEqual(["main", "worker"]);

    act(() => {
      api().deleteFunction(helper.id);
    });
    expect(optilotus_listFunctions().functions.map((f) => f.name)).toEqual([
      "main",
    ]);
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
});

describe("PARITY-009 — editing a block through the UI", () => {
  it("changes a declare's type in the engine and rebuilds its assigns", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "x", expr: "{x} + 1" });
    });
    connectAll(api, 0);

    const declareId = api().snapshot.commands.find((c) => c.kind === "declare")
      ?.id;
    expect(declareId).toBeDefined();
    if (declareId === undefined) return;

    act(() => {
      api().replaceCommand(0, declareId, {
        kind: "declare",
        name: "x",
        ty: "float64",
        init: "1.5",
      });
    });
    expect(api().snapshot.actionError).toBe("");

    const listed = optilotus_listCommands(0);
    if (listed.status !== "ok") return;
    expect(listed.commands[0]).toMatchObject({ kind: "declare", ty: "float64" });
    // The dependent assign was rebuilt so its baked-in type follows.
    expect(listed.commands[1]).toMatchObject({ kind: "assign", var: "x" });
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

describe("PARITY-039 — undo/redo against the real engine", () => {
  it("restores a deleted block in the engine", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"hi"' });
    });
    connectAll(api, 0);

    const printId = api().snapshot.commands.find((c) => c.kind === "print")?.id;
    expect(printId).toBeDefined();
    if (printId === undefined) return;

    act(() => {
      api().deleteCommand(0, printId);
    });
    const afterDelete = optilotus_listCommands(0);
    expect(afterDelete.status).toBe("ok");
    if (afterDelete.status !== "ok") return;
    expect(afterDelete.commands).toHaveLength(1);

    act(() => {
      api().undo();
    });
    const listed = optilotus_listCommands(0);
    if (listed.status !== "ok") return;
    expect(listed.commands).toHaveLength(2);

    act(() => {
      api().redo();
    });
    const after = optilotus_listCommands(0);
    if (after.status !== "ok") return;
    expect(after.commands).toHaveLength(1);
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
