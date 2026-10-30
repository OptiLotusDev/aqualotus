/**
 * UI hook <-> real engine integration tests: runtime failure mapping.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { setup, connectAll, type Api } from "./engine_support";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";
import {
  optilotus_deleteCommand,
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

/** The visible block of a kind in the selected function. */
function blockOf(api: () => Api, kind: string): number {
  const cmd = api().snapshot.commands.find((c) => c.kind === kind);
  if (cmd === undefined) {
    throw new Error(`no ${kind} block in the projection`);
  }
  return cmd.id;
}

describe("TASK-003 — runtime failures map to the visible block", () => {
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

    const error = api().snapshot.error;
    expect(error?.kind).toBe("UnknownVariable");
    expect(error?.message).toContain('unknown variable "ghost"');
    expect(error?.var).toBe("ghost");
    expect(api().snapshot.actionError).toContain("UnknownVariable");

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
    expect(error).not.toBeNull();
    expect(error?.status).toBe("error");
    expect(error?.kind).toBe("UnknownVariable");
    expect(error?.message).toContain('unknown variable "ghost"');
    expect(error?.message).toContain(`at ${String(error?.command)}`);
    expect(error?.var).toBe("ghost");
    expect(error?.command).toBeTypeOf("number");
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
