import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Single source of truth for the Optilotus version shown in the UI:
 * read at build time from the engine's `Cargo.toml`, so a version bump
 * in `crates/optilotus` reaches the status pill with no UI edit.
 * The live WASM `optilotus_version()` (same Cargo version) takes
 * precedence at runtime once the bridge is ready.
 */
export function optilotusVersionFromCargo() {
  const cargo = readFileSync(
    resolve(here, "../../crates/optilotus/Cargo.toml"),
    "utf8",
  );
  const match = cargo.match(/^version\s*=\s*"([^"]+)"/m);
  if (match?.[1] === undefined || match[1] === "") {
    throw new Error("Cannot parse version from crates/optilotus/Cargo.toml");
  }
  return match[1];
}
