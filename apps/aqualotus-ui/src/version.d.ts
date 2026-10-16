/**
 * Build-time Optilotus engine version, injected by Vite from
 * `crates/optilotus/Cargo.toml` (see `version.js`). The live WASM
 * `optilotus_version()` takes precedence once the bridge is ready.
 */
declare const __OPTILOTUS_VERSION__: string;
