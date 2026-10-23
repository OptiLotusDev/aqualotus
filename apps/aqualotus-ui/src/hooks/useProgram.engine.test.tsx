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
  optilotus_deleteCommand,
  optilotus_getFunction,
  optilotus_listCommands,
  optilotus_listFunctions,
  optilotus_runProgram,
  type CommandSpec,
} from "../lib/optilotus";
import { planChainAll, planDropLink, edgesOf, mergeEdgesOf } from "../lib/graph";
import type { CommandDraft } from "../lib/program";
import type { CommandSummary, OptilotusType } from "../lib/optilotus";
import type { CastingInfo } from "../lib/casting";
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
  const entry = api().snapshot.entry;
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
    // The engine's id is kept verbatim — it is an internal node id, not
    // a block id (see the audit report, PARITY-022).
    expect(api().snapshot.error?.command).toBe(run.command);
    // This failure happened on the assign's hidden `Set` node, which no
    // visible block owns: the UI must not point at a block.
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
  });
});

/**
 * TASK-003 — a runtime failure must reach the visible block it belongs
 * to.
 *
 * The engine reports the id of the **internal IR node** that failed. A
 * node is the one a visible block owns only for some block kinds (an
 * `assign`'s compute, an `input`, a `return`, an `if`); for the others
 * (a `print`'s hidden print node, a `declare`/`assign`'s hidden `Set`
 * node) the failing node belongs to no visible block and the UI has
 * nothing to point at.
 *
 * These are **integration** tests: they run the real engine through the
 * real bridge and read the engine's own state.
 */
