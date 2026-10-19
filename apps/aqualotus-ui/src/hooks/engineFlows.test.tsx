import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook } from "@testing-library/react";
import init from "../wasm/optilotus/optilotus.js";
import { optilotus_clearPackage, optilotus_tryEnsure } from "../lib/optilotus";
import { planDropLink } from "../lib/graph";
import { useProgram } from "./useProgram";

let seq = 0;
function issueSeq(): number {
  seq += 1;
  return seq;
}

type Api = ReturnType<typeof useProgram>;

async function freshHook(): Promise<{
  api: () => Api;
}> {
  optilotus_clearPackage();
  seq = 0;
  const { result } = renderHook(() => useProgram(true, issueSeq));
  await act(async () => {
    await Promise.resolve();
  });
  return { api: () => result.current };
}

/** Chain every block head-to-tail in creation order via port drops. */
function chainInOrder(api: () => Api, fid = 0): void {
  const ids = api().snapshot.commands.map((c) => c.id);
  for (let i = 1; i < ids.length; i += 1) {
    const list = api().snapshot.commands.map((c) => ({
      id: c.id,
      next: c.next ?? null,
    }));
    const entry = api().snapshot.selected?.entry ?? null;
    const prev = ids[i - 1] as number;
    const cur = ids[i] as number;
    const plan = planDropLink(list, entry, prev, cur, "before");
    expect(plan).not.toBe(null);
    act(() => {
      api().applyLinks(fid, plan!);
    });
  }
}

function printed(api: () => Api): string[] {
  const run = api().snapshot.run;
  expect(run?.status).toBe("ok");
  return run?.status === "ok" ? [...run.printed] : [];
}

