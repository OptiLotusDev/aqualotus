import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import {
  useRealEngine,
  resetRealEngine,
} from "../../test-support/realEngine";
import {
  freshHook,
  chainInOrder,
  printed,
} from "./engineFlows.test-helpers";

beforeAll(async () => {
  await useRealEngine();
});

beforeEach(() => {
  resetRealEngine();
});

describe("real engine flows — basic", () => {
  it("runs declare/assign/print end to end", async () => {
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

  it("documents float print reality", async () => {
    const { api } = await freshHook();
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float32",
        init: "2",
      });
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
      api().addCommand(0, {
        kind: "declare",
        name: "s",
        ty: "string",
        init: '"hello"',
      });
    });
    expect(api().snapshot.actionError).toBe("");
    expect(api().snapshot.commands[0]?.expr).toBe("hello");
    act(() => {
      api().addCommand(0, { kind: "declare", name: "c", ty: "char", init: "'a'" });
    });
    expect(api().snapshot.actionError).toBe("");
    expect(api().snapshot.commands[1]?.expr).toBe("a");
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "b",
        ty: "bool",
        init: "True",
      });
    });
    expect(api().snapshot.actionError).toBe("");
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "f",
        ty: "float32",
        init: "2",
      });
    });
    expect(api().snapshot.actionError).toBe("");
    // Input is input: the rectangle keeps exactly what was typed.
    expect(api().snapshot.commands[3]?.expr).toBe("2");
    act(() => {
      api().addCommand(0, {
        kind: "print",
        template: '"{s} {c} {b} {f}"',
      });
    });
    chainInOrder(api);
    act(() => {
      api().run();
    });
    expect(api().snapshot.actionError).toBe("");
    console.log("literals run:", JSON.stringify(api().snapshot.run));
  });
});
