import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useProgram } from "../../hooks/useProgram";
import {
  ok,
  err,
  rows,
  append,
  declareInMock,
  resetDb,
  resetSeq,
  issueSeq,
  type BridgeCtl,
  type BridgeDb,
  type Row,
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

describe("useProgram rename function", () => {
  beforeEach(() => {
    reset();
    resetSeq();
  });

  function setup() {
    return renderHook(() => useProgram(true, issueSeq));
  }

  it("renames a function with undo/redo and rejects duplicates", () => {
    const { result } = setup();
    const api = (): ReturnType<typeof useProgram> => result.current;
    act(() => {
      api().createFunction("helper");
    });
    expect(api().snapshot.functions.map((f) => f.name)).toEqual([
      "main",
      "helper",
    ]);
    const helper = api().snapshot.functions.find((f) => f.name === "helper")?.id ?? -1;

    act(() => {
      api().renameFunction(helper, "worker");
    });
    expect(api().snapshot.actionError).toBe("");
    expect(api().snapshot.functions.find((f) => f.id === helper)?.name).toBe(
      "worker",
    );

    act(() => {
      api().undo();
    });
    expect(api().snapshot.functions.find((f) => f.id === helper)?.name).toBe(
      "helper",
    );
    act(() => {
      api().redo();
    });
    expect(api().snapshot.functions.find((f) => f.id === helper)?.name).toBe(
      "worker",
    );

    // Duplicates fail honestly and record no history entry.
    const canUndo = api().canUndo;
    act(() => {
      api().renameFunction(helper, "main");
    });
    expect(api().snapshot.actionError).not.toBe("");
    expect(api().snapshot.functions.find((f) => f.id === helper)?.name).toBe(
      "worker",
    );
    expect(api().canUndo).toBe(canUndo);
  });
});
