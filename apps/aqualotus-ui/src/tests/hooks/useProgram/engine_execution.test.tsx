/**
 * UI hook <-> real engine integration tests: execution path.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { setup, connectAll, type Api } from "./engine_support";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";
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
    expect(api().snapshot.error?.command).toBe(run.command);
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
  });
});
