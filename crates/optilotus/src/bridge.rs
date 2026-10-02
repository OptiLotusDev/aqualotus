use std::cell::RefCell;

use wasm_bindgen::prelude::*;

use crate::expr::ExprFail;
use crate::session::Session;

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

/// Execute one serialized `Function` and return a JSON run report.
///
/// Input is a `Function` as JSON (see `crate::ir` for the shape). The
/// output is always a JSON string — this never throws across the
/// boundary, so JS callers only parse:
///
/// - ok: `{"status":"ok","steps":N,"prints":M,"printed":[...]}`
/// - failure: `{"status":"error","kind":K,"command":id|null,"message":"..."}`
///   with variant-specific fields (`var`, `value`, `expected`, `found`,
///   `limit`, `detail`). Unparseable input is `kind: "ParseError"`.
///
/// Runs headlessly with a buffer sink under the default step cap.
pub fn run_function_json(input: &str) -> String {
    match serde_json::from_str::<crate::ir::Function>(input) {
        Err(e) => serde_json::json!({
            "status": "error",
            "kind": "ParseError",
            "command": null,
            "message": format!("invalid function JSON: {e}"),
        })
        .to_string(),
        Ok(function) => {
            let mut sink = crate::sink::VecSink::default();
            match crate::exec::run_function(&function, &mut sink) {
                Ok(report) => serde_json::json!({
                    "status": "ok",
                    "steps": report.steps,
                    "prints": report.prints,
                    "printed": sink.lines,
                })
                .to_string(),
                Err(e) => exec_error_json(&e).to_string(),
            }
        }
    }
}

/// Map an execution failure to the frontend-facing error object.
/// `command` carries the offending `CommandId` (null for `LoopLimit`)
/// so the editor can highlight the corresponding visual block.
fn exec_error_json(err: &crate::error::ExecError) -> serde_json::Value {
    use crate::error::ExecError as E;
    let message = err.to_string();
    match err {
        E::TypeMismatch { command, detail } => serde_json::json!({
            "status": "error", "kind": "TypeMismatch",
            "command": command.0, "message": message, "detail": detail,
        }),
        E::Overflow { command } => serde_json::json!({
            "status": "error", "kind": "Overflow",
            "command": command.0, "message": message,
        }),
        E::DivByZero { command } => serde_json::json!({
            "status": "error", "kind": "DivByZero",
            "command": command.0, "message": message,
        }),
        E::MissingValue { command, value } => serde_json::json!({
            "status": "error", "kind": "MissingValue",
            "command": command.0, "message": message, "value": value.0,
        }),
        E::Arity {
            command,
            expected,
            found,
        } => serde_json::json!({
            "status": "error", "kind": "Arity",
            "command": command.0, "message": message,
            "expected": expected, "found": found,
        }),
        E::UnknownCommand { command } => serde_json::json!({
            "status": "error", "kind": "UnknownCommand",
            "command": command.0, "message": message,
        }),
        E::LoopLimit { limit } => serde_json::json!({
            "status": "error", "kind": "LoopLimit",
            "command": null, "message": message, "limit": limit,
        }),
        E::UnknownVariable { command, var } => serde_json::json!({
            "status": "error", "kind": "UnknownVariable",
            "command": command.0, "message": message, "var": var,
        }),
        E::ExprError { command, detail } => serde_json::json!({
            "status": "error", "kind": "ExprError",
            "command": command.0, "message": message, "detail": detail,
        }),
    }
}

// ---------------------------------------------------------------------------
// wasm-bindgen exports (browser entry points)
// ---------------------------------------------------------------------------
// Project rule: every function the UI calls that originates from the
// Optilotus API layer carries the `optilotus_` prefix, in both Rust
// (`js_name`) and TypeScript, so Optilotus origin is visible at the call
// site. This deliberately takes precedence over the generic camelCase
// rule (P9/P24) for this boundary.

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

/// JS: `optilotus_runFunction(functionJson) -> string` (JSON report)
#[wasm_bindgen(js_name = optilotus_runFunction)]
pub fn js_run_function(input: &str) -> String {
    init_panic_hook();
    run_function_json(input)
}

// ---------------------------------------------------------------------------
// Session API: the easy path (no IR assembly required)
// ---------------------------------------------------------------------------
// One explicitly-owned variable session for the JS world. Plain `Session`
// values stay global-free and unit-testable (see `crate::session`); this
// singleton is the documented owner of the browser session state, so
// `set` then `exec_math("{n} + 1")` works across calls. `clear` resets it.
// `thread_local` (not `static`) keeps native test threads isolated.

thread_local! {
    static SESSION: RefCell<Session> = RefCell::new(Session::new());
}

fn with_session<T>(f: impl FnOnce(&mut Session) -> T) -> T {
    SESSION.with(|cell| f(&mut cell.borrow_mut()))
}

