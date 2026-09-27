import init, {
  optilotus_add as add_wasm,
  optilotus_emptyProgram as emptyProgram_wasm,
  optilotus_health as health_wasm,
  optilotus_runEmpty as runEmpty_wasm,
  optilotus_version as version_wasm,
} from "../wasm/optilotus/optilotus.js";

// Project rule: every function in the UI that originates from the
// Optilotus API layer carries the `optilotus_` prefix with a camelCase
// remainder (e.g. `optilotus_emptyProgram`). This deliberately takes
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

/** Minimal program skeleton as versioned JSON. Requires init. */
export function optilotus_emptyProgram(): string {
  assertReady();
  return emptyProgram_wasm();
}

/** Trivial execution result as JSON. Requires init. */
export function optilotus_runEmpty(): string {
  assertReady();
  return runEmpty_wasm();
}

/** u64 add via WASM (bigint on the boundary, number for small values). */
export function optilotus_add(a: number, b: number): number {
  assertReady();
  return Number(add_wasm(BigInt(a), BigInt(b)));
}
