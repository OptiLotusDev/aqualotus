import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useProgram } from "../../hooks/useProgram";
import {
  ok,
  err,
  rows,
  append,
  declareInMock,
  type Row,
  resetDb,
  resetSeq,
  issueSeq,
  declareDraft,
  type BridgeCtl,
  type BridgeDb,
} from "./useProgram.test-helpers";

const ctl: BridgeCtl = vi.hoisted(() => ({
  failDeleteOnce: false,
  runError: null,
}));
const db: BridgeDb = vi.hoisted(() => ({
  functions: new Map<number, { id: number; name: string }>(),
  commands: new Map<number, Row[]>(),
  entries: new Map<number, number | null>(),
  nextFunctionId: 1,
  nextCommandId: 1,
}));

vi.mock("../../lib/optilotus", () => ({
  optilotus_type: {
    int8: "int8",
    int16: "int16",
    int32: "int32",
    int64: "int64",
    int128: "int128",
    uint8: "uint8",
    uint16: "uint16",
    uint32: "uint32",
    uint64: "uint64",
    uint128: "uint128",
    float32: "float32",
    float64: "float64",
    bool: "bool",
    char: "char",
    string: "string",
    void: "void",
  },
  optilotus_tryEnsure: () => Promise.resolve(),
  optilotus_version: () => "test",
  optilotus_health: () => "ok",
  optilotus_listFunctions: () => {
    const functions = [...db.functions.values()].map((f) => ({
      id: f.id,
      name: f.name,
      isMain: f.id === 0,
    }));
    return { status: "ok", functions };
  },
  optilotus_createFunction: (name: string) => {
    const id = db.nextFunctionId++;
    db.functions.set(id, { id, name });
    db.commands.set(id, []);
    db.entries.set(id, null);
    return ok({ id, name, isMain: false });
  },
  optilotus_getFunction: (id: number) => {
    const f = db.functions.get(id);
    if (f === undefined) return err(null, `unknown function ${id}`);
    return ok({
      id: f.id,
      name: f.name,
      isMain: f.id === 0,
      entry: db.entries.get(id) ?? null,
      commandCount: (db.commands.get(id) ?? []).length,
    });
  },
  optilotus_deleteFunction: (id: number) => {
    if (!db.functions.has(id)) return err(null, `unknown function ${id}`);
    db.functions.delete(id);
    db.commands.delete(id);
    db.entries.delete(id);
    return ok({ deleted: id });
  },
  optilotus_renameFunction: (id: number, name: string) => {
    const f = db.functions.get(id);
    if (f === undefined) return err(null, `unknown function ${id}`);
    const clean = name.trim();
    if (clean === "") return err(null, "function name must not be empty");
    if (clean === "main" && id !== 0) {
      return err(null, 'cannot create function "main": "main" is reserved');
    }
    for (const other of db.functions.values()) {
      if (other.id !== id && other.name === clean) {
        return err(null, `function ${JSON.stringify(clean)} already exists`);
      }
    }
    f.name = clean;
    return ok({ id, name: clean, isMain: id === 0 });
  },
  optilotus_clearPackage: () => ({ status: "ok", cleared: 0 }),
  optilotus_declare: (fid: number, name: string, ty: string, init?: string) =>
    declareInMock(db, fid, name, ty, "private", init),
  optilotus_declareWithAccess: (
    fid: number,
    name: string,
    ty: string,
    access: string,
    init?: string,
  ) => declareInMock(db, fid, name, ty, access, init),
  optilotus_assign: (fid: number, name: string, expr: string) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    const list = rows(db, fid);
    if (!list.some((r) => r.kind === "declare" && r.var === name)) {
      return err(
        null,
        `cannot assign undeclared variable ${JSON.stringify(name)}: declare it first`,
      );
    }
    if (expr.trim() === "")
      return err(null, "assign expression must not be empty");
    const id = db.nextCommandId++;
    append(db, fid, { id, kind: "assign", next: null, var: name, expr });
    return ok({ id });
  },
  optilotus_print: (fid: number, template: string) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    const id = db.nextCommandId++;
    append(db, fid, { id, kind: "print", next: null, template });
    return ok({ id });
  },
  optilotus_return: (fid: number, expr: string) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    if (expr.trim() === "")
      return err(null, "return expression must not be empty");
    const id = db.nextCommandId++;
    append(db, fid, { id, kind: "return", next: null, expr });
    return ok({ id });
  },
  optilotus_listCommands: (fid: number) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    return ok({
      commands: rows(db, fid).map((r) => ({ ...r })),
    });
  },
  optilotus_setEntry: (fid: number, cmd: number | null) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    if (cmd !== null && !rows(db, fid).some((r) => r.id === cmd)) {
      return err(cmd, `unknown command ${cmd}`);
    }
    db.entries.set(fid, cmd);
    return ok({});
  },
  optilotus_setNext: (fid: number, cmd: number, next?: number) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    const list = rows(db, fid);
    const row = list.find((r) => r.id === cmd);
    if (row === undefined) return err(cmd, `unknown command ${cmd}`);
    const target = next ?? null;
    if (target !== null && !list.some((r) => r.id === target)) {
      return err(target, `unknown command ${target}`);
    }
    row.next = target;
    return ok({});
  },
  optilotus_deleteCommand: (fid: number, cmd: number) => {
    if (ctl.failDeleteOnce) {
      ctl.failDeleteOnce = false;
      return err(cmd, "injected delete failure");
    }
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    const list = rows(db, fid);
    const row = list.find((r) => r.id === cmd);
    if (row === undefined) return err(cmd, `unknown command ${cmd}`);
    const successor = row.next;
    for (const r of list) {
      if (r.next === cmd) r.next = successor;
    }
    if ((db.entries.get(fid) ?? null) === cmd) {
      db.entries.set(fid, successor);
    }
    db.commands.set(
      fid,
      list.filter((r) => r.id !== cmd),
    );
    return ok({ deleted: cmd });
  },
  optilotus_runProgram: () => {
    if (ctl.runError !== null) {
      return { status: "error", ...ctl.runError };
    }
    return { status: "ok", steps: 1, prints: 0, printed: [] };
  },
}));

