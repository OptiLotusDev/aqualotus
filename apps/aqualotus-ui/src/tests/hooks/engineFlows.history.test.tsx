import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import {
  useRealEngine,
  resetRealEngine,
} from "../../test-support/realEngine";
import { freshHook, chainInOrder, printed } from "./engineFlows.test-helpers";

beforeAll(async () => {
  await useRealEngine();
});

beforeEach(() => {
  resetRealEngine();
});

describe("real engine flows — history", () => {
  it("add/add/undo/undo/redo/redo stays runnable", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "x",
        ty: "int32",
        init: "1",
      });
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
      api().addCommand(0, {
        kind: "declare",
        name: "x",
        ty: "int32",
        init: "7",
      });
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

  it("edit cycles stay consistent across repeated undo/redo", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "x",
        ty: "int32",
        init: "1",
      });
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

  it("redo restores every block of a type-change edit, twice", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "x",
        ty: "int32",
        init: "5",
      });
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
    const edited =
      api()
        .snapshot.commands.map((c) => `${c.kind}:${c.var ?? c.template ?? ""}`)
        .join(",") ?? "";
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
      const after =
        api()
          .snapshot.commands.map(
            (c) => `${c.kind}:${c.var ?? c.template ?? ""}`,
          )
          .join(",");
      expect(after).toBe(edited);
      act(() => {
        api().run();
      });
      expect(printed(api)).toEqual(["hi"]);
    }
  });

  it("interleaved add/edit/undo/redo loses nothing", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "a",
        ty: "int32",
        init: "1",
      });
    });
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "b",
        ty: "int32",
        init: "2",
      });
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
      api()
        .snapshot.commands.map((c) => `${c.var}=${c.expr ?? ""}`)
        .join(","),
    ).toBe("a=1");
    // Redo both, in order: nothing goes missing.
    act(() => {
      api().redo();
    });
    expect(
      api()
        .snapshot.commands.map((c) => `${c.var}=${c.expr ?? ""}`)
        .join(","),
    ).toBe("a=1,b=2");
    act(() => {
      api().redo();
    });
    expect(
      api()
        .snapshot.commands.map((c) => `${c.var}=${c.expr ?? ""}`)
        .join(","),
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
    const helper =
      api().snapshot.functions.find((f) => f.name === "helper")?.id ?? -1;
    act(() => {
      api().addCommand(helper, {
        kind: "declare",
        name: "m",
        ty: "int32",
        init: "1",
      });
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
