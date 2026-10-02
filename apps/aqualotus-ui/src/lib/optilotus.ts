import init, {
  optilotus_clear as clear_wasm,
  optilotus_execMath as execMath_wasm,
  optilotus_get as get_wasm,
  optilotus_health as health_wasm,
  optilotus_print as print_wasm,
  optilotus_runFunction as runFunction_wasm,
  optilotus_set as set_wasm,
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