function reset(): void {
  resetDb(db, ctl);
}

describe("useProgram history — links, declare edits, and no-op applies", () => {
  beforeEach(() => {
    reset();
    resetSeq();
  });

  function setup() {
    return renderHook(() => useProgram(true, issueSeq));
  }

  it("Issue 3: an invalid link error survives a reload", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    act(() => {
      api().addCommand(0, declareDraft("x"));
    });
    act(() => {
      api().applyLinks(0, {
        edits: [{ id: 1, next: 999 }],
        entry: { type: "keep" },
      });
    });
    expect(api().snapshot.actionError).not.toBe("");
    const message = api().snapshot.actionError;
    // A subsequent successful load must not erase it.
    act(() => {
      api().refresh();
    });
    expect(api().snapshot.actionError).toBe(message);
    // The UI stays usable: a valid action clears it and works.
    act(() => {
      api().addCommand(0, declareDraft("y", "2"));
    });
    expect(api().snapshot.actionError).toBe("");
    expect(api().snapshot.commands).toHaveLength(2);
  });

  it("Issue 6: assigning to an undeclared variable preserves the block", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    act(() => {
      api().addCommand(0, declareDraft("x"));
    });
    const x = api().snapshot.commands[0]?.id ?? -1;

    // Failed add: nothing created, error + recovery hint, no history.
    act(() => {
      api().addCommand(0, { kind: "assign", name: "ghost", expr: "{ghost}" });
    });
    expect(api().snapshot.commands).toHaveLength(1);
    expect(api().snapshot.actionError).toContain("declare it first");
    expect(api().snapshot.recoveryVar).toBe("ghost");

    // Failed edit: the original block is NOT deleted.
    act(() => {
      api().replaceCommand(0, x, {
        kind: "assign",
        name: "ghost",
        expr: "{ghost}",
      });
    });
    expect(api().snapshot.commands.some((c) => c.id === x)).toBe(true);
    expect(api().snapshot.actionError).toContain("declare it first");

    // Non-destructive recovery: declare, then the assign succeeds.
    act(() => {
      api().declareVariable(0, "ghost");
    });
    expect(api().snapshot.actionError).toBe("");
    act(() => {
      api().addCommand(0, { kind: "assign", name: "ghost", expr: "{ghost}" });
    });
    expect(
      api().snapshot.commands.some(
        (c) => c.kind === "assign" && c.var === "ghost",
      ),
    ).toBe(true);
  });

  it("Issue 7: every supported type allows an omitted initializer", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    const types = [
      "int8",
      "int16",
      "int32",
      "int64",
      "int128",
      "uint8",
      "uint16",
      "uint32",
      "uint64",
      "uint128",
      "float32",
      "float64",
      "bool",
      "char",
      "string",
    ] as const;
    let i = 0;
    for (const ty of types) {
      const name = `v${i++}`;
      act(() => {
        api().addCommand(0, { kind: "declare", name, ty, init: "" });
      });
      expect(api().snapshot.actionError).toBe("");
    }
    expect(api().snapshot.commands).toHaveLength(types.length);

    // Invalid initializers are rejected without creating anything.
    const before = api().snapshot.commands.length;
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "bad",
        ty: "int32",
        init: "abc",
      });
    });
    expect(api().snapshot.actionError).not.toBe("");
    expect(api().snapshot.commands).toHaveLength(before);
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "bad2",
        ty: "bool",
        init: "maybe",
      });
    });
    expect(api().snapshot.commands).toHaveLength(before);

    // `void` can never be declared.
    act(() => {
      api().addCommand(0, { kind: "declare", name: "v", ty: "void", init: "" });
    });
    expect(api().snapshot.commands).toHaveLength(before);

    // A valid literal (including 0-like values) is stored distinctly
    // from an omitted initializer.
    act(() => {
      api().addCommand(0, {
        kind: "declare",
        name: "zero",
        ty: "int32",
        init: "0",
      });
    });
    const zero = api().snapshot.commands.find((c) => c.var === "zero");
    expect(zero?.expr).toBe("0");
    const omitted = api().snapshot.commands.find((c) => c.var === "v0");
    expect(omitted?.expr).toBe(undefined);
  });

  it("edits a declare to a new type and keeps it", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    act(() => {
      api().addCommand(0, declareDraft("x"));
    });
    const x = api().snapshot.commands[0]?.id ?? -1;
    act(() => {
      api().replaceCommand(0, x, {
        kind: "declare",
        name: "x",
        ty: "string",
        init: "hi",
      });
    });
    expect(api().snapshot.actionError).toBe("");
    expect(api().snapshot.commands).toHaveLength(1);
    expect(api().snapshot.commands[0]?.ty).toBe("string");
    // Undo restores the old type in place; redo reapplies the new one.
    act(() => {
      api().undo();
    });
    expect(api().snapshot.commands[0]?.ty).toBe("int32");
    act(() => {
      api().redo();
    });
    expect(api().snapshot.commands[0]?.ty).toBe("string");
  });

  it("keeps the old declare when the new type rejects the kept value", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    act(() => {
      api().addCommand(0, declareDraft("x"));
    });
    const x = api().snapshot.commands[0]?.id ?? -1;
    // "1" is not a bool literal: the edit fails and the int32 block
    // survives untouched instead of being deleted.
    act(() => {
      api().replaceCommand(0, x, {
        kind: "declare",
        name: "x",
        ty: "bool",
        init: "1",
      });
    });
    expect(api().snapshot.actionError).not.toBe("");
    expect(api().snapshot.commands).toHaveLength(1);
    expect(api().snapshot.commands[0]?.ty).toBe("int32");
  });

  it("ignores no-op applies without history churn", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    act(() => {
      api().addCommand(0, declareDraft("x"));
    });
    expect(api().canUndo).toBe(true);
    const x = api().snapshot.commands[0]?.id ?? -1;
    // Identical re-apply: no churn, no history entry — the next undo
    // removes the block itself instead of "undoing" a phantom edit.
    act(() => {
      api().replaceCommand(0, x, declareDraft("x"));
    });
    expect(api().snapshot.actionError).toBe("");
    act(() => {
      api().undo();
    });
    expect(api().snapshot.commands).toHaveLength(0);
    expect(api().canUndo).toBe(false);
  });

  it("rebuilds dependent assigns when a declare type changes", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    act(() => {
      api().addCommand(0, declareDraft("x"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "x", expr: "{x} + 1" });
    });
    const before = api().snapshot.commands.map((c) => c.id);
    expect(before).toHaveLength(2);
    const declareId = api().snapshot.commands[0]?.id ?? -1;

    // int32 -> string: the declare swaps AND the assign is rebuilt so
    // its baked-in engine type follows (no stale TypeMismatch at run).
    act(() => {
      api().replaceCommand(0, declareId, {
        kind: "declare",
        name: "x",
        ty: "string",
        init: "hi",
      });
    });
    expect(api().snapshot.actionError).toBe("");
    const cmds = api().snapshot.commands;
    expect(cmds).toHaveLength(2);
    expect(cmds.map((c) => c.kind)).toEqual(["declare", "assign"]);
    expect(cmds[0]?.ty).toBe("string");
    expect(cmds[1]).toMatchObject({ var: "x", expr: "{x} + 1" });
    // Both blocks were recreated under fresh ids (deleted ids stay dead).
    expect(cmds[0]?.id).not.toBe(before[0]);
    expect(cmds[1]?.id).not.toBe(before[1]);

    // One atomic undo restores the old declare and the old assign.
    act(() => {
      api().undo();
    });
    expect(api().snapshot.actionError).toBe("");
    const undone = api().snapshot.commands;
    expect(undone).toHaveLength(2);
    expect(undone[0]?.ty).toBe("int32");
    expect(undone[1]).toMatchObject({ var: "x", expr: "{x} + 1" });

    act(() => {
      api().redo();
    });
    expect(api().snapshot.commands[0]?.ty).toBe("string");
    expect(api().snapshot.commands).toHaveLength(2);
  });
});
