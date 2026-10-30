import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { planDropLink } from "../../lib/graph";
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

describe("useProgram history — chain delete/undo/entry", () => {
  beforeEach(() => {
    reset();
    resetSeq();
  });

  function setup() {
    return renderHook(() => useProgram(true, issueSeq));
  }

  function chainAbc(
    getApi: () => ReturnType<typeof useProgram>,
  ): { a: number; b: number; c: number } {
    act(() => {
      getApi().addCommand(0, declareDraft("a"));
    });
    act(() => {
      getApi().addCommand(0, declareDraft("b", "2"));
    });
    act(() => {
      getApi().addCommand(0, declareDraft("c", "3"));
    });
    const cmds = getApi().snapshot.commands;
    const a = cmds.find((c) => c.var === "a")?.id ?? -1;
    const b = cmds.find((c) => c.var === "b")?.id ?? -1;
    const c = cmds.find((c) => c.var === "c")?.id ?? -1;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(0);
    // Link a -> b -> c through real link plans (detached insert order).
    let list = getApi().snapshot.commands.map((x) => ({
      id: x.id,
      next: x.next ?? null,
    }));
    const first = planDropLink(list, null, a, b, "before");
    expect(first).not.toBe(null);
    act(() => {
      getApi().applyLinks(0, first!);
    });
    list = getApi().snapshot.commands.map((x) => ({
      id: x.id,
      next: x.next ?? null,
    }));
    const entry = getApi().snapshot.selected?.entry ?? null;
    const second = planDropLink(list, entry, b, c, "before");
    expect(second).not.toBe(null);
    act(() => {
      getApi().applyLinks(0, second!);
    });
    return { a, b, c };
  }

  it("Issue 1: delete b, delete c, undo, undo restores the chain", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    const { a, b, c } = chainAbc(api);

    const linksOf = (): Map<number, number | null> => {
      const m = new Map<number, number | null>();
      for (const x of api().snapshot.commands) m.set(x.id, x.next ?? null);
      return m;
    };
    expect(linksOf().get(a)).toBe(b);
    expect(linksOf().get(b)).toBe(c);

    act(() => {
      api().deleteCommand(0, b);
    });
    act(() => {
      api().deleteCommand(0, c);
    });
    expect(api().snapshot.commands.map((x) => x.var)).toEqual(["a"]);

    act(() => {
      api().undo();
    });
    act(() => {
      api().undo();
    });

    const cmds = api().snapshot.commands;
    expect(cmds).toHaveLength(3);
    const ra = cmds.find((x) => x.var === "a")?.id ?? -1;
    const rb = cmds.find((x) => x.var === "b")?.id ?? -1;
    const rc = cmds.find((x) => x.var === "c")?.id ?? -1;
    // Original logical chain preserved with live ids only.
    expect(api().snapshot.selected?.entry).toBe(ra);
    expect(linksOf().get(ra)).toBe(rb);
    expect(linksOf().get(rb)).toBe(rc);
    expect(linksOf().get(rc)).toBe(null);
    const live = new Set(cmds.map((x) => x.id));
    for (const [, next] of linksOf()) {
      if (next !== null) expect(live.has(next)).toBe(true);
    }
    expect(live.has(b) && live.has(c) && b !== rb).toBe(false);
    expect(api().snapshot.actionError).toBe("");

    // Repeated redo/undo cycles stay consistent.
    act(() => {
      api().redo();
    });
    act(() => {
      api().redo();
    });
    expect(api().snapshot.commands.map((x) => x.var)).toEqual(["a"]);
    act(() => {
      api().undo();
    });
    act(() => {
      api().undo();
    });
    expect(api().snapshot.commands).toHaveLength(3);
    expect(api().snapshot.selected?.entry).toBe(
      api().snapshot.commands.find((x) => x.var === "a")?.id ?? -1,
    );
  });

  it("Issue 2: a failed undo keeps the entry and stays predictable", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    act(() => {
      api().addCommand(0, declareDraft("x"));
    });
    expect(api().snapshot.commands).toHaveLength(1);
    expect(api().canUndo).toBe(true);

    ctl.failDeleteOnce = true;
    act(() => {
      api().undo();
    });
    // Failed: command still there, entry stays undoable, nothing redoable.
    expect(api().snapshot.commands).toHaveLength(1);
    expect(api().canUndo).toBe(true);
    expect(api().canRedo).toBe(false);
    expect(api().snapshot.actionError).not.toBe("");

    // Next undo retries the same entry and succeeds.
    act(() => {
      api().undo();
    });
    expect(api().snapshot.commands).toHaveLength(0);
    expect(api().canUndo).toBe(false);
    expect(api().canRedo).toBe(true);
    act(() => {
      api().redo();
    });
    expect(api().snapshot.commands).toHaveLength(1);
  });

  it("Issue 5: detached creation after clearing the entry keeps entry null", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    act(() => {
      api().addCommand(0, declareDraft("x"));
    });
    // Wire it into the chain so an entry exists.
    const x = api().snapshot.commands[0]?.id ?? -1;
    act(() => {
      api().applyLinks(0, { edits: [], entry: { type: "set", entry: x } });
    });
    expect(api().snapshot.selected?.entry).toBe(x);
    act(() => {
      api().clearEntry(0);
    });
    expect(api().snapshot.selected?.entry).toBe(null);

    // Detached creation must not re-establish the entry.
    act(() => {
      api().addCommand(0, declareDraft("y", "2"));
    });
    expect(api().snapshot.selected?.entry).toBe(null);
    const cmds = api().snapshot.commands;
    expect(cmds).toHaveLength(2);
    const y = cmds.find((c) => c.var === "y")?.id ?? -1;
    expect(cmds.find((c) => c.id === y)?.next).toBe(null);

    // Repeat with existing orphans: still detached, entry still null.
    act(() => {
      api().addCommand(0, declareDraft("z", "3"));
    });
    expect(api().snapshot.selected?.entry).toBe(null);
    expect(api().snapshot.commands).toHaveLength(3);

    // Normal append (rewire) still establishes the chain explicitly.
    const list = api().snapshot.commands.map((c) => ({
      id: c.id,
      next: c.next ?? null,
    }));
    const plan = planDropLink(list, null, x, y, "before");
    expect(plan).not.toBe(null);
    act(() => {
      api().applyLinks(0, plan!);
    });
    expect(api().snapshot.selected?.entry).toBe(x);
  });
});
