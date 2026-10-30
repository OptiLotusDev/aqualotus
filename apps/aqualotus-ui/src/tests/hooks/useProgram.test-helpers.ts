import type { CommandDraft } from "../../lib/program";

type Row = {
  id: number;
  kind: "declare" | "assign" | "print" | "return";
  next: number | null;
  var?: string;
  ty?: string;
  access?: string;
  expr?: string;
  template?: string;
};

type BridgeCtl = {
  failDeleteOnce: boolean;
  runError: null | {
    kind: string;
    command: number | null;
    message: string;
    detail?: string;
    var?: string;
  };
};

type BridgeDb = {
  functions: Map<number, { id: number; name: string }>;
  commands: Map<number, Row[]>;
  entries: Map<number, number | null>;
  nextFunctionId: number;
  nextCommandId: number;
};

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

function rows(db: BridgeDb, fid: number): Row[] {
  const list = db.commands.get(fid);
  if (list === undefined) throw new Error("unknown function");
  return list;
}
function walkTail(db: BridgeDb, fid: number): number | null {
  const entry = db.entries.get(fid) ?? null;
  if (entry === null) return null;
  const list = rows(db, fid);
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
function append(db: BridgeDb, fid: number, row: Row): void {
  const list = rows(db, fid);
  list.push(row);
  const entry = db.entries.get(fid) ?? null;
  if (entry === null) {
    db.entries.set(fid, row.id);
  } else {
    const tail = walkTail(db, fid);
    if (tail === null) {
      db.entries.set(fid, row.id);
    } else if (tail !== row.id) {
      const t = list.find((r) => r.id === tail);
      if (t !== undefined && t.next === null) t.next = row.id;
    }
  }
}

function declareInMock(
  db: BridgeDb,
  fid: number,
  name: string,
  ty: string,
  access: string,
  init?: string,
) {
  if (!db.functions.has(fid)) return err(null, `unknown function ${fid}`);
  if (!ALL_TAGS.includes(ty)) return err(null, `unknown type ${ty}`);
  if (ty === "void")
    return err(null, "cannot declare a variable of type void");
  if (!["public", "protected", "private"].includes(access)) {
    return err(null, `unknown access modifier ${JSON.stringify(access)}`);
  }
  const list = rows(db, fid);
  if (list.some((r) => r.kind === "declare" && r.var === name)) {
    return err(null, `variable ${JSON.stringify(name)} is already declared`);
  }
  if (init !== undefined && !parseInit(ty, init)) {
    return err(null, `invalid ${ty} literal ${JSON.stringify(init)}`);
  }
  const id = db.nextCommandId++;
  append(db, fid, {
    id,
    kind: "declare",
    next: null,
    var: name,
    ty,
    access,
    expr: init,
  });
  return ok({ id });
}

export {
  ok,
  err,
  parseInit,
  rows,
  walkTail,
  append,
  declareInMock,
  INT_TAGS,
  ALL_TAGS,
  type Row,
};
export type { BridgeCtl, BridgeDb };

let seq = 0;
export function issueSeq(): number {
  seq += 1;
  return seq;
}

export function resetSeq(): void {
  seq = 0;
}

export function declareDraft(name: string, init = "1"): CommandDraft {
  return { kind: "declare", name, ty: "int32", init };
}

export function resetDb(db: BridgeDb, ctl: BridgeCtl): void {
  db.functions.clear();
  db.commands.clear();
  db.entries.clear();
  db.functions.set(0, { id: 0, name: "main" });
  db.commands.set(0, []);
  db.entries.set(0, null);
  db.nextFunctionId = 1;
  db.nextCommandId = 1;
  ctl.failDeleteOnce = false;
  ctl.runError = null;
}
