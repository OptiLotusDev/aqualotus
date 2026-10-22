/**
 * Real-engine test support.
 *
 * The UI test suite normally mocks the Optilotus bridge (`vi.mock`),
 * which proves the UI's *own* logic but not the integration. This
 * module loads the **actual** generated WASM artifact that ships with
 * the app, so a test can drive the real engine through the real bridge
 * wrappers.
 *
 * Why `initSync` + `node:fs`: the browser path resolves the `.wasm`
 * file with `fetch(new URL(...))`, which does not work under Node.
 * `initSync` instantiates the same module synchronously from bytes;
 * afterwards the generated `init()` returns the already-initialized
 * instance immediately, so the bridge's own `optilotus_tryEnsure()`
 * still runs its normal code path (single-flight promise, cache, …).
 *
 * Scope: this file is imported by tests only. It is never part of the
 * application bundle.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initSync } from "../wasm/optilotus/optilotus.js";
import {
  optilotus_clearPackage,
  optilotus_resetInitForTesting,
  optilotus_tryEnsure,
} from "../lib/optilotus";

/** Absolute path of the WASM artifact that ships with the app. */
const WASM_PATH = resolve(
  process.cwd(),
  "src/wasm/optilotus/optilotus_bg.wasm",
);

/**
 * Load the real engine and make the bridge ready.
 *
 * Idempotent: the WASM module is instantiated once per process; the
 * bridge's init cache is reset so every test file starts from a clean
 * "not loaded yet" state and exercises the real init path.
 */
export async function useRealEngine(): Promise<void> {
  initSync({ module: readFileSync(WASM_PATH) });
  optilotus_resetInitForTesting();
  await optilotus_tryEnsure();
}

/**
 * Reset the engine's package to a pristine state: helpers wiped and an
 * empty `main` re-created. The WASM bridge owns exactly one global
 * package, so every test that mutates the program must start here.
 */
export function resetRealEngine(): void {
  optilotus_clearPackage();
}
