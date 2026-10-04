import init, {
  optilotus_assign as assign_wasm,
  optilotus_clear as clear_wasm,
  optilotus_clearPackage as clearPackage_wasm,
  optilotus_createFunction as createFunction_wasm,
  optilotus_declare as declare_wasm,
  optilotus_deleteCommand as deleteCommand_wasm,
  optilotus_deleteFunction as deleteFunction_wasm,
  optilotus_execMath as execMath_wasm,
  optilotus_get as get_wasm,
  optilotus_getFunction as getFunction_wasm,
  optilotus_health as health_wasm,
  optilotus_listCommands as listCommands_wasm,
  optilotus_listFunctions as listFunctions_wasm,
  optilotus_print as print_wasm,
  optilotus_printCommand as printCommand_wasm,
  optilotus_return as return_wasm,
  optilotus_runFunction as runFunction_wasm,
  optilotus_runProgram as runProgram_wasm,
  optilotus_set as set_wasm,
  optilotus_setEntry as setEntry_wasm,
  optilotus_setNext as setNext_wasm,
  optilotus_version as version_wasm,
} from "../wasm/optilotus/optilotus.js";

// Project rule: every function in the UI that originates from the
// Optilotus API layer carries the `optilotus_` prefix with a camelCase
// remainder (e.g. `optilotus_execMath`). This deliberately takes
// precedence over the generic camelCase rule (P9/P24) for this module.
// The `_wasm` aliases keep the bridge exports exactly `optilotus_*`.

// Ownership (P10): this module owns WASM init state. `ready` is the
// single-flight init promise; `loaded` records completion. Nothing else
// may mutate them. Callers must await `optilotus_tryEnsure()` first;
// sync wrappers enforce that via `assertReady()` (P14/P22).
let ready: Promise<void> | null = null;
let loaded = false;

/**
 * Load the Optilotus WASM module once. Resolves when callable.
 * Rejects (caller handles it) when loading fails, e.g. bad MIME type.
 */
export function optilotus_tryEnsure(): Promise<void> {
  if (!ready) {
    ready = init().then(() => {
      loaded = true;
    });
  }
  return ready;
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
 * Execute a serialized Function; returns the run-report JSON.
 * Input: `Function` as JSON (`{id, name, entry, commands}`). Output is
 * always JSON: `{status: "ok", steps, prints, printed: string[]}` or
 * `{status: "error", kind, command: number|null, message, ...}` where
 * `command` identifies the offending block for editor highlighting.
 * Requires init.
 */
export function optilotus_runFunction(functionJson: string): string {
  assertReady();
  return runFunction_wasm(functionJson);
}

/**
 * Declare/assign a session variable, e.g. `optilotus_set("n", "int32", "41")`.
 * Types are lowercase tags (`int32`, `string`, `bool`, ...); the text is
 * parsed into the declared type. Returns `{"status":"ok","var","type"}`
 * or the error envelope. Requires init.
 */
export function optilotus_set(name: string, ty: string, value: string): string {
  assertReady();
  return set_wasm(name, ty, value);
}

/**
 * Read a session variable. Returns
 * `{"status":"ok","value","type","display"}` or the error envelope.
 * Requires init.
 */
export function optilotus_get(name: string): string {
  assertReady();
  return get_wasm(name);
}

/**
 * Evaluate a maths expression against session variables, e.g.
 * `optilotus_execMath("({n} + 4) % 2")`. Returns
 * `{"status":"ok","value","type","display"}` or the error envelope.
 * Requires init.
 */
export function optilotus_execMath(expr: string): string {
  assertReady();
  return execMath_wasm(expr);
}

/**
 * Render a print template against session variables, e.g.
 * `optilotus_print('"Hello {name}" + "!"')`. Returns
 * `{"status":"ok","printed"}` or the error envelope. Requires init.
 */
export function optilotus_print(template: string): string {
  assertReady();
  return print_wasm(template);
}

/**
 * Drop all session variables. Returns `{"status":"ok","cleared":N}`.
 * Requires init.
 */
export function optilotus_clear(): string {
  assertReady();
  return clear_wasm();
}

/**
 * Package registry: one package, many functions, stable `main` (id 0).
 * Typed wrappers only — JSON is parsed once inside each wrapper, so UI
 * call sites never build or pass IR JSON.
 */
export type FunctionId = number;
export type CommandId = number;

export type FunctionSummary = {
  id: number;
  name: string;
  is_main: boolean;
};

export type FunctionInfo = {
  id: number;
  name: string;
  is_main: boolean;
  entry: number | null;
  command_count: number;
};

export type CommandSummary = {
  id: number;
  kind: "declare" | "assign" | "print" | "return";
  var?: string;
  ty?: string;
  expr?: string;
  template?: string;
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
  | { status: "ok"; id: number; name: string; is_main: boolean }
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
  ty: string,
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

export function optilotus_printCommand(
  fid: number,
  template: string,
): { status: "ok"; id: number } | OptilotusError {
  assertReady();
  return parseBridge(printCommand_wasm(fid, template));
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
  cmd: number,
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
