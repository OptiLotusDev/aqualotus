/**
 * UI hook <-> real engine integration tests: undo/redo history.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { setup, connectAll, type Api } from "./engine_support";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";
import {
  optilotus_listCommands,
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
