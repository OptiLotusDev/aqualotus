/**
 * Build-time Optilotus engine version, injected by Vite from
 * `crates/optilotus/Cargo.toml` (see `version.js`). The live WASM
 * `optilotus_version()` takes precedence once the bridge is ready.
 */
declare const __OPTILOTUS_VERSION__: string;

/**
 * Build-time AquaLotus application version, injected by Vite from the
 * app's `package.json` (see `version.js`). It is the AquaLotus app
 * release label, independent of the Optilotus engine version.
 */
declare const __AQUALOTUS_VERSION__: string;