describe("TASK-003 — runtime failures map to the visible block", () => {
  /** The visible block of a kind in the selected function. */
  function blockOf(api: () => Api, kind: string): number {
    const cmd = api().snapshot.commands.find((c) => c.kind === kind);
    if (cmd === undefined) {
      throw new Error(`no ${kind} block in the projection`);
    }
    return cmd.id;
  }

  it("A — a print failure keeps its type, message and fields, and names no block", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{ghost}"' });
    });
    connectAll(api, 0);
    const printId = blockOf(api, "print");
    act(() => {
      api().run();
    });

    // The failure is preserved as the engine reported it.
    const error = api().snapshot.error;
    expect(error?.kind).toBe("UnknownVariable");
    expect(error?.message).toContain('unknown variable "ghost"');
    expect(error?.var).toBe("ghost");
    expect(api().snapshot.actionError).toContain("UnknownVariable");

    // The engine blamed the print's hidden node, which no visible block
    // owns: the UI names no block rather than the wrong one.
    expect(error?.command).not.toBe(printId);
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
  });

  it("B — an assign failure resolves to the assign block", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: "{ghost}" });
    });
    connectAll(api, 0);
    const assignId = blockOf(api, "assign");
    act(() => {
      api().run();
    });

    // The expression is evaluated by the assign's own compute node —
    // the node the visible block owns — so the failure belongs to that
    // block and the UI can point at it.
    const error = api().snapshot.error;
    expect(error?.kind).toBe("UnknownVariable");
    expect(error?.message).toContain('unknown variable "ghost"');
    expect(error?.var).toBe("ghost");
    expect(error?.command).toBe(assignId);
    expect(api().snapshot.errorBlockId).toBe(assignId);
    expect(api().snapshot.errorFunctionId).toBe(0);
  });

  it("B — an assign type failure on the hidden store names no block", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: '"{n}"' });
    });
    connectAll(api, 0);
    const assignId = blockOf(api, "assign");
    act(() => {
      api().run();
    });

    // The store type is checked on the assign's hidden `Set` node: the
    // failure is real and fully preserved, but no visible block owns
    // the node, so the UI points at nothing.
    const error = api().snapshot.error;
    expect(error?.kind).toBe("TypeMismatch");
    expect(error?.detail).toContain("declared as int32 but got string");
    expect(error?.command).not.toBe(assignId);
    expect(api().snapshot.errorBlockId).toBeNull();
  });

  it("C — a cast failure resolves to the cast block", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "cast", name: "c", to: "bool", expr: "{n}" });
    });
    connectAll(api, 0);
    const castId = blockOf(api, "cast");
    act(() => {
      api().run();
    });

    // The engine blamed the cast's own node (the store that reads the
    // cast's result), which is the node the visible cast block owns:
    // the failure belongs to that block.
    //
    // Note: the failure itself is a `MissingValue`, because the engine
    // wires a cast's *compute* node into the chain while the canvas
    // links the cast's visible id (its store). The engine reports no
    // way to reach the compute node — an upstream gap, documented in
    // the task report — but it does not affect the mapping under test.
    const error = api().snapshot.error;
    expect(error?.kind).toBe("MissingValue");
    expect(error?.value).toBeTypeOf("number");
    expect(error?.command).toBe(castId);
    expect(api().snapshot.errorBlockId).toBe(castId);
    expect(api().snapshot.errorFunctionId).toBe(0);
  });

  it("D — an input failure resolves to the input block", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "input", ty: "int32" });
    });
    connectAll(api, 0);
    const inputId = blockOf(api, "input");
    act(() => {
      api().run();
    });

    // The input node is the block: the failure belongs to it.
    const error = api().snapshot.error;
    expect(error?.kind).toBe("InputEof");
    expect(error?.command).toBe(inputId);
    expect(api().snapshot.errorBlockId).toBe(inputId);
    expect(api().snapshot.errorFunctionId).toBe(0);
  });

  it("E — a failure inside a helper resolves to the block inside the helper", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().createFunction("helper");
    });
    const helperId = api().snapshot.functions.find(
      (f) => f.name === "helper",
    )?.id;
    expect(helperId).toBeTypeOf("number");
    if (helperId === undefined) return;

    act(() => {
      api().addCommand(helperId, declareDraft("r", "1"));
    });
    act(() => {
      api().addCommand(helperId, {
        kind: "assign",
        name: "r",
        expr: "{ghost}",
      });
    });
    connectAll(api, helperId);
    const helperAssignId = api().snapshot.commandsByFunction[helperId]?.find(
      (c) => c.kind === "assign",
    )?.id;

    act(() => {
      api().addCommand(0, declareDraft("res", "0"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "res", expr: "helper()" });
    });
    connectAll(api, 0);
    act(() => {
      api().run();
    });

    // The engine propagates the callee's own failure, with the
    // callee's node id: the failure belongs to the helper's assign
    // block, and the UI points at it — in the helper, not in `main`.
    const error = api().snapshot.error;
    expect(error?.kind).toBe("UnknownVariable");
    expect(error?.var).toBe("ghost");
    expect(error?.command).toBe(helperAssignId);
    expect(api().snapshot.errorBlockId).toBe(helperAssignId);
    expect(api().snapshot.errorFunctionId).toBe(helperId);
  });

  it("F — an unmappable failure keeps every field and names no block", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{ghost}"' });
    });
    connectAll(api, 0);
    act(() => {
      api().run();
    });

    const error = api().snapshot.error;
    // Nothing is dropped on the way to the screen: the family, the
    // message and the kind-specific field all survive.
    expect(error).not.toBeNull();
    expect(error?.status).toBe("error");
    expect(error?.kind).toBe("UnknownVariable");
    expect(error?.message).toContain('unknown variable "ghost"');
    expect(error?.message).toContain(`at ${String(error?.command)}`);
    expect(error?.var).toBe("ghost");
    expect(error?.command).toBeTypeOf("number");
    // …and no block is invented for it.
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
  });

  it("G — a block that disappears loses the target, the failure stays", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: "{ghost}" });
    });
    connectAll(api, 0);
    const assignId = blockOf(api, "assign");
    act(() => {
      api().run();
    });
    expect(api().snapshot.errorBlockId).toBe(assignId);

    // The block is removed behind the UI's back (an undo recreates the
    // program with fresh ids): the failure survives the reload, but the
    // target must not point at a block that is no longer there.
    const removed = optilotus_deleteCommand(0, assignId);
    expect(removed.status).toBe("ok");
    act(() => {
      api().refresh();
    });
    expect(api().snapshot.error).not.toBeNull();
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
  });

  it("a later run does not keep the earlier failure's target", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: "{ghost}" });
    });
    connectAll(api, 0);
    const assignId = blockOf(api, "assign");
    act(() => {
      api().run();
    });
    expect(api().snapshot.errorBlockId).toBe(assignId);

    // The assign is replaced by a print that fails the same way — on a
    // hidden node this time. The new run must not keep the old target.
    act(() => {
      api().deleteCommand(0, assignId);
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{ghost}"' });
    });
    connectAll(api, 0);
    act(() => {
      api().run();
    });
    expect(api().snapshot.error?.kind).toBe("UnknownVariable");
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
  });

  it("a successful run clears the failure and its target", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: "{ghost}" });
    });
    connectAll(api, 0);
    const assignId = blockOf(api, "assign");
    act(() => {
      api().run();
    });
    expect(api().snapshot.errorBlockId).toBe(assignId);

    // The program is fixed: the next run succeeds, so neither the
    // failure nor its target may survive it.
    act(() => {
      api().replaceCommand(0, assignId, {
        kind: "assign",
        name: "n",
        expr: "{n} + 1",
      });
    });
    connectAll(api, 0);
    act(() => {
      api().run();
    });
    expect(api().snapshot.run?.status).toBe("ok");
    expect(api().snapshot.error).toBeNull();
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
    expect(api().snapshot.actionError).toBe("");
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

