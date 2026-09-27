use wasm_bindgen::prelude::*;

/// Crate version, also exposed to JS.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Version of the serialized empty-program format (see P18:
/// serialized formats carry an explicit version for migration).
pub const PROGRAM_FORMAT_VERSION: u32 = 1;

/// Install better panic messages in the browser console.
/// No-op on native targets.
fn init_panic_hook() {
    #[cfg(target_arch = "wasm32")]
    console_error_panic_hook::set_once();
}

// ---------------------------------------------------------------------------
// Native + WASM shared API (plain Rust, unit-testable)
// ---------------------------------------------------------------------------

/// Health check: returns "ok" when the core is linked and running.
pub fn health_check() -> &'static str {
    "ok"
}

/// Crate version string.
pub fn version() -> &'static str {
    VERSION
}

/// Minimal program skeleton as JSON: a package with no functions yet.
/// The payload carries an explicit format version (P18).
pub fn empty_program_json() -> String {
    serde_json::json!({
        "version": PROGRAM_FORMAT_VERSION,
        "package": "main",
        "functions": []
    })
    .to_string()
}

/// Trivial execution path: "runs" the empty program and reports success.
/// Returns a JSON string so the TS side has something real to parse.
pub fn run_empty_program_json() -> String {
    serde_json::json!({
        "status": "ok",
        "functions_run": 0,
        "message": "empty program ran successfully"
    })
    .to_string()
}

/// Template arithmetic helper (kept from bootstrap).
pub fn add(left: u64, right: u64) -> u64 {
    left + right
}

// ---------------------------------------------------------------------------
// wasm-bindgen exports (browser entry points)
// ---------------------------------------------------------------------------
// Project rule: every function the UI calls that originates from the
// Optilotus API layer carries the `optilotus_` prefix with a camelCase
// remainder (e.g. `optilotus_emptyProgram`), so Optilotus origin is
// visible at the call site. This deliberately takes precedence over the
// generic camelCase rule (P9/P24) for this boundary.

/// JS: `optilotus_version() -> string`
#[wasm_bindgen(js_name = optilotus_version)]
pub fn js_version() -> String {
    init_panic_hook();
    version().to_string()
}

/// JS: `optilotus_health() -> string` ("ok")
#[wasm_bindgen(js_name = optilotus_health)]
pub fn js_health() -> String {
    init_panic_hook();
    health_check().to_string()
}

/// JS: `optilotus_emptyProgram() -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_emptyProgram)]
pub fn js_empty_program() -> String {
    init_panic_hook();
    empty_program_json()
}

/// JS: `optilotus_runEmpty() -> string` (JSON result)
#[wasm_bindgen(js_name = optilotus_runEmpty)]
pub fn js_run_empty() -> String {
    init_panic_hook();
    run_empty_program_json()
}

/// JS: `optilotus_add(a, b) -> bigint`
#[wasm_bindgen(js_name = optilotus_add)]
pub fn js_add(a: u64, b: u64) -> u64 {
    init_panic_hook();
    add(a, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }

    #[test]
    fn version_is_set() {
        assert_eq!(version(), "0.1.0");
    }

    #[test]
    fn health_is_ok() {
        assert_eq!(health_check(), "ok");
    }

    #[test]
    fn empty_program_round_trips() {
        let json = empty_program_json();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["version"], PROGRAM_FORMAT_VERSION);
        assert_eq!(v["package"], "main");
        assert!(v["functions"].as_array().unwrap().is_empty());
    }

    #[test]
    fn run_empty_reports_ok() {
        let json = run_empty_program_json();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["status"], "ok");
    }
}
