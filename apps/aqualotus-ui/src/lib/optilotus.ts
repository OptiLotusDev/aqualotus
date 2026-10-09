import init, {
  optilotus_assign as assign_wasm,
  optilotus_clearPackage as clearPackage_wasm,
  optilotus_createFunction as createFunction_wasm,
  optilotus_declare as declare_wasm,
  optilotus_deleteCommand as deleteCommand_wasm,
  optilotus_deleteFunction as deleteFunction_wasm,
  optilotus_getFunction as getFunction_wasm,
  optilotus_health as health_wasm,
  optilotus_listCommands as listCommands_wasm,
  optilotus_listFunctions as listFunctions_wasm,
  optilotus_print as print_wasm,
  optilotus_renameFunction as renameFunction_wasm,
  optilotus_return as return_wasm,
  optilotus_runProgram as runProgram_wasm,
  optilotus_setEntry as setEntry_wasm,
  optilotus_setNext as setNext_wasm,
  optilotus_version as version_wasm,
} from "../wasm/optilotus/optilotus.js";

// Project rule: every function in the UI that originates from the
// Optilotus API layer carries the `optilotus_` prefix with a camelCase
// remainder (e.g. `optilotus_runProgram`). This deliberately takes
// precedence over the generic camelCase rule (P9/P24) for this module.
// The `_wasm` aliases keep the bridge exports exactly `optilotus_*`.

// Ownership (P10): this module owns WASM init state. `ready` is the
// single-flight init promise; `loaded` records completion. Nothing else
// may mutate them. Callers must await `optilotus_tryEnsure()` first;
// sync wrappers enforce that via `assertReady()` (P14/P22).
//
// Failure semantics: a rejected `ready` is cleared (only when the
// failed promise is still the current attempt) so a later call retries
// instead of replaying the same rejection forever. Concurrent callers
// share one in-flight promise; `loaded` flips only on success.
let ready: Promise<void> | null = null;
let loaded = false;

/**
 * Load the Optilotus WASM module once. Resolves when callable.
 * Rejects (caller handles it) when loading fails, e.g. bad MIME type.
 *
 * Concurrent callers share the single in-flight promise. A failure
 * clears the cache (guarded on identity, so a stale rejection can
 * never invalidate a newer attempt) and the next call retries.
 */
export function optilotus_tryEnsure(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (ready === null) {
    const attempt: Promise<void> = init().then(() => {
      loaded = true;
    });
    ready = attempt;
    // Guarded rejection handler: reset only when the failed promise is
    // still the current attempt. Never resets a newer in-flight attempt,
    // never touches `loaded` (success path owns it).
    attempt.catch(() => {
      if (ready === attempt) {
        ready = null;
      }
    });
  }
  return ready;
}

/** Test-only reset of the init cache (drops success + failure state). */
export function optilotus_resetInitForTesting(): void {
  ready = null;
  loaded = false;
}

/** Throw an explicit error when called before successful init (P22). */
function assertReady(): void {
  if (!loaded) {
    throw new Error(
      "Optilotus WASM is not loaded. Await optilotus_tryEnsure() first.",
    );
  }
}

/** Crate version string. Requires init. */
export function optilotus_version(): string {
  assertReady();
  return version_wasm();
}

/** Health check ("ok"). Requires init. */
export function optilotus_health(): string {
  assertReady();
  return health_wasm();
}

/**
 * Package registry: one package, many functions, stable `main` (id 0).
 * Typed wrappers only — JSON is parsed once inside each wrapper, so UI
 * call sites never build or pass IR JSON.
 */
export type FunctionId = number;
export type CommandId = number;

/**
 * Scalar type tags (mirrors Rust `Type::tag()`).
 * Use as `optilotus_type.int32` instead of raw `"int32"` strings.
 */
export const optilotus_type = {
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
} as const;

export type OptilotusType =
  (typeof optilotus_type)[keyof typeof optilotus_type];

export type FunctionSummary = {
  id: number;
  name: string;
  isMain: boolean;
};

export type FunctionInfo = {
  id: number;
  name: string;
  isMain: boolean;
  entry: number | null;
  commandCount: number;
};