describe("UI-owned drop semantics — the runtime runs one chain", () => {
  it("runs a block dropped onto an occupied in-port", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "print", template: '"A"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"B"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"C"' });
    });
    const aId = api().snapshot.commands[0]?.id;
    const bId = api().snapshot.commands[1]?.id;
    const cId = api().snapshot.commands[2]?.id;
    expect(aId).toBeDefined();
    expect(bId).toBeDefined();
    expect(cId).toBeDefined();
    if (aId === undefined || bId === undefined || cId === undefined) return;

    // The chain is A → C; B is detached.
    act(() => {
      api().applyLinks(0, {
        edits: [{ id: aId, next: cId }],
        entry: { type: "set", entry: aId },
      });
    });

    // B's out-port is dropped on C's in-port (an occupied port).
    const cmds = api().snapshot.commands.map((c) => ({
      id: c.id,
      next: c.next ?? null,
    }));
    const plan = planDropLink(cmds, aId, bId, cId, "before");
    expect(plan).not.toBeNull();
    if (plan === null) return;
    act(() => {
      api().applyLinks(0, plan);
    });
    expect(api().snapshot.actionError).toBe("");

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    // Regression: the drop used to grow a second incoming wire, and the
    // runtime (one linear chain) never reached the dropped block.
    expect(run.printed).toEqual(["A", "B", "C"]);
  });
});

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

    // The engine holds the condition the user wrote again — not the
    // raw `ValueId` the summary carries (which would restore an `if`
    // whose condition is a number and break the program).
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

    // The restored helper carries the `if` with its original condition.
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

/**
 * The `if` gap (audit F-1, UI half).
 *
 * The engine stores an `if`'s condition in a **hidden compute command**
 * that must run right before the `if`. That compute is not a user
 * command, so the engine's user-level `next` edge cannot express "block
 * X is followed by an `if`" (`Package::user_next` reports `None` when
 * the raw successor is not a user command). The engine cannot be
 * changed from here, so the UI remembers the connections it planned and
 * the engine accepted, and keeps them apart from the confirmed ones.
 *
 * These tests drive the **real** engine: every assertion about the
 * program state reads the engine's own summary, not a mock.
 */
