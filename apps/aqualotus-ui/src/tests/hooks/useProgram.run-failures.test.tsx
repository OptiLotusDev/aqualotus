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
  declareDraft,
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

/**
 * Run failures — **mocked bridge**.
 *
 * The mock lets the test choose the id the engine blames, so the UI's
 * mapping rules can be checked against a known internal node id. This
 * proves the UI's own logic; the real-engine counterpart
 * (`useProgram.engine.test.tsx`) proves what the engine actually
 * reports.
 */
describe("useProgram run failures (mocked bridge)", () => {
  beforeEach(() => {
    reset();
    resetSeq();
  });

  function setup() {
    return renderHook(() => useProgram(true, issueSeq));
  }

  /** One declared block, so the projection holds a visible block id. */
  function addDeclare(
    getApi: () => ReturnType<typeof useProgram>,
  ): number {
    act(() => {
      getApi().addCommand(0, declareDraft("a"));
    });
    const id = getApi().snapshot.commands.find((c) => c.var === "a")?.id;
    expect(id).toBeTypeOf("number");
    return id ?? -1;
  }

  it("resolves a failure whose node is the block's own node", () => {
    const view = setup();
    const api = (): ReturnType<typeof useProgram> => view.result.current;
    const blockId = addDeclare(api);
    ctl.runError = {
      kind: "UnknownVariable",
      command: blockId,
      message: `unknown variable "ghost" at ${blockId}`,
      var: "ghost",
    };

    act(() => {
      api().run();
    });

    // The failure keeps its family, its message and its fields.
    expect(api().snapshot.error?.kind).toBe("UnknownVariable");
    expect(api().snapshot.error?.message).toContain(
      'unknown variable "ghost"',
    );
    expect(api().snapshot.error?.var).toBe("ghost");
    // The blamed node is the block's own node, so the block is the
    // target.
    expect(api().snapshot.errorBlockId).toBe(blockId);
    expect(api().snapshot.errorFunctionId).toBe(0);
  });

  it("leaves a failure on an internal node unresolved", () => {
    const view = setup();
    const api = (): ReturnType<typeof useProgram> => view.result.current;
    const blockId = addDeclare(api);
    // The engine blamed a hidden node of the block's group.
    ctl.runError = {
      kind: "TypeMismatch",
      command: blockId + 1000,
      message: "type mismatch",
      detail: "int32 vs string",
    };

    act(() => {
      api().run();
    });

    expect(api().snapshot.error?.kind).toBe("TypeMismatch");
    expect(api().snapshot.error?.detail).toBe("int32 vs string");
    // No block owns that node: the UI names none.
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
  });

  it("clears the failure and its target when the failure is dismissed", () => {
    const view = setup();
    const api = (): ReturnType<typeof useProgram> => view.result.current;
    const blockId = addDeclare(api);
    ctl.runError = {
      kind: "UnknownVariable",
      command: blockId,
      message: "unknown variable",
    };

    act(() => {
      api().run();
    });
    expect(api().snapshot.errorBlockId).toBe(blockId);

    act(() => {
      api().dismissError();
    });
    expect(api().snapshot.error).toBeNull();
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
    expect(api().snapshot.actionError).toBe("");
  });

  it("does not keep the target of an earlier run", () => {
    const view = setup();
    const api = (): ReturnType<typeof useProgram> => view.result.current;
    const blockId = addDeclare(api);
    ctl.runError = {
      kind: "UnknownVariable",
      command: blockId,
      message: "unknown variable",
    };
    act(() => {
      api().run();
    });
    expect(api().snapshot.errorBlockId).toBe(blockId);

    // The next run succeeds: neither the failure nor its target may
    // survive it.
    ctl.runError = null;
    act(() => {
      api().run();
    });
    expect(api().snapshot.error).toBeNull();
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
  });
});
