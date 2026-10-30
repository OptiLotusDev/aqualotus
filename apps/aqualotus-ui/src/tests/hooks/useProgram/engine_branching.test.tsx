/**
 * UI hook <-> real engine integration tests: branching (if/else) resolution.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { setup, connectAll, type Api } from "./engine_support";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";
import {
  optilotus_getFunction,
  optilotus_listCommands,
  type CommandSpec,
} from "../../../lib/optilotus";
import { edgesOf } from "../../../lib/graph";
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

describe("The `if` gap — the connection the engine cannot report", () => {
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

    const info = optilotus_getFunction(0);
    expect(info.status).toBe("ok");
    if (info.status !== "ok") return;
    expect(info.entry).not.toBe(ifId);
    expect(
      api().snapshot.commands.some((c) => c.id === info.entry),
    ).toBe(false);

    expect(api().snapshot.entry).toBe(ifId);
    const edges = edgesOf(api().snapshot.commands);
    for (const edge of edges) {
      expect(edge.from).not.toBe(info.entry);
      expect(edge.to).not.toBe(info.entry);
    }

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

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const engineDeclare = listed.commands.find((c) => c.id === declare.id);
    expect(engineDeclare?.next ?? null).toBeNull();

    expect(declare.next).toBe(ifCommand.id);
    expect(declare.planned).toBe(true);
    expect(edgesOf(commands)).toContainEqual({
      from: declare.id,
      to: ifCommand.id,
      branch: null,
      planned: true,
    });
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

    expect(api().ifConditionText(0, ifId)).toBe("{x} > 50");
    const commands = api().snapshot.commands;
    const declare = commands.find((c) => c.kind === "declare");
    const ifCommand = commands.find((c) => c.id === ifId);
    expect(declare?.next).toBe(ifId);
    expect(ifCommand?.next).toBeNull();

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

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const ifCommand = listed.commands.find((c) => c.id === ifId);
    expect(ifCommand?.then_body).toContain(thenId);
    expect(ifCommand?.then_body ?? []).not.toContain(elseId);
    expect(ifCommand?.else_body).toContain(elseId);
    expect(ifCommand?.else_body ?? []).not.toContain(thenId);

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

    act(() => {
      api().undo();
    });
    expect(api().snapshot.actionError).toBe("");
    const undone = api().snapshot.commands;
    expect(undone.find((c) => c.id === printId)?.next ?? null).toBeNull();
    expect(undone.find((c) => c.id === printId)?.planned).toBeUndefined();
    expect(api().snapshot.entry).toBeNull();
    expect(api().ifConditionText(0, ifId)).toBe("true");

    act(() => {
      api().redo();
    });
    expect(api().snapshot.actionError).toBe("");
    const redone = api().snapshot.commands;
    expect(redone.find((c) => c.id === printId)?.next).toBe(ifId);
    expect(redone.find((c) => c.id === printId)?.planned).toBe(true);
    expect(api().ifConditionText(0, ifId)).toBe("true");

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

    const edges = edgesOf(commands);
    const keys = edges.map((e) => `${e.from}>${e.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(edges.length).toBe(2);

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
    expect(edges.filter((e) => e.planned).length).toBe(1);
  });
});

describe("The vertical If/Else body — engine-run branch bodies", () => {
  function ifDraft(condition: string): CommandDraft {
    return { kind: "if", condition, then: [], else: null };
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

    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", printAId)).toBe(true);
    });
    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", printBId)).toBe(true);
    });
    expect(api().snapshot.actionError).toBe("");

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
    expect(run.printed).toEqual(["A", "B"]);
  });

  it("moves one of the if's own members between its branches", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"big"' });
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;

    const printId = api()
      .snapshot.commands.filter((c) => c.kind === "print")
      .at(-1)?.id;
    expect(printId).toBeDefined();
    if (printId === undefined) return;
    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", printId)).toBe(true);
    });
    // Moving a member between branches succeeds (the engine relocates it).
    act(() => {
      expect(api().applyIfAppend(0, ifId, "else", printId)).toBe(true);
    });
    expect(api().snapshot.actionError).toBe("");

    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const ifCommand = listed.commands.find((c) => c.id === ifId);
    // The member moved to `else`, no longer in `then`.
    expect(ifCommand?.then_body ?? []).not.toContain(printId);
    expect(ifCommand?.else_body ?? []).toContain(printId);

    connectAll(api, 0);
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    // The member moved to `else`; `then` is empty, so nothing prints.
    expect(run.printed).toEqual([]);
  });

  it("refuses to nest an `if` in a branch — and says so", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, ifDraft("true"));
    });
    const outerId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(outerId).toBeDefined();
    if (outerId === undefined) return;

    act(() => {
      api().addCommand(0, {
        kind: "print",
        template: '"inner"',
      });
    });
    const innerPrintId = api()
      .snapshot.commands.filter((c) => c.kind === "print")
      .at(-1)?.id;
    expect(innerPrintId).toBeDefined();
    if (innerPrintId === undefined) return;
    act(() => {
      expect(
        api().applyIfAppend(0, outerId, "then", innerPrintId),
      ).toBe(true);
    });

    act(() => {
      api().addCommand(0, {
        kind: "if",
        condition: "true",
        then: [],
        else: null,
      });
    });
    const nestedId = api()
      .snapshot.commands.filter((c) => c.kind === "if")
      .at(-1)?.id;
    expect(nestedId).toBeDefined();
    if (nestedId === undefined) return;
    act(() => {
      expect(api().applyIfAppend(0, outerId, "then", nestedId)).toBe(false);
    });
    expect(api().snapshot.actionError).toContain("cannot join an `if` branch");

    connectAll(api, 0);
    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["inner"]);
  });

  it("prunes the branch when a member is deleted (no move-back exists)", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "10"));
    });
    act(() => {
      api().addCommand(0, ifDraft("{x} > 5"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"big"' });
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;

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
    expect(run.printed).toEqual(["big"]);

    act(() => {
      api().deleteCommand(0, printId);
    });
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    const ifCommand = listed.commands.find((c) => c.id === ifId);
    // The member was removed from the branch.
    expect(ifCommand?.then_body ?? []).not.toContain(printId);

    act(() => {
      api().run();
    });
    const run2 = api().snapshot.run;
    expect(run2?.status).toBe("ok");
    if (run2?.status !== "ok") return;
    expect(run2.printed).toEqual([]);
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
      api().addCommand(0, { kind: "print", template: '"big"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"after"' });
    });
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id;
    expect(ifId).toBeDefined();
    if (ifId === undefined) return;

    const prints = api()
      .snapshot.commands.filter((c) => c.kind === "print")
      .map((c) => c.id);
    const bigId = prints[0] as number;

    act(() => {
      expect(api().applyIfAppend(0, ifId, "then", bigId)).toBe(true);
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });
    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["big", "after"]);
  });
});
