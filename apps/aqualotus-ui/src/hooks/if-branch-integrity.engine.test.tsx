/**
 * Branch-membership integrity against the real engine (regression for
 * the Task 3/5 engine-truth work): the conditions the UI must satisfy
 * because `Package::if_append` moves a block's whole raw group and
 * `Package::delete_command` drops a deleted id from every branch list.
 *
 * - a member the main chain wired into the `if` steals the `if`'s fresh
 *   condition compute on append; the UI heals the `if` afterwards;
 * - the entry itself being an appended member is re-pointed first;
 * - an in-place edit of a branch member re-appends the rebuild (the
 *   engine's branch tail chains to it again); undo restores everything;
 * - cast rows refuse in-place edits: the engine's hidden conversion
 *   compute has no user-level id to re-link, so the editor refuses with
 *   an explanation instead of leaving a broken program behind.
 */
import { beforeEach, beforeAll, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resetRealEngine, useRealEngine } from "../test-support/realEngine";
import {
  optilotus_cast,
  optilotus_declare,
  optilotus_listCommands,
  optilotus_type,
} from "../lib/optilotus";
import { isOptilotusError } from "../lib/program";
import { useProgram } from "./useProgram";

let seq = 0;
function issueSeq(): number {
  seq += 1;
  return seq;
}

type Api = ReturnType<typeof useProgram>;

beforeAll(async () => {
  await useRealEngine();
});

beforeEach(() => {
  resetRealEngine();
  seq = 0;
});

