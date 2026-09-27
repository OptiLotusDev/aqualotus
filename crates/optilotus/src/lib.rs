use wasm_bindgen::prelude::*;

/// Crate version, also exposed to JS.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

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
pub fn empty_program_json() -> String {
    serde_json::json!({
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

/// JS: `optilotus_empty_program() -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_empty_program)]
pub fn js_empty_program() -> String {
    init_panic_hook();
    empty_program_json()
}

/// JS: `optilotus_run_empty() -> string` (JSON result)
#[wasm_bindgen(js_name = optilotus_run_empty)]
pub fn js_run_empty() -> String {
    init_panic_hook();
    run_empty_program_json()
}

/// JS: `optilotus_add(a, b) -> number`
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
