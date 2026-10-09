import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { planDropLink } from "../lib/graph";
import type { CommandDraft } from "../lib/program";

// ------------------------------------------------------------------
// In-memory bridge mock mirroring engine semantics: monotonic ids
// (never reused), entry auto-assign on append, predecessor repair on
// delete, and typed validation failures. User-level only (no hidden
// raw pair expansion) — identical observable behavior for history,
// entry, and link logic under test.
// ------------------------------------------------------------------
const ctl = vi.hoisted(() => ({
  failDeleteOnce: false,
}));

type Row = {
  id: number;
  kind: "declare" | "assign" | "print" | "return";
  next: number | null;
  var?: string;
  ty?: string;
  expr?: string;
  template?: string;
};

const db = vi.hoisted(() => ({
  functions: new Map<number, { id: number; name: string }>(),
  commands: new Map<number, Row[]>(),
  entries: new Map<number, number | null>(),
  nextFunctionId: 1,
  nextCommandId: 1,
}));

function ok<T extends object>(v: T): T & { status: "ok" } {
  return { status: "ok", ...v };
}
function err(command: number | null, message: string): {
  status: "error";
  kind: string;
  command: number | null;
  message: string;
} {
  return { status: "error", kind: "PackageError", command, message };
}

const INT_TAGS = [
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
];
const ALL_TAGS = [
  ...INT_TAGS,
  "float32",
  "float64",
  "bool",
  "char",
  "string",
  "void",
];

function parseInit(ty: string, text: string): boolean {
  const t = text.trim();
  if (ty === "string") return true;
  if (ty === "bool") return t === "true" || t === "false";
  if (ty === "char") return [...t].length === 1;
  if (ty === "float32" || ty === "float64") {
    return t !== "" && Number.isFinite(Number(t));
  }
  if (!/^-?\d+$/.test(t)) return false;
  const n = Number(t);
  switch (ty) {
    case "int8":
      return n >= -128 && n <= 127;
    case "uint8":
      return n >= 0 && n <= 255;
    case "int16":
      return n >= -32768 && n <= 32767;
    case "uint16":
      return n >= 0 && n <= 65535;
    case "int32":
      return n >= -2147483648 && n <= 2147483647;
    case "uint32":
      return n >= 0 && n <= 4294967295;
    default:
      return true;
  }
}

function rows(fid: number): Row[] {
  const list = db.commands.get(fid);
  if (list === undefined) throw new Error("unknown function");
  return list;
}
function walkTail(fid: number): number | null {
  const entry = db.entries.get(fid) ?? null;
  if (entry === null) return null;
  const list = rows(fid);
  let cur = entry;
  for (;;) {
    const row = list.find((r) => r.id === cur);
    if (row === undefined) return null;
    if (row.next === null) return cur;
    const nxt = list.find((r) => r.id === row.next);
    if (nxt === undefined) return cur;
    cur = nxt.id;
  }
}
function append(fid: number, row: Row): void {
  const list = rows(fid);
  list.push(row);
  const entry = db.entries.get(fid) ?? null;
  if (entry === null) {
    db.entries.set(fid, row.id);
  } else {
    const tail = walkTail(fid);
    if (tail === null) {
      db.entries.set(fid, row.id);
    } else if (tail !== row.id) {
      const t = list.find((r) => r.id === tail);
      if (t !== undefined && t.next === null) t.next = row.id;
    }
  }
}

