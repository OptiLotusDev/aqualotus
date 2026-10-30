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

describe("real engine flows — editing", () => {
  it("editing declare int32 -> string heals the assign and runs", async () => {
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

  it("rename declare repoints assigns end to end", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "x",
        ty: "int32",
        init: "3",
      });
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
    expect(api().snapshot.commands.map((c) => c.var)).toEqual([
      "y",
      "y",
      undefined,
    ]);
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
    expect(api().snapshot.commands.map((c) => c.var)).toEqual([
      "x",
      "x",
      undefined,
    ]);
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
      api().addCommand(0, {
        kind: "declare",
        name: "x",
        ty: "int32",
        init: "1",
      });
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
    const cmds = api().snapshot.commands.map((c) => ({
      id: c.id,
      next: c.next ?? null,
    }));
    const entry = api().snapshot.selected?.entry ?? null;
    const printA = cmds[1]?.id ?? -1;
    const printB = cmds[2]?.id ?? -1;
    const { planLinkBefore: before } = await import("../../lib/graph");
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
});
