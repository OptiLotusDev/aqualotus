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

describe("real engine flows — branching and orphans", () => {
  it("only the entry chain prints until orphans are connected", async () => {
    const { api } = await freshHook();
    const { planChainAll } = await import("../../lib/graph");
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
      api().addCommand(0, {
        kind: "declare",
        name: "n",
        ty: "int32",
        init: "0",
      });
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