vi.mock("../lib/optilotus", () => ({
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
  optilotus_tryEnsure: vi.fn(() => Promise.resolve()),
  optilotus_version: vi.fn(() => "test"),
  optilotus_health: vi.fn(() => "ok"),
  optilotus_listFunctions: vi.fn(() => {
    const functions = [...db.functions.values()].map((f) => ({
      id: f.id,
      name: f.name,
      isMain: f.id === 0,
    }));
    return { status: "ok", functions };
  }),
  optilotus_createFunction: vi.fn((name: string) => {
    const id = db.nextFunctionId++;
    db.functions.set(id, { id, name });
    db.commands.set(id, []);
    db.entries.set(id, null);
    return ok({ id, name, isMain: false });
  }),
  optilotus_getFunction: vi.fn((id: number) => {
    const f = db.functions.get(id);
    if (f === undefined) return err(null, `unknown function ${id}`);
    return ok({
      id: f.id,
      name: f.name,
      isMain: f.id === 0,
      entry: db.entries.get(id) ?? null,
      commandCount: (db.commands.get(id) ?? []).length,
    });
  }),
  optilotus_deleteFunction: vi.fn((id: number) => {
    if (!db.functions.has(id)) return err(null, `unknown function ${id}`);
    db.functions.delete(id);
    db.commands.delete(id);
    db.entries.delete(id);
    return ok({ deleted: id });
  }),
  optilotus_clearPackage: vi.fn(() => ({ status: "ok", cleared: 0 })),
  optilotus_declare: vi.fn(
    (fid: number, name: string, ty: string, init?: string) => {
      if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
      if (!ALL_TAGS.includes(ty)) return err(null, `unknown type ${ty}`);
      if (ty === "void")
        return err(null, "cannot declare a variable of type void");
      const list = rows(fid);
      if (list.some((r) => r.kind === "declare" && r.var === name)) {
        return err(null, `variable ${JSON.stringify(name)} is already declared`);
      }
      if (init !== undefined && !parseInit(ty, init)) {
        return err(null, `invalid ${ty} literal ${JSON.stringify(init)}`);
      }
      const id = db.nextCommandId++;
      append(fid, {
        id,
        kind: "declare",
        next: null,
        var: name,
        ty,
        expr: init,
      });
      return ok({ id });
    },
  ),
  optilotus_assign: vi.fn((fid: number, name: string, expr: string) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    const list = rows(fid);
    if (!list.some((r) => r.kind === "declare" && r.var === name)) {
      return err(
        null,
        `cannot assign undeclared variable ${JSON.stringify(name)}: declare it first`,
      );
    }
    if (expr.trim() === "")
      return err(null, "assign expression must not be empty");
    const id = db.nextCommandId++;
    append(fid, { id, kind: "assign", next: null, var: name, expr });
    return ok({ id });
  }),
  optilotus_print: vi.fn((fid: number, template: string) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    const id = db.nextCommandId++;
    append(fid, { id, kind: "print", next: null, template });
    return ok({ id });
  }),
  optilotus_return: vi.fn((fid: number, expr: string) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    if (expr.trim() === "")
      return err(null, "return expression must not be empty");
    const id = db.nextCommandId++;
    append(fid, { id, kind: "return", next: null, expr });
    return ok({ id });
  }),
  optilotus_listCommands: vi.fn((fid: number) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    return ok({
      commands: rows(fid).map((r) => ({ ...r })),
    });
  }),
  optilotus_setEntry: vi.fn((fid: number, cmd: number | null) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    if (cmd !== null && !rows(fid).some((r) => r.id === cmd)) {
      return err(cmd, `unknown command ${cmd}`);
    }
    db.entries.set(fid, cmd);
    return ok({});
  }),
  optilotus_setNext: vi.fn((fid: number, cmd: number, next?: number) => {
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    const list = rows(fid);
    const row = list.find((r) => r.id === cmd);
    if (row === undefined) return err(cmd, `unknown command ${cmd}`);
    const target = next ?? null;
    if (target !== null && !list.some((r) => r.id === target)) {
      return err(target, `unknown command ${target}`);
    }
    row.next = target;
    return ok({});
  }),
  optilotus_deleteCommand: vi.fn((fid: number, cmd: number) => {
    if (ctl.failDeleteOnce) {
      ctl.failDeleteOnce = false;
      return err(cmd, "injected delete failure");
    }
    if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
    const list = rows(fid);
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
  }),
  optilotus_runProgram: vi.fn(() => ({ status: "ok", steps: 1, prints: 0, printed: [] })),
}));

import { useProgram } from "./useProgram";

function resetDb(): void {
  db.functions.clear();
  db.commands.clear();
  db.entries.clear();
  db.functions.set(0, { id: 0, name: "main" });
  db.commands.set(0, []);
  db.entries.set(0, null);
  db.nextFunctionId = 1;
  db.nextCommandId = 1;
  ctl.failDeleteOnce = false;
}

let seq = 0;
function issueSeq(): number {
  seq += 1;
  return seq;
}

function declareDraft(name: string, init = "1"): CommandDraft {
  return { kind: "declare", name, ty: "int32", init };
}

describe("useProgram history and error semantics", () => {
  beforeEach(() => {
    resetDb();
    seq = 0;
  });

  function setup(): ReturnType<typeof renderHook<ReturnType<typeof useProgram>, unknown>> {
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
    // Link a → b → c through real link plans (detached insert order).
    let list = getApi().snapshot.commands.map((x) => ({ id: x.id, next: x.next ?? null }));
    const first = planDropLink(list, null, a, b, "before");
    expect(first).not.toBe(null);
    act(() => {
      getApi().applyLinks(0, first!);
    });
    list = getApi().snapshot.commands.map((x) => ({ id: x.id, next: x.next ?? null }));
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
      api().addCommand(0, { kind: "declare", name: "bad", ty: "int32", init: "abc" });
    });
    expect(api().snapshot.actionError).not.toBe("");
    expect(api().snapshot.commands).toHaveLength(before);
    act(() => {
      api().addCommand(0, { kind: "declare", name: "bad2", ty: "bool", init: "maybe" });
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
      api().addCommand(0, { kind: "declare", name: "zero", ty: "int32", init: "0" });
    });
    const zero = api().snapshot.commands.find((c) => c.var === "zero");
    expect(zero?.expr).toBe("0");
    const omitted = api().snapshot.commands.find((c) => c.var === "v0");
    expect(omitttedExpr(omitted)).toBe(undefined);
  });
});

function omitttedExpr(
  row: { expr?: string } | undefined,
): string | undefined {
  return row?.expr;
}
