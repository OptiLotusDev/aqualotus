use std::cell::RefCell;

use wasm_bindgen::prelude::*;

use crate::expr::ExprFail;
use crate::session::Session;

/// Crate version, also exposed to JS.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

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
        E::UnknownFunction { command, name } => serde_json::json!({
            "status": "error", "kind": "UnknownFunction",
            "command": command.0, "message": message, "function": name,
        }),
        E::MissingReturn { command, function } => serde_json::json!({
            "status": "error", "kind": "MissingReturn",
            "command": command.0, "message": message, "function": function,
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

thread_local! {
    static PACKAGE: RefCell<crate::package::Package> =
        RefCell::new(crate::package::Package::new());
}

fn with_session<T>(f: impl FnOnce(&mut Session) -> T) -> T {
    SESSION.with(|cell| f(&mut cell.borrow_mut()))
}

fn with_package<T>(f: impl FnOnce(&mut crate::package::Package) -> T) -> T {
    PACKAGE.with(|cell| f(&mut cell.borrow_mut()))
}

/// Package CRUD error envelope: `{"status":"error","kind":"PackageError",
/// "command":id|null,"message"}` — no block ran (command set for
/// `UnknownCommand` so the editor can highlight it).
fn package_fail_json(err: &crate::package::PackageError) -> serde_json::Value {
    let command = match err {
        crate::package::PackageError::UnknownCommand(id) => serde_json::Value::from(id.0),
        _ => serde_json::Value::Null,
    };
    serde_json::json!({
        "status": "error", "kind": "PackageError",
        "command": command, "message": err.to_string(),
    })
}

/// List functions: `{"status":"ok","functions":[{id,name,is_main}]}`.
pub fn package_list_functions() -> String {
    let functions = with_package(|pkg| pkg.list_functions());
    let items: Vec<serde_json::Value> = functions
        .iter()
        .map(|f| serde_json::json!({"id": f.id.0, "name": f.name, "is_main": f.is_main}))
        .collect();
    serde_json::json!({"status": "ok", "functions": items}).to_string()
}

/// Create a function: `{"status":"ok","id","name","is_main"}`.
pub fn package_create_function(name: &str) -> String {
    with_package(|pkg| match pkg.create_function(name) {
        Ok(id) => {
            let info = pkg.get_function(id).expect("just created");
            serde_json::json!({
                "status": "ok", "id": info.id.0,
                "name": info.name, "is_main": info.is_main,
            })
            .to_string()
        }
        Err(e) => package_fail_json(&e).to_string(),
    })
}

/// Inspect one function by numeric id.
pub fn package_get_function(id: u32) -> String {
    with_package(|pkg| match pkg.get_function(crate::ir::FunctionId(id)) {
        Ok(info) => serde_json::json!({
            "status": "ok", "id": info.id.0, "name": info.name,
            "is_main": info.is_main,
            "entry": info.entry.map(|c| c.0),
            "command_count": info.command_count,
        })
        .to_string(),
        Err(e) => package_fail_json(&e).to_string(),
    })
}

/// Delete a helper by numeric id (`main` is protected).
pub fn package_delete_function(id: u32) -> String {
    with_package(|pkg| match pkg.delete_function(crate::ir::FunctionId(id)) {
        Ok(()) => serde_json::json!({"status": "ok", "deleted": id}).to_string(),
        Err(e) => package_fail_json(&e).to_string(),
    })
}

/// Wipe helpers, re-create an empty `main`.
pub fn package_clear() -> String {
    with_package(|pkg| {
        let held = pkg.list_functions().len().saturating_sub(1);
        pkg.clear_package();
        serde_json::json!({"status": "ok", "cleared": held}).to_string()
    })
}

/// `declare(fid, name, ty, init?)` -> `{"status":"ok","id"}` (user head).
pub fn package_declare(fid: u32, name: &str, ty: &str, init: Option<String>) -> String {
    with_package(
        |pkg| match pkg.declare(crate::ir::FunctionId(fid), name, ty, init.as_deref()) {
            Ok(id) => serde_json::json!({"status": "ok", "id": id.0}).to_string(),
            Err(e) => package_fail_json(&e).to_string(),
        },
    )
}

/// `assign(fid, name, expr)` -> `{"status":"ok","id"}`.
pub fn package_assign(fid: u32, name: &str, expr: &str) -> String {
    with_package(
        |pkg| match pkg.assign(crate::ir::FunctionId(fid), name, expr) {
            Ok(id) => serde_json::json!({"status": "ok", "id": id.0}).to_string(),
            Err(e) => package_fail_json(&e).to_string(),
        },
    )
}

/// `print(fid, template)` -> `{"status":"ok","id"}`.
pub fn package_print(fid: u32, template: &str) -> String {
    with_package(
        |pkg| match pkg.print(crate::ir::FunctionId(fid), template) {
            Ok(id) => serde_json::json!({"status": "ok", "id": id.0}).to_string(),
            Err(e) => package_fail_json(&e).to_string(),
        },
    )
}

/// `return(fid, expr)` -> `{"status":"ok","id"}`.
pub fn package_return(fid: u32, expr: &str) -> String {
    with_package(|pkg| match pkg.return_(crate::ir::FunctionId(fid), expr) {
        Ok(id) => serde_json::json!({"status": "ok", "id": id.0}).to_string(),
        Err(e) => package_fail_json(&e).to_string(),
    })
}

/// `list_commands(fid)` -> `{"status":"ok","commands":[...]}` in user kinds.
pub fn package_list_commands(fid: u32) -> String {
    with_package(|pkg| match pkg.list_commands(crate::ir::FunctionId(fid)) {
        Ok(cmds) => {
            let items: Vec<serde_json::Value> = cmds
                .iter()
                .map(|c| serde_json::to_value(c).unwrap_or(serde_json::Value::Null))
                .collect();
            serde_json::json!({"status": "ok", "commands": items}).to_string()
        }
        Err(e) => package_fail_json(&e).to_string(),
    })
}

/// `set_entry(fid, cmd)` — cmd head id.
pub fn package_set_entry(fid: u32, cmd: u32) -> String {
    with_package(|pkg| {
        match pkg.set_entry(crate::ir::FunctionId(fid), Some(crate::ir::CommandId(cmd))) {
            Ok(()) => serde_json::json!({"status": "ok"}).to_string(),
            Err(e) => package_fail_json(&e).to_string(),
        }
    })
}

/// `set_next(fid, cmd, next?)` — `next=null` clears the edge.
pub fn package_set_next(fid: u32, cmd: u32, next: Option<u32>) -> String {
    with_package(|pkg| {
        match pkg.set_next(
            crate::ir::FunctionId(fid),
            crate::ir::CommandId(cmd),
            next.map(crate::ir::CommandId),
        ) {
            Ok(()) => serde_json::json!({"status": "ok"}).to_string(),
            Err(e) => package_fail_json(&e).to_string(),
        }
    })
}

/// `delete_command(fid, cmd)` — removes the user op + hidden pair.
pub fn package_delete_command(fid: u32, cmd: u32) -> String {
    with_package(|pkg| {
        match pkg.delete_command(crate::ir::FunctionId(fid), crate::ir::CommandId(cmd)) {
            Ok(()) => serde_json::json!({"status": "ok", "deleted": cmd}).to_string(),
            Err(e) => package_fail_json(&e).to_string(),
        }
    })
}

/// Run `main` by id only (no JSON input). Same JSON envelope as
/// `run_function_json`, built inside the bridge: ok
/// `{"status":"ok","steps","prints","printed"}` or the typed error object.
pub fn run_program() -> String {
    with_package(|pkg| {
        let mut sink = crate::sink::VecSink::default();
        match pkg.run_main(&mut sink) {
            Ok(report) => serde_json::json!({
                "status": "ok",
                "steps": report.steps,
                "prints": report.prints,
                "printed": sink.lines,
            })
            .to_string(),
            Err(e) => exec_error_json(&e).to_string(),
        }
    })
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
        ExprFail::UnknownFunction(name) => serde_json::json!({
            "status": "error", "kind": "UnknownFunction",
            "command": null, "message": message, "function": name,
        }),
        ExprFail::MissingReturn(name) => serde_json::json!({
            "status": "error", "kind": "MissingReturn",
            "command": null, "message": message, "function": name,
        }),
        ExprFail::Callee(inner) => exec_error_json(inner),
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

/// JS: `optilotus_listFunctions() -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_listFunctions)]
pub fn js_package_list() -> String {
    init_panic_hook();
    package_list_functions()
}

/// JS: `optilotus_createFunction(name) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_createFunction)]
pub fn js_package_create(name: &str) -> String {
    init_panic_hook();
    package_create_function(name)
}

/// JS: `optilotus_getFunction(id) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_getFunction)]
pub fn js_package_get(id: u32) -> String {
    init_panic_hook();
    package_get_function(id)
}

/// JS: `optilotus_deleteFunction(id) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_deleteFunction)]
pub fn js_package_delete(id: u32) -> String {
    init_panic_hook();
    package_delete_function(id)
}

/// JS: `optilotus_clearPackage() -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_clearPackage)]
pub fn js_package_clear() -> String {
    init_panic_hook();
    package_clear()
}

/// JS: `optilotus_declare(fid, name, ty, init?) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_declare)]
pub fn js_package_declare(fid: u32, name: &str, ty: &str, init: Option<String>) -> String {
    init_panic_hook();
    package_declare(fid, name, ty, init)
}

/// JS: `optilotus_assign(fid, name, expr) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_assign)]
pub fn js_package_assign(fid: u32, name: &str, expr: &str) -> String {
    init_panic_hook();
    package_assign(fid, name, expr)
}

/// JS: `optilotus_printCommand(fid, template) -> string` (JSON)
/// Named `printCommand` to avoid clashing with session `optilotus_print`.
#[wasm_bindgen(js_name = optilotus_printCommand)]
pub fn js_package_print(fid: u32, template: &str) -> String {
    init_panic_hook();
    package_print(fid, template)
}

/// JS: `optilotus_return(fid, expr) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_return)]
pub fn js_package_return(fid: u32, expr: &str) -> String {
    init_panic_hook();
    package_return(fid, expr)
}

/// JS: `optilotus_listCommands(fid) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_listCommands)]
pub fn js_package_list_commands(fid: u32) -> String {
    init_panic_hook();
    package_list_commands(fid)
}

/// JS: `optilotus_setEntry(fid, cmd) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_setEntry)]
pub fn js_package_set_entry(fid: u32, cmd: u32) -> String {
    init_panic_hook();
    package_set_entry(fid, cmd)
}

/// JS: `optilotus_setNext(fid, cmd, next?) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_setNext)]
pub fn js_package_set_next(fid: u32, cmd: u32, next: Option<u32>) -> String {
    init_panic_hook();
    package_set_next(fid, cmd, next)
}

/// JS: `optilotus_deleteCommand(fid, cmd) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_deleteCommand)]
pub fn js_package_delete_command(fid: u32, cmd: u32) -> String {
    init_panic_hook();
    package_delete_command(fid, cmd)
}

/// JS: `optilotus_runProgram() -> string` (JSON report, no JSON input)
#[wasm_bindgen(js_name = optilotus_runProgram)]
pub fn js_run_program() -> String {
    init_panic_hook();
    run_program()
}