export type CommandSummary = {
  id: number;
  kind: "declare" | "assign" | "print" | "return" | "if";
  /** Following user command head; `null` at the tail end or when cleared. */
  next: number | null;
  var?: string;
  ty?: OptilotusType;
  expr?: string;
  template?: string;
  /** `if` only: condition value id, branch bodies (ordered command ids). */
  condition?: number;
  then_body?: number[];
  else_body?: number[];
};

export type OptilotusError = {
  status: "error";
  kind: string;
  command: number | null;
  message: string;
  [key: string]: unknown;
};

function parseBridge<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export function optilotus_listFunctions(): {
  status: "ok";
  functions: FunctionSummary[];
} {
  assertReady();
  return parseBridge(listFunctions_wasm());
}

export function optilotus_createFunction(
  name: string,
):
  | { status: "ok"; id: number; name: string; isMain: boolean }
  | OptilotusError {
  assertReady();
  return parseBridge(createFunction_wasm(name));
}

export function optilotus_getFunction(
  id: number,
): ({ status: "ok" } & FunctionInfo) | OptilotusError {
  assertReady();
  return parseBridge(getFunction_wasm(id));
}

export function optilotus_deleteFunction(
  id: number,
): { status: "ok"; deleted: number } | OptilotusError {
  assertReady();
  return parseBridge(deleteFunction_wasm(id));
}

export function optilotus_renameFunction(
  id: number,
  name: string,
):
  | { status: "ok"; id: number; name: string; isMain: boolean }
  | OptilotusError {
  assertReady();
  return parseBridge(renameFunction_wasm(id, name));
}

export function optilotus_clearPackage(): {
  status: "ok";
  cleared: number;
} {
  assertReady();
  return parseBridge(clearPackage_wasm());
}

export function optilotus_declare(
  fid: number,
  name: string,
  ty: OptilotusType,
  init?: string,
): { status: "ok"; id: number } | OptilotusError {
  assertReady();
  return parseBridge(declare_wasm(fid, name, ty, init));
}

export function optilotus_assign(
  fid: number,
  name: string,
  expr: string,
): { status: "ok"; id: number } | OptilotusError {
  assertReady();
  return parseBridge(assign_wasm(fid, name, expr));
}

export function optilotus_print(
  fid: number,
  template: string,
): { status: "ok"; id: number } | OptilotusError {
  assertReady();
  return parseBridge(print_wasm(fid, template));
}

export function optilotus_return(
  fid: number,
  expr: string,
): { status: "ok"; id: number } | OptilotusError {
  assertReady();
  return parseBridge(return_wasm(fid, expr));
}

export function optilotus_listCommands(
  fid: number,
):
  | { status: "ok"; commands: CommandSummary[] }
  | OptilotusError {
  assertReady();
  return parseBridge(listCommands_wasm(fid));
}

export function optilotus_setEntry(
  fid: number,
  cmd: number | null,
): { status: "ok" } | OptilotusError {
  assertReady();
  return parseBridge(setEntry_wasm(fid, cmd));
}

export function optilotus_setNext(
  fid: number,
  cmd: number,
  next?: number,
): { status: "ok" } | OptilotusError {
  assertReady();
  return parseBridge(setNext_wasm(fid, cmd, next));
}

export function optilotus_deleteCommand(
  fid: number,
  cmd: number,
): { status: "ok"; deleted: number } | OptilotusError {
  assertReady();
  return parseBridge(deleteCommand_wasm(fid, cmd));
}

/** Typed result of `optilotus_runProgram()` (parsed once, inside). */
export type RunOk = {
  status: "ok";
  steps: number;
  prints: number;
  printed: string[];
};

export type RunErr = {
  status: "error";
  kind: string;
  command: number | null;
  message: string;
  [key: string]: unknown;
};

export type RunResult = RunOk | RunErr;

/**
 * Run `main` by id only — no IR JSON crosses the boundary.
 * Returns the parsed `RunResult` (JSON stays inside the bridge).
 * Requires init.
 */
export function optilotus_runProgram(): RunResult {
  assertReady();
  return JSON.parse(runProgram_wasm()) as RunResult;
}