describe("real engine flows", () => {
  beforeAll(async () => {
    const buf = readFileSync(
      join(process.cwd(), "src/wasm/optilotus/optilotus_bg.wasm"),
    );
    const bytes = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    );
    await init(bytes);
    await optilotus_tryEnsure();
  });

  beforeEach(() => {
    optilotus_clearPackage();
    seq = 0;
  });

  it("runs declare/assign/print end to end", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "1" });
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "x", expr: "{x} + 1" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    chainInOrder(api);
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["2"]);
  });

  it("editing declare int32 -> string heals the assign and runs", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "5" });
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "x", expr: "{x}" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    chainInOrder(api);
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["5"]);

    const declareId = api().snapshot.commands[0]?.id ?? -1;
    act(() => {
      api().replaceCommand(0, declareId, {
        kind: "declare",
        name: "x",
        ty: "string",
        init: "hi",
      });
    });
    expect(api().snapshot.actionError).toBe("");
    act(() => {
      api().run();
    });
    expect(api().snapshot.actionError).toBe("");
    expect(printed(api)).toEqual(["hi"]);

    // Undo restores int32 end to end; redo reapplies the string edit.
    act(() => {
      api().undo();
    });
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["5"]);
    act(() => {
      api().redo();
    });
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["hi"]);
  });

  it("documents float print reality", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "f", ty: "float32", init: "2" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{f}"' });
    });
    chainInOrder(api);
    act(() => {
      api().run();
    });
    console.log("float printed:", JSON.stringify(api().snapshot.run));
  });

  it("accepts naturally written string/char/bool/float literals", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "s", ty: "string", init: '"hello"' });
    });
    expect(api().snapshot.actionError).toBe("");
    expect(api().snapshot.commands[0]?.expr).toBe("hello");
    act(() => {
      api().addCommand(0, { kind: "declare", name: "c", ty: "char", init: "'a'" });
    });
    expect(api().snapshot.actionError).toBe("");
    expect(api().snapshot.commands[1]?.expr).toBe("a");
    act(() => {
      api().addCommand(0, { kind: "declare", name: "b", ty: "bool", init: "True" });
    });
    expect(api().snapshot.actionError).toBe("");
    act(() => {
      api().addCommand(0, { kind: "declare", name: "f", ty: "float32", init: "2" });
    });
    expect(api().snapshot.actionError).toBe("");
    // Input is input: the rectangle keeps exactly what was typed.
    expect(api().snapshot.commands[3]?.expr).toBe("2");
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{s} {c} {b} {f}"' });
    });
    chainInOrder(api);
    act(() => {
      api().run();
    });
    expect(api().snapshot.actionError).toBe("");
    console.log("literals run:", JSON.stringify(api().snapshot.run));
  });

  it("add/add/undo/undo/redo/redo stays runnable", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "1" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    act(() => {
      api().undo();
    });
    act(() => {
      api().undo();
    });
    expect(api().snapshot.commands).toHaveLength(0);
    act(() => {
      api().redo();
    });
    act(() => {
      api().redo();
    });
    expect(api().snapshot.commands).toHaveLength(2);
    chainInOrder(api);
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["1"]);
  });

  it("delete/undo/redo round-trips the chain", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "7" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    chainInOrder(api);
    const printId = api().snapshot.commands[1]?.id ?? -1;
    act(() => {
      api().deleteCommand(0, printId);
    });
    expect(api().snapshot.commands).toHaveLength(1);
    act(() => {
      api().undo();
    });
    expect(api().snapshot.commands).toHaveLength(2);
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["7"]);
    act(() => {
      api().redo();
    });
    expect(api().snapshot.commands).toHaveLength(1);
  });

  it("rename declare repoints assigns end to end", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "3" });
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "x", expr: "{x} + 1" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    chainInOrder(api);
    const declareId = api().snapshot.commands[0]?.id ?? -1;
    act(() => {
      api().replaceCommand(0, declareId, {
        kind: "declare",
        name: "y",
        ty: "int32",
        init: "3",
      });
    });
    expect(api().snapshot.actionError).toBe("");
    expect(api().snapshot.commands.map((c) => c.var)).toEqual(["y", "y", undefined]);
    act(() => {
      api().run();
    });
    expect(api().snapshot.actionError).toBe("");
    expect(printed(api)).toEqual(["4"]);
    act(() => {
      api().undo();
    });
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["4"]);
    expect(api().snapshot.commands.map((c) => c.var)).toEqual(["x", "x", undefined]);
    act(() => {
      api().redo();
    });
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["4"]);
  });

  it("rewire/undo/redo keeps the execution order", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "1" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"A-{x}"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"B-{x}"' });
    });
    chainInOrder(api);
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["A-1", "B-1"]);
    // Move print B before print A: entry stays on the declare.
    const cmds = api().snapshot.commands.map((c) => ({ id: c.id, next: c.next ?? null }));
    const entry = api().snapshot.selected?.entry ?? null;
    const printA = cmds[1]?.id ?? -1;
    const printB = cmds[2]?.id ?? -1;
    const { planLinkBefore: before } = await import("../lib/graph");
    const plan = before(cmds, entry, printA, printB);
    expect(plan).not.toBe(null);
    act(() => {
      api().applyLinks(0, plan!);
    });
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["B-1", "A-1"]);
    act(() => {
      api().undo();
    });
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["A-1", "B-1"]);
    act(() => {
      api().redo();
    });
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["B-1", "A-1"]);
  });

  it("only the entry chain prints until orphans are connected", async () => {
    const { api } = await freshHook();
    const { planChainAll } = await import("../lib/graph");
    act(() => {
      api().addCommand(0, { kind: "print", template: '"one"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"two"' });
    });
    // Two detached prints, no entry: the run is a no-op.
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual([]);
    // One-click connect chains everything in list order with an entry.
    const list = api().snapshot.commands.map((c) => ({
      id: c.id,
      next: c.next ?? null,
    }));
    const chained = planChainAll(
      list,
      api().snapshot.selected?.entry ?? null,
    );
    expect(chained).not.toBe(null);
    act(() => {
      api().applyLinks(0, chained!);
    });
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["one", "two"]);
  });

  it("edit cycles stay consistent across repeated undo/redo", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "1" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    chainInOrder(api);
    const declareId = api().snapshot.commands[0]?.id ?? -1;
    act(() => {
      api().replaceCommand(0, declareId, {
        kind: "declare",
        name: "x",
        ty: "int32",
        init: "9",
      });
    });
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        api().undo();
      });
      act(() => {
        api().run();
      });
      console.log(`cycle ${i} undo run:`, JSON.stringify(api().snapshot.run));
      act(() => {
        api().redo();
      });
      act(() => {
        api().run();
      });
      console.log(`cycle ${i} redo run:`, JSON.stringify(api().snapshot.run));
    }
    expect(api().snapshot.commands).toHaveLength(2);
  });

  function kindsVars(api: () => Api): string {
    return api()
      .snapshot.commands.map((c) => `${c.kind}:${c.var ?? c.template ?? ""}`)
      .join(",");
  }

  it("redo restores every block of a type-change edit, twice", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "5" });
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "x", expr: "{x}" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    chainInOrder(api);
    const declareId = api().snapshot.commands[0]?.id ?? -1;
    act(() => {
      api().replaceCommand(0, declareId, {
        kind: "declare",
        name: "x",
        ty: "string",
        init: '"hi"',
      });
    });
    expect(api().snapshot.actionError).toBe("");
    const edited = kindsVars(api);
    for (let i = 0; i < 2; i += 1) {
      act(() => {
        api().undo();
      });
      expect(api().snapshot.commands).toHaveLength(3);
      expect(api().snapshot.actionError).toBe("");
      act(() => {
        api().run();
      });
      expect(printed(api)).toEqual(["5"]);
      act(() => {
        api().redo();
      });
      expect(api().snapshot.actionError).toBe("");
      expect(api().snapshot.commands).toHaveLength(3);
      expect(kindsVars(api)).toBe(edited);
      act(() => {
        api().run();
      });
      expect(printed(api)).toEqual(["hi"]);
    }
  });

  it("interleaved add/edit/undo/redo loses nothing", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "a", ty: "int32", init: "1" });
    });
    act(() => {
      api().addCommand(0, { kind: "declare", name: "b", ty: "int32", init: "2" });
    });
    const bId = api().snapshot.commands[1]?.id ?? -1;
    act(() => {
      api().replaceCommand(0, bId, {
        kind: "declare",
        name: "b",
        ty: "int32",
        init: "20",
      });
    });
    // Undo the edit, then undo the second add.
    act(() => {
      api().undo();
    });
    act(() => {
      api().undo();
    });
    expect(
      api().snapshot.commands.map((c) => `${c.var}=${c.expr ?? ""}`).join(","),
    ).toBe("a=1");
    // Redo both, in order: nothing goes missing.
    act(() => {
      api().redo();
    });
    expect(
      api().snapshot.commands.map((c) => `${c.var}=${c.expr ?? ""}`).join(","),
    ).toBe("a=1,b=2");
    act(() => {
      api().redo();
    });
    expect(
      api().snapshot.commands.map((c) => `${c.var}=${c.expr ?? ""}`).join(","),
    ).toBe("a=1,b=20");
    expect(api().snapshot.actionError).toBe("");
    expect(api().canUndo).toBe(true);
    expect(api().canRedo).toBe(false);
  });

  it("function delete/undo/redo round-trips its blocks", async () => {
    const { api } = await freshHook();
    act(() => {
      api().createFunction("helper");
    });
    const helper = api().snapshot.functions.find((f) => f.name === "helper")?.id ?? -1;
    act(() => {
      api().addCommand(helper, { kind: "declare", name: "m", ty: "int32", init: "1" });
    });
    act(() => {
      api().addCommand(helper, { kind: "return", expr: "{m}" });
    });
    expect(api().snapshot.functions).toHaveLength(2);
    act(() => {
      api().deleteFunction(helper);
    });
    expect(api().snapshot.functions).toHaveLength(1);
    act(() => {
      api().undo();
    });
    expect(api().snapshot.functions).toHaveLength(2);
    const restored =
      api().snapshot.functions.find((f) => f.name === "helper")?.id ?? -1;
    act(() => {
      api().selectFunction(restored);
    });
    expect(api().snapshot.commands.map((c) => c.kind)).toEqual([
      "declare",
      "return",
    ]);
    act(() => {
      api().redo();
    });
    expect(api().snapshot.functions).toHaveLength(1);
    expect(api().snapshot.actionError).toBe("");
  });
});