/// Map a session failure to the frontend error envelope.
/// Same shape as `exec_error_json`, with `command: null` (no block ran).
fn session_fail_json(err: &ExprFail) -> serde_json::Value {
    let message = err.to_string();
    match err {
        ExprFail::Parse(detail) => serde_json::json!({
            "status": "error", "kind": "ExprError",
            "command": null, "message": message, "detail": detail,
        }),
        ExprFail::UnknownVariable(var) => serde_json::json!({
            "status": "error", "kind": "UnknownVariable",
            "command": null, "message": message, "var": var,
        }),
        ExprFail::TypeMismatch(detail) => serde_json::json!({
            "status": "error", "kind": "TypeMismatch",
            "command": null, "message": message, "detail": detail,
        }),
        ExprFail::Overflow => serde_json::json!({
            "status": "error", "kind": "Overflow",
            "command": null, "message": message,
        }),
        ExprFail::DivByZero => serde_json::json!({
            "status": "error", "kind": "DivByZero",
            "command": null, "message": message,
        }),
    }
}

fn value_json(value: &crate::value::Value) -> serde_json::Value {
    serde_json::json!({
        "value": value,
        "type": value.ty().tag(),
        "display": value.to_string(),
    })
}

/// Declare/assign a session variable: `set("n", "int32", "41")`.
/// Types are lowercase tags (`int32`, `string`, `bool`, ...); the text is
/// parsed into the declared type (`string` kept verbatim).
/// Returns `{"status":"ok","var","type"}` or the error envelope.
pub fn session_set(name: &str, ty: &str, text: &str) -> String {
    let Some(parsed_ty) = crate::types::Type::parse_tag(ty) else {
        return serde_json::json!({
            "status": "error", "kind": "ExprError",
            "command": null,
            "message": format!("unknown type {ty:?}: use a lowercase tag like \"int32\" or \"string\""),
        })
        .to_string();
    };
    with_session(|session| {
        let value = match Session::parse_value(parsed_ty, text) {
            Ok(value) => value,
            Err(e) => return session_fail_json(&e).to_string(),
        };
        match session.set(name, parsed_ty, value) {
            Ok(()) => serde_json::json!({
                "status": "ok", "var": name.trim(), "type": parsed_ty.tag(),
            })
            .to_string(),
            Err(e) => session_fail_json(&e).to_string(),
        }
    })
}

/// Read a session variable: `get("n")`.
/// Returns `{"status":"ok","value","type","display"}` or the error envelope.
pub fn session_get(name: &str) -> String {
    with_session(|session| match session.get(name) {
        Ok(value) => {
            let mut out = value_json(&value);
            out["status"] = serde_json::Value::String("ok".to_string());
            out.to_string()
        }
        Err(e) => session_fail_json(&e).to_string(),
    })
}

/// Evaluate a maths expression against session variables:
/// `exec_math("({n} + 4) % 2")`. See `eval_expr` for the language.
/// Returns `{"status":"ok","value","type","display"}` or the error envelope.
pub fn session_exec_math(expr: &str) -> String {
    with_session(|session| match session.exec_math(expr) {
        Ok(value) => {
            let mut out = value_json(&value);
            out["status"] = serde_json::Value::String("ok".to_string());
            out.to_string()
        }
        Err(e) => session_fail_json(&e).to_string(),
    })
}

/// Render a print template against session variables:
/// `print("\"Hello {name}\" + \"!\"")`. See `render_template`.
/// Returns `{"status":"ok","printed"}` or the error envelope.
pub fn session_print(template: &str) -> String {
    with_session(|session| match session.render(template) {
        Ok(printed) => serde_json::json!({
            "status": "ok", "printed": printed,
        })
        .to_string(),
        Err(e) => session_fail_json(&e).to_string(),
    })
}

/// Drop all session variables. Returns `{"status":"ok","cleared":N}`.
pub fn session_clear() -> String {
    let cleared = with_session(|session| session.clear());
    serde_json::json!({
        "status": "ok", "cleared": cleared,
    })
    .to_string()
}

/// JS: `optilotus_set(name, ty, value) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_set)]
pub fn js_session_set(name: &str, ty: &str, text: &str) -> String {
    init_panic_hook();
    session_set(name, ty, text)
}

/// JS: `optilotus_get(name) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_get)]
pub fn js_session_get(name: &str) -> String {
    init_panic_hook();
    session_get(name)
}

/// JS: `optilotus_execMath(expr) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_execMath)]
pub fn js_session_exec_math(expr: &str) -> String {
    init_panic_hook();
    session_exec_math(expr)
}

/// JS: `optilotus_print(template) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_print)]
pub fn js_session_print(template: &str) -> String {
    init_panic_hook();
    session_print(template)
}

/// JS: `optilotus_clear() -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_clear)]
pub fn js_session_clear() -> String {
    init_panic_hook();
    session_clear()
}