async function setup(): Promise<{ result: { current: Api } }> {
  const view = renderHook(() => useProgram(true, issueSeq));
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

/**
 * Runs the program and returns the engine's printed lines. Loudly
 * rejected when the run fails: a test asserting a run outcome must read
 * the engine's own envelope, never assume success.
 */
function runPrints(api: () => Api): string[] {
  act(() => {
    api().run();
  });
  const run = api().snapshot.run;
  if (run === null || run.status !== "ok") {
    throw new Error(`run failed: ${JSON.stringify(run)}`);
  }
  return [...run.printed];
}

describe("branch-membership integrity (engine truth)", () => {
  it("keeps the condition computed when a wired cast member enters the branch", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "5" });
    });
    act(() => {
      api().addCommand(0, {
        kind: "assign",
        name: "x",
        expr: "{x}",
        casting: { enabled: true, targetType: "int64" },
      });
    });
    act(() => {
      api().addCommand(0, { kind: "if", condition: "3 > 2", then: [], else: null });
    });
    // The conversion stores the converted value in the destination
    // itself (the declaration is never rewritten): the value keeps
    // being read through `x`.
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });

    const castId = api().snapshot.commands.find((c) => c.casting)?.id ?? -1;
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id ?? -1;
    const printId = api().snapshot.commands.find((c) => c.kind === "print")?.id ?? -1;
    const declareId = api().snapshot.commands.find((c) => c.kind === "declare")?.id ?? -1;
    expect(castId).toBeGreaterThan(0);
    expect(ifId).toBeGreaterThan(0);
    expect(printId).toBeGreaterThan(0);
    expect(declareId).toBeGreaterThan(0);

    // Wire: cast → if (splice the condition compute) and if → print (join).
    act(() => {
      api().applyLinks(0, {
        edits: [
          { id: declareId, next: castId },
          { id: castId, next: ifId },
          { id: ifId, next: printId },
        ],
        entry: { type: "set", entry: declareId },
      });
    });
    expect(runPrints(api)).toEqual(["5"]);

    // Append the wired member: without the heal the engine's
    // `if_append` drags the `if`'s condition compute into the branch
    // and the main chain reaches the `if` with no computed condition
    // (MissingValue), starving the join print too.
    act(() => {
      api().applyIfAppend(0, ifId, "then", castId);
    });
    expect(runPrints(api)).toEqual(["5"]);
  });

  it("re-points the entry when the appended member was the entry", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "declare", name: "n", ty: "int64", init: "0" });
    });
    act(() => {
      api().addCommand(0, {
        kind: "assign",
        name: "n",
        expr: "5",
        casting: { enabled: true, targetType: "int64" },
      });
    });
    act(() => {
      api().addCommand(0, { kind: "if", condition: "3 > 2", then: [], else: null });
    });
    // The converted value is read through the destination (its
    // declaration is never rewritten).
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{n}"' });
    });

    const castId = api().snapshot.commands.find((c) => c.casting)?.id ?? -1;
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id ?? -1;
    const printId = api().snapshot.commands.find((c) => c.kind === "print")?.id ?? -1;
    expect(castId).toBeGreaterThan(0);
    expect(ifId).toBeGreaterThan(0);
    expect(printId).toBeGreaterThan(0);

    // The entry IS the cast (its anchor, resolved to the visible id):
    // the run starts at the branch's future member.
    act(() => {
      api().applyLinks(0, {
        edits: [
          { id: castId, next: ifId },
          { id: ifId, next: printId },
        ],
        entry: { type: "set", entry: castId },
      });
    });
    expect(runPrints(api)).toEqual(["5"]);

    act(() => {
      api().applyIfAppend(0, ifId, "then", castId);
    });
    expect(runPrints(api)).toEqual(["5"]);
  });

  it("re-appends a replaced branch member so the run reaches it again", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "5" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    act(() => {
      api().addCommand(0, { kind: "if", condition: "3 > 2", then: [], else: null });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });

    const declareId = api().snapshot.commands.find((c) => c.kind === "declare")?.id ?? -1;
    const ifId = api().snapshot.commands.find((c) => c.kind === "if")?.id ?? -1;
    const prints = api().snapshot.commands.filter((c) => c.kind === "print");
    const headPrintId = prints[0]?.id ?? -1;
    const joinId = prints[1]?.id ?? -1;
    expect(declareId).toBeGreaterThan(0);
    expect(ifId).toBeGreaterThan(0);
    expect(headPrintId).toBeGreaterThan(0);
    expect(joinId).toBeGreaterThan(0);

    // declare → print → if → print (the join).
    act(() => {
      api().applyLinks(0, {
        edits: [
          { id: declareId, next: headPrintId },
          { id: headPrintId, next: ifId },
          { id: ifId, next: joinId },
        ],
        entry: { type: "set", entry: declareId },
      });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    const branchPrint = api().snapshot.commands.find(
      (c) => c.kind === "print" && c.id !== headPrintId && c.id !== joinId,
    );
    if (branchPrint === undefined) throw new Error("branch print not created");
    const branchPrintId = branchPrint.id;
    act(() => {
      api().applyIfAppend(0, ifId, "then", branchPrintId);
    });
    expect(runPrints(api)).toEqual(["5", "5", "5"]);

    // Edit the branch member in place: the engine drops a deleted id
    // from its branch list and no user-level edge points at a member
    // (each member's span ends at a hidden tail), so the rebuilt block
    // would sit outside the branch with no inbound path and never run.
    // The replace captures the member's owner before the delete and
    // re-appends the rebuild (the engine chains the branch tail to it).
    act(() => {
      api().replaceCommand(0, branchPrintId, {
        kind: "print",
        template: '"from branch"',
      });
    });
    const rebuilt = api().snapshot.commands.find(
      (c) => c.kind === "print" && c.id !== headPrintId && c.id !== joinId,
    );
    if (rebuilt === undefined) throw new Error("rebuilt print not created");
    expect(rebuilt.id).not.toBe(branchPrintId);
    expect(rebuilt.template).toBe('"from branch"');

    // The engine's branch list carries the rebuild and the run reaches
    // it (the branch tail chains to the rebuilt head).
    const listed = optilotus_listCommands(0);
    if (listed.status !== "ok") throw new Error("list failed");
    const ifRow = listed.commands.find((c) => c.kind === "if");
    expect(ifRow?.then_body?.includes(rebuilt.id)).toBe(true);
    expect(runPrints(api)).toEqual(["5", "from branch", "5"]);

    // Undo restores the original member and its branch membership.
    act(() => {
      api().undo();
    });
    const restored = api().snapshot.commands.find(
      (c) => c.kind === "print" && c.id !== headPrintId && c.id !== joinId,
    );
    if (restored === undefined) throw new Error("restored print not created");
    expect(restored.template).toBe('"{x}"');
    expect(runPrints(api)).toEqual(["5", "5", "5"]);
  });

  it("refuses in-place cast edits and keeps the program runnable", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "declare", name: "x", ty: "int32", init: "5" });
    });
    // A pre-migration cast row: a hidden anchor declare plus a real
    // cast that both converts and creates the variable (`x_i64`). Built
    // through the raw bridge because nothing creates this shape through
    // the UI any more; `collapseCasting` still recognises it on read,
    // so the row carries the group's conversion info.
    const legacyAnchor = optilotus_declare(
      0,
      "__aqualotus_internal_anchor_x_i64",
      optilotus_type.int32,
    );
    if (isOptilotusError(legacyAnchor)) {
      throw new Error(JSON.stringify(legacyAnchor));
    }
    const legacyCast = optilotus_cast(0, "x_i64", optilotus_type.int64, "{x}");
    if (isOptilotusError(legacyCast)) {
      throw new Error(JSON.stringify(legacyCast));
    }
    act(() => {
      api().refresh();
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x_i64}"' });
    });

    const castId = api().snapshot.commands.find((c) => c.casting)?.id ?? -1;
    const declareId = api().snapshot.commands.find((c) => c.kind === "declare")?.id ?? -1;
    const printId = api().snapshot.commands.find((c) => c.kind === "print")?.id ?? -1;
    expect(castId).toBeGreaterThan(0);
    expect(declareId).toBeGreaterThan(0);
    expect(printId).toBeGreaterThan(0);
    act(() => {
      api().applyLinks(0, {
        edits: [
          { id: declareId, next: castId },
          { id: castId, next: printId },
        ],
        entry: { type: "set", entry: declareId },
      });
    });
    expect(runPrints(api)).toEqual(["5"]);

    // Rename attempt via the Inspector's editor (replaceCommand): the
    // edit is refused with an explanation — the engine holds the
    // conversion as a hidden group whose compute has no user-level id
    // the editor could re-link. The block stays verbatim.
    act(() => {
      api().replaceCommand(0, castId, {
        kind: "cast",
        name: "y_i64",
        to: "int64",
        expr: "{x}",
      });
    });
    expect(api().snapshot.actionError).toContain("cannot be edited in place");

    // Same-name edit (only expression drift): refused the same way.
    act(() => {
      api().replaceCommand(0, castId, {
        kind: "cast",
        name: "x_i64",
        to: "int64",
        expr: "x",
      });
    });
    expect(api().snapshot.actionError).toContain("cannot be edited in place");

    // The program is untouched by the refused edits and still runs.
    expect(runPrints(api)).toEqual(["5"]);
  });
});