describe("The `if` gap — the connection the engine cannot report", () => {
  /** An `if` with the given condition and an empty branch. */
  function ifDraft(condition: string): CommandDraft {
    return { kind: "if", condition, then: [], else: null };
  }

  it("Case A — runs an `if` that is the first block of the program", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;

    connectAll(api, 0);

    // The engine's own entry points at the `if`'s hidden condition
    // compute — a raw id that names no block at all.
    const info = optilotus_getFunction(0);
    expect(info.status).toBe("ok");
    if (info.status !== "ok") return;
    expect(info.entry).not.toBe(ifId);
    expect(
      api().snapshot.commands.some((c) => c.id === info.entry),
    ).toBe(false);

    // The UI names the block the chain really starts at, so nothing is
    // anchored at the hidden compute.
    expect(api().snapshot.entry).toBe(ifId);
    const edges = edgesOf(api().snapshot.commands);
    for (const edge of edges) {
      expect(edge.from).not.toBe(info.entry);
      expect(edge.to).not.toBe(info.entry);
    }

    // The condition survived and the branch runs.
    expect(api().ifConditionText(0, ifId)).toBe("true");
    act(() => {
      api().run();
    });
    expect(api().snapshot.run?.status).toBe("ok");
  });

  it("Case B — shows the connection into an `if` the engine hides", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, ifDraft("{x} > 5"));
    });
    connectAll(api, 0);

    const commands = api().snapshot.commands;
    const declare = commands.find((c) => c.kind === "declare");
    const ifCommand = commands.find((c) => c.kind === "if");
    expect(declare).toBeDefined();
    expect(ifCommand).toBeDefined();
    if (declare === undefined || ifCommand === undefined) return;

    // The engine reports no successor for the block before the `if`:
    // the hidden compute sits between them.
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const engineDeclare = listed.commands.find((c) => c.id === declare.id);
    expect(engineDeclare?.next ?? null).toBeNull();

    // The UI's graph model knows the connection and marks it as
    // planned, so it is never presented as an engine-confirmed edge.
    expect(declare.next).toBe(ifCommand.id);
    expect(declare.planned).toBe(true);
    expect(edgesOf(commands)).toContainEqual({
      from: declare.id,
      to: ifCommand.id,
      branch: null,
      planned: true,
    });

    // The program really runs the `if` after the declaration.
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual([]);
    expect(run.steps).toBeGreaterThan(0);
  });

  it("Case C — keeps the connection when the condition is edited", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, ifDraft("{x} > 5"));
    });
    connectAll(api, 0);
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;

    act(() => {
      api().replaceCommand(0, ifId, {
        kind: "if",
        condition: "{x} > 50",
        then: [],
        else: null,
      });
    });
    expect(api().snapshot.actionError).toBe("");

    // The condition changed exactly once — no duplicate, no loss.
    expect(api().ifConditionText(0, ifId)).toBe("{x} > 50");
    const commands = api().snapshot.commands;
    const declare = commands.find((c) => c.kind === "declare");
    const ifCommand = commands.find((c) => c.id === ifId);
    expect(declare?.next).toBe(ifId);
    expect(ifCommand?.next).toBeNull();

    // The program still runs: the chain is intact.
    act(() => {
      api().run();
    });
    expect(api().snapshot.run?.status).toBe("ok");
  });

  it("Case D — wires blocks into both branches, never across", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, {
        kind: "if",
        condition: "true",
        then: [
          {
            kind: "print",
            var: null,
            ty: null,
            access: null,
            init: null,
            expr: null,
            template: '"staged"',
            to: null,
          },
        ],
        else: null,
      });
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;

    act(() => {
      api().addCommand(0, { kind: "print", template: '"then"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"else"' });
    });
    const prints = api()
      .snapshot.commands.filter((c) => c.kind === "print")
      .map((c) => c.id);
    expect(prints.length).toBe(2);
    const thenId = prints[0] as number;
    const elseId = prints[1] as number;

    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", thenId)).toBe(true);
    });
    act(() => {
      expect(api().applyIfAppend(0, ifId, "else", elseId)).toBe(true);
    });
    expect(api().snapshot.actionError).toBe("");

    // Membership: each branch holds its own block only.
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const ifCommand = listed.commands.find((c) => c.id === ifId);
    expect(ifCommand?.then_body).toContain(thenId);
    expect(ifCommand?.then_body ?? []).not.toContain(elseId);
    expect(ifCommand?.else_body).toContain(elseId);
    expect(ifCommand?.else_body ?? []).not.toContain(thenId);

    // The branch wires start at the first *visible* member of the
    // branch: the staged body the `if` was created with is a hidden raw
    // node and must not be the anchor.
    const edges = edgesOf(api().snapshot.commands);
    expect(edges).toContainEqual({
      from: ifId,
      to: thenId,
      branch: "then",
      planned: false,
    });
    expect(edges).toContainEqual({
      from: ifId,
      to: elseId,
      branch: "else",
      planned: false,
    });
    const hidden = listed.commands.find((c) => c.id === ifId)?.then_body ?? [];
    for (const id of hidden) {
      if (id === thenId) continue;
      expect(edges.some((e) => e.to === id)).toBe(false);
    }

    // Both branches run their own block, exactly once. The `if` was
    // created with a staged body, which the engine runs first (it is a
    // hidden raw node, not a block on the canvas).
    connectAll(api, 0);
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["staged", "then"]);
  });

  it("Case E — undoes and redoes the connection into an `if`", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "print", template: '"A"' });
    });
    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    const printId = api().snapshot.commands[0]?.id;
    const ifId = api().snapshot.commands[1]?.id;
    expect(printId).toBeDefined();
    expect(ifId).toBeDefined();
    if (printId === undefined || ifId === undefined) return;

    act(() => {
      api().applyLinks(0, {
        edits: [{ id: printId, next: ifId }],
        entry: { type: "set", entry: printId },
      });
    });
    expect(api().snapshot.commands[0]?.next).toBe(ifId);
    expect(api().snapshot.commands[0]?.planned).toBe(true);

    // Undo: the connection is gone and the `if` is an orphan again.
    act(() => {
      api().undo();
    });
    expect(api().snapshot.actionError).toBe("");
    const undone = api().snapshot.commands;
    expect(undone.find((c) => c.id === printId)?.next ?? null).toBeNull();
    expect(undone.find((c) => c.id === printId)?.planned).toBeUndefined();
    expect(api().snapshot.entry).toBeNull();
    // The condition survived the undo.
    expect(api().ifConditionText(0, ifId)).toBe("true");

    // Redo: the connection is back, still marked as planned.
    act(() => {
      api().redo();
    });
    expect(api().snapshot.actionError).toBe("");
    const redone = api().snapshot.commands;
    expect(redone.find((c) => c.id === printId)?.next).toBe(ifId);
    expect(redone.find((c) => c.id === printId)?.planned).toBe(true);
    expect(api().ifConditionText(0, ifId)).toBe("true");

    // The restored program runs.
    act(() => {
      api().run();
    });
    expect(api().snapshot.run?.status).toBe("ok");
  });

  it("Case F — connects blocks in order with an `if` in the list", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, ifDraft("{x} > 5"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"after"' });
    });
    connectAll(api, 0);

    const commands = api().snapshot.commands;
    const declare = commands.find((c) => c.kind === "declare");
    const ifCommand = commands.find((c) => c.kind === "if");
    const print = commands.find((c) => c.kind === "print");
    expect(declare?.next).toBe(ifCommand?.id);
    expect(ifCommand?.next).toBe(print?.id);

    // No duplicate logical edge, and no wire anchored at a hidden node.
    const edges = edgesOf(commands);
    const keys = edges.map((e) => `${e.from}>${e.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(edges.length).toBe(2);

    // The engine confirms the second edge and cannot report the first.
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(
      listed.commands.find((c) => c.id === ifCommand?.id)?.next ?? null,
    ).toBe(print?.id ?? null);
    expect(
      listed.commands.find((c) => c.id === declare?.id)?.next ?? null,
    ).toBeNull();

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["after"]);
  });

  it("Case G — runs a branch at most once per run", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, ifDraft("{x} > 5"));
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;

    // A visible block wired into the then branch.
    act(() => {
      api().addCommand(0, { kind: "print", template: '"big"' });
    });
    const printId = api()
      .snapshot.commands.filter((c) => c.kind === "print")
      .at(-1)?.id;
    expect(printId).toBeDefined();
    if (printId === undefined) return;
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
    // The branch member is run by the `if`, never twice: it is not in
    // the main chain as well.
    expect(run.printed).toEqual(["big"]);
    expect(run.printed.filter((line) => line === "big").length).toBe(1);
  });

  it("Case H — tells engine-confirmed connections from planned ones", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "print", template: '"A"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"B"' });
    });
    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    const ids = api().snapshot.commands.map((c) => c.id);
    const aId = ids[0] as number;
    const bId = ids[1] as number;
    const ifId = ids[2] as number;

    // A → B is a plain chain edge the engine confirms; A → the `if` is
    // the connection the engine cannot report.
    act(() => {
      api().applyLinks(0, {
        edits: [
          { id: aId, next: bId },
          { id: bId, next: ifId },
        ],
        entry: { type: "set", entry: aId },
      });
    });

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    // The engine confirms A → B and reports nothing for B.
    expect(listed.commands.find((c) => c.id === aId)?.next ?? null).toBe(bId);
    expect(listed.commands.find((c) => c.id === bId)?.next ?? null).toBeNull();

    const edges = edgesOf(api().snapshot.commands);
    expect(edges).toContainEqual({
      from: aId,
      to: bId,
      branch: null,
      planned: false,
    });
    expect(edges).toContainEqual({
      from: bId,
      to: ifId,
      branch: null,
      planned: true,
    });
    // Exactly one planned edge: the one the engine cannot report.
    expect(edges.filter((e) => e.planned).length).toBe(1);
  });
});

/**
 * PARITY-013 — assignment with cast.
 *
 * The Engine has no single "assign and cast" operation, but a real
 * conversion is expressible through public bridge calls: a hidden
 * `declare` anchor, a hidden `cast` into a reserved temporary variable,
 * and the visible `assign` storing `{temp}` into the destination. These
 * tests prove the whole path against the shipped Engine: creation,
 * projection, execution, real runtime failures, deletion and undo/redo.
 */
describe("PARITY-013 — assignment with cast executes through the bridge", () => {
  function ifDraft(condition: string): CommandDraft {
    return { kind: "if", condition, then: [], else: null };
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

  /** A declare draft with an explicit type tag. */
  function declareDraft2(name: string, ty: OptilotusType): CommandDraft {
    return { kind: "declare", name, ty, init: "0" };
  }

  function visibleAssign(api: () => Api): {
    id: number;
    casting?: { targetType: string };
  } {
    const command = api().snapshot.commands.find((c) => c.kind === "assign");
    expect(command).toBeDefined();
    return command as { id: number; casting?: { targetType: string } };
  }

  /**
   * The single visible block that carries a conversion: the assignment
   * when the target equals the destination's declared type (the group
   * hides behind it), or the created Cast block — the converted
   * variable — when the target differs.
   */
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

  /** Every hidden reserved command the Engine currently holds. */
  function internalNames(): string[] {
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return [];
    return listed.commands
      .map((c) => c.var ?? "")
      .filter((name) => name.startsWith("__aqualotus_internal_"));
  }

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
    // The projection collapses the hidden anchor/cast: one visible
    // Assign Variable block, carrying the user's source expression.
    expect(api().snapshot.commands).toHaveLength(3);
    const assign = visibleAssign(api);
    expect(assign).toMatchObject({
      kind: "assign",
      var: "f",
      expr: "{n}",
      casting: { targetType: "float64" },
    });

    // The Engine really holds the two internal commands, with reserved
    // names and the real cast target type.
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const internalVars = listed.commands
      .map((c) => c.var ?? "")
      .filter((name) => name.startsWith("__aqualotus_internal_"));
    expect(internalVars).toHaveLength(2);
    expect(internalVars.some((name) => name.includes("anchor"))).toBe(true);
    expect(internalVars.some((name) => name.includes("cast"))).toBe(true);
    expect(
      listed.commands.find(
        (c) => c.kind === "cast" && (c.var ?? "").includes("cast_"),
      )?.ty,
    ).toBe("float64");
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
    // int32 7 was really converted to float64 and stored in `f`.
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
    // `i` is int32, so int32 is the only store-compatible target; the
    // failure is the actual value conversion (string "abc" → int32),
    // which the Engine can only detect at run time.
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
    // The failure is in the hidden cast compute, which no visible block
    // owns; the UI must not invent an attribution.
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
    // Target int32 differs from the float64 destination: the converted
    // value cannot live in `f`, so the apply creates a new int32
    // variable whose name is derived from the destination.
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
    // The original destination keeps its declaration, its type and its
    // value, and no assignment into it is created.
    expect(
      api().snapshot.commands.find(
        (c) => c.kind === "declare" && c.var === "f",
      ),
    ).toMatchObject({ ty: "float64", expr: "0" });
    expect(api().snapshot.commands.some((c) => c.kind === "assign")).toBe(false);

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    // Exactly one conversion, and the hidden anchor beside it — no
    // second, hidden conversion into the destination's declared type.
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
    // int32 7 -> the new int32 variable; the float64 destination still
    // holds its own value.
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
    // The original `x` keeps its int32 declaration and its own value.
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
    // int32 7 -> uint128 in the new variable; `x` still prints 0.
    expect(run.printed).toEqual(["7", "0"]);
  });

  it("surfaces the engine's error for an impossible conversion and keeps the original intact", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "declare", name: "n", ty: "int32", init: "300" });
    });
    // 300 cannot be represented in the selected int8 target; the Engine
    // can only detect that at run time.
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
    // The failure is in the hidden conversion compute, which no visible
    // block owns; the UI must not invent an attribution.
    expect(api().snapshot.errorBlockId).toBeNull();
    // The original variable is untouched by the failed conversion.
    expect(
      api().snapshot.commands.find(
        (c) => c.kind === "declare" && c.var === "n",
      ),
    ).toMatchObject({ ty: "int32", expr: "300" });
  });

  /**
   * The reported defect, pinned at the UI + engine level.
   *
   * The regressed implementation performed
   * `source value → selected target type → the destination's declared
   * type → store into the destination`. That sequence is invisible in
   * the value it stores (the last conversion wins), so this test pins
   * the program's *shape* as well as its output: the converted value
   * must live in a new variable of the target type, and no conversion
   * into the destination's declared type may exist.
   */
  it("never converts the converted value back into the destination's declared type", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "5"));
    });
    // The user's conversion: int32 → float64, on a block whose
    // destination is the int32 variable `x`.
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
    // The converted value is a real float64 (5.0) and the original int32
    // variable still holds 5. Under the regressed sequence the program
    // could not exist at all: there would be no float64 variable, and
    // the first print would not resolve.
    expect(run.printed).toEqual(["5.0", "5"]);

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    // Exactly one conversion — into the selected target. No conversion
    // into int32 (the destination's declared type) exists anywhere, and
    // nothing stores the converted value into `x`.
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

    // The projection shows the converted variable as its own block,
    // carrying the target type the user chose.
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

    // The Engine's own message is preserved, not replaced by a generic
    // UI error.
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
    // `ghost` is not declared: the apply never writes it, so the name is
    // only the base for the converted variable's name.
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
    // The Engine holds the created variable and the hidden anchor only.
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
    // Cross-type: int32 target on a float64 destination creates the
    // converted variable `f_i32`; the declaration is never rewritten.
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
    // The converted variable and its hidden anchor are gone — no
    // dangling raw references — and the destination keeps its type.
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

    // Wire the program before editing: the edit must keep every block in
    // its existing slot, not rely on the creation order of the list.
    connectAll(api, 0);

    // Target equals the declared type, so the assignment stores the
    // conversion result directly.
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

    // The user's chosen conversion target survives the declaration edit
    // untouched — casting never rewrites a declare block. float64 no
    // longer matches the declaration, so the rebuilt group creates the
    // converted value in a NEW float64 variable instead of storing it.
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
    // The declaration keeps the type the user just set...
    expect(
      listed.commands.find((c) => c.kind === "declare" && c.var === "f"),
    ).toMatchObject({ ty: "int64", expr: "0" });
    // ...and the only conversion is the user's float64 one: nothing
    // converts into int64, and no stale float64 store group remains.
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
    // int32 7 -> the new float64 variable (7.0); the original `f` is now
    // an int64 and still holds its own 0.
    expect(run.printed).toEqual(["0", "7.0"]);
  });
});

/**
 * Vertical If/Else body wiring — the engine cases behind the rebuilt
 * `if` canvas. These run against the real artifact and assert only
 * engine-reachable behavior: body membership, run order, and honest
 * rejections. What the engine cannot do (nest an `if` in a branch,
 * move a member back to the main chain) is asserted as an engine
 * refusal, never papered over.
 */
describe("The vertical If/Else body — engine-run branch bodies", () => {
  /** An `if` with the given condition and no branch members yet. */
  function ifDraft(condition: string): CommandDraft {
    return { kind: "if", condition, then: [], else: null };
  }

  function lastPrintId(api: () => Api): number | undefined {
    return api()
      .snapshot.commands.filter((c) => c.kind === "print")
      .at(-1)?.id;
  }

  it("runs a two-member TRUE body in engine order", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"A"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"B"' });
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;

    const prints = api()
      .snapshot.commands.filter((c) => c.kind === "print")
      .map((c) => c.id);
    const printAId = prints[0] as number;
    const printBId = prints[1] as number;
    expect(printAId).toBeDefined();
    expect(printBId).toBeDefined();

    // Wire both prints into the TRUE body, then the body chains
    // print A → print B inside the branch.
    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", printAId)).toBe(true);
    });
    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", printBId)).toBe(true);
    });
    expect(api().snapshot.actionError).toBe("");

    // The engine's branch list holds both members in body order.
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const body =
      listed.commands.find((c) => c.id === ifId)?.then_body ?? [];
    expect(body.filter((id) => id === printAId || id === printBId)).toEqual([
      printAId,
      printBId,
    ]);

    connectAll(api, 0);
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    // The branch executes its members exactly in wiring order.
    expect(run.printed).toEqual(["A", "B"]);
  });

  it("moves one of the if's own members between its branches", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"member"' });
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;
    const memberId = lastPrintId(api);
    expect(memberId).toBeDefined();
    if (memberId === undefined) return;
    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", memberId)).toBe(true);
    });

    // Same if, opposite branch: the engine allows the move.
    act(() => {
      expect(api().applyIfAppend(0, ifId, "else", memberId)).toBe(true);
    });
    expect(api().snapshot.actionError).toBe("");

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const body = listed.commands.find((c) => c.id === ifId);
    expect(body?.then_body ?? []).not.toContain(memberId);
    expect(body?.else_body ?? []).toContain(memberId);
  });

  it("refuses to nest an `if` in a branch — and says so", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    act(() => {
      api().addCommand(0, ifDraft("false"));
    });
    const commands = api().snapshot.commands.filter(
      (c) => c.kind === "if",
    );
    const outerIfId = commands.at(0)?.id;
    const innerIfId = commands.at(1)?.id;
    expect(outerIfId).toBeDefined();
    expect(innerIfId).toBeDefined();
    if (outerIfId === undefined || innerIfId === undefined) return;

    // The engine has no `if` inside a branch: it must reject the
    // wiring, the UI must surface that refusal, and nothing may be
    // fabricated instead (no fake nesting, no silently swallowed
    // member).
    act(() => {
      expect(api().applyIfAppend(0, outerIfId, "then", innerIfId)).toBe(false);
    });
    expect(api().snapshot.actionError).not.toBe("");

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const body = listed.commands.find((c) => c.id === outerIfId);
    expect(body?.then_body ?? []).not.toContain(innerIfId);
    // The rejected block still exists on the canvas as itself.
    expect(
      api().snapshot.commands.some((c) => c.id === innerIfId),
    ).toBe(true);
  });

  it("prunes the branch when a member is deleted (no move-back exists)", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"member"' });
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;
    const memberId = lastPrintId(api);
    expect(memberId).toBeDefined();
    if (memberId === undefined) return;
    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", memberId)).toBe(true);
    });

    act(() => {
      api().deleteCommand(0, memberId);
    });
    expect(api().snapshot.actionError).toBe("");

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(
      listed.commands.find((c) => c.id === ifId)?.then_body ?? [],
    ).not.toContain(memberId);
    expect(api().snapshot.commands.some((c) => c.id === memberId)).toBe(false);

    // The program still runs: the emptied branch executes nothing.
    connectAll(api, 0);
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual([]);
  });

  it("flows a TRUE body's tail into the if's own successor", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, ifDraft("{x} > 5"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"in branch"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"after"' });
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;
    // The TRUE body's member is the '"in branch"' print — NOT the
    // '"after"' print, which belongs to the chain after the `if`.
    const memberId = api()
      .snapshot.commands.find((c) => c.template === '"in branch"')?.id;
    expect(memberId).toBeDefined();
    if (memberId === undefined) return;
    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", memberId)).toBe(true);
    });

    // The print after the `if` is chained at the if's own `next`. The
    // engine ends the member's chain there — the merge rejoin at the
    // if's successor is the executor's documented walk, which the run
    // below must show.
    connectAll(api, 0);
    const commands = api().snapshot.commands;
    const afterId = commands.find((c) => c.template === '"after"')?.id;
    expect(afterId).toBeDefined();
    if (afterId === undefined) return;
    const mergeEdges = mergeEdgesOf(commands);
    expect(mergeEdges).toContainEqual({
      ifId,
      from: memberId,
      to: afterId,
    });

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    // Body first, then the if's successor — the merge rail's order.
    expect(run.printed).toEqual(["in branch", "after"]);
  });
});
