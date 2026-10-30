/**
 * UI hook <-> real engine integration tests: connections and linking.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { setup, connectAll, type Api } from "./engine_support";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";
import {
  optilotus_getFunction,
  optilotus_runProgram,
} from "../../../lib/optilotus";
import { planDropLink } from "../../../lib/graph";
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

    act(() => {
      api().applyLinks(0, {
        edits: [{ id: aId, next: cId }],
        entry: { type: "set", entry: aId },
      });
    });

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
    expect(run.printed).toEqual(["A", "B", "C"]);
  });
});