describe("bool comparisons, if branches, and renames", () => {
  it("assigns comparisons into a bool and prints true/false", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, { kind: "declare", name: "c", ty: "bool", init: "" });
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "c", expr: "3 > 2" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{c}"' });
    });
    chainInOrder(api);
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["true"]);

    const assignId =
      api().snapshot.commands.find((c) => c.kind === "assign")?.id ?? -1;
    act(() => {
      api().replaceCommand(0, assignId, {
        kind: "assign",
        name: "c",
        expr: "3 < 2",
      });
    });
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["false"]);
  });

  it("renames a helper and still calls it by the new name", async () => {
    const { api } = await freshHook();
    act(() => {
      api().createFunction("helper");
    });
    const helper =
      api().snapshot.functions.find((f) => f.name === "helper")?.id ?? -1;
    act(() => {
      api().selectFunction(helper);
    });
    act(() => {
      api().addCommand(helper, {
        kind: "declare",
        name: "v",
        ty: "int32",
        init: "41",
      });
    });
    act(() => {
      api().addCommand(helper, { kind: "return", expr: "{v} + 1" });
    });
    // Wire the helper's own chain (creation leaves blocks detached).
    chainInOrder(api, helper);
    act(() => {
      api().renameFunction(helper, "worker");
    });
    expect(api().snapshot.actionError).toBe("");
    expect(
      api().snapshot.functions.find((f) => f.id === helper)?.name,
    ).toBe("worker");

    act(() => {
      api().selectFunction(0);
    });
    act(() => {
      api().addCommand(0, { kind: "declare", name: "n", ty: "int32", init: "0" });
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: "worker()" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{n}"' });
    });
    chainInOrder(api);
    act(() => {
      api().run();
    });
    expect(printed(api)).toEqual(["42"]);
  });
});
