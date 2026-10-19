use std::cell::RefCell;

use wasm_bindgen::prelude::*;

use crate::error::ExecError;
use crate::run_resumable::RunStatus;
use crate::wire::{
    exec_error_response, ClearedResponse, CommandIdResponse, DeletedResponse, ErrorResponse,
    FunctionInfoResponse, FunctionResponse, FunctionRow, IdleResponse, ListCommandsResponse,
    ListFunctionsResponse, OkResponse, RunOkResponse, WaitingInputResponse,
};
use crate::CommandSpec;

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

/// Serialize any wire response to the JSON string the JS bridge parses.
///
/// The bridge keeps returning JSON strings (rather than `JsValue`) so a
/// malformed response can never throw across the boundary: every call
/// yields a parseable envelope, and the UI discriminates on `status`.
/// The *shapes* are declared in `crate::wire`, so this is the only place
/// that knows they are transported as JSON text.
fn to_json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|e| {
        // Serialization of these plain structs cannot fail in practice;
        // if it ever does, surface it as a typed error rather than
        // panicking in the browser (P22: fail explicitly).
        format!(
            r#"{{"status":"error","kind":"Serialization","command":null,"message":"failed to serialize bridge response: {e}"}}"#
        )
    })
}

/// Map an execution failure to the frontend-facing error envelope.
/// `command` carries the offending `CommandId` (null for `LoopLimit`)
/// so the editor can highlight the corresponding visual block.
fn exec_error_json(err: &crate::error::ExecError) -> ErrorResponse {
    exec_error_response(err)
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

// ---------------------------------------------------------------------------
// Package registry: the single global behind the bridge.
// ---------------------------------------------------------------------------
// One explicitly-owned package for the JS world. Plain `Package` values
// stay global-free and unit-testable (see `crate::package`); this
// singleton is the documented owner of the browser package state.
// `thread_local` (not `static`) keeps native test threads isolated.

thread_local! {
    static PACKAGE: RefCell<crate::package::Package> =
        RefCell::new(crate::package::Package::new());
    static RUN: RefCell<Option<crate::run_resumable::RunSession>> =
        const { RefCell::new(None) };
    static LAST_ERROR: RefCell<Option<crate::error::ExecError>> =
        const { RefCell::new(None) };
    static DEBUG_MODE: RefCell<bool> = const { RefCell::new(false) };
}

fn with_package<T>(f: impl FnOnce(&mut crate::package::Package) -> T) -> T {
    PACKAGE.with(|cell| f(&mut cell.borrow_mut()))
}

/// Package CRUD error envelope: `{"status":"error","kind":"PackageError",
/// "command":id|null,"message"}` — no block ran (command set for
/// `UnknownCommand` so the editor can highlight it).
fn package_fail(err: &crate::package::PackageError) -> ErrorResponse {
    let message = err.to_string();
    match err {
        crate::package::PackageError::UnknownCommand(id) => {
            ErrorResponse::at_command("PackageError", *id, message)
        }
        _ => ErrorResponse::new("PackageError", message),
    }
}

/// Typed error for malformed input JSON — never silently empty.
fn invalid_inputs_json(e: &serde_json::Error) -> String {
    to_json(&ErrorResponse::new(
        "InvalidInputs",
        format!("invalid inputs JSON: {e}"),
    ))
}

/// List functions: `{"status":"ok","functions":[{id,name,isMain}]}`.
/// Wire JSON uses `camelCase` for the TS bridge; Rust fields stay `snake_case`.
pub fn package_list_functions() -> String {
    let functions = with_package(|pkg| pkg.list_functions());
    let rows: Vec<FunctionRow> = functions.iter().map(FunctionRow::from).collect();
    to_json(&ListFunctionsResponse::new(rows))
}

/// Create a function: `{"status":"ok","id","name","isMain"}`.
pub fn package_create_function(name: &str) -> String {
    with_package(|pkg| match pkg.create_function(name) {
        Ok(id) => {
            let info = pkg.get_function(id).expect("just created");
            to_json(&FunctionResponse::from(&info))
        }
        Err(e) => to_json(&package_fail(&e)),
    })
}

/// Inspect one function by numeric id.
pub fn package_get_function(id: u32) -> String {
    with_package(|pkg| match pkg.get_function(crate::ir::FunctionId(id)) {
        Ok(info) => to_json(&FunctionInfoResponse::from(&info)),
        Err(e) => to_json(&package_fail(&e)),
    })
}

/// Delete a helper by numeric id (`main` is protected).
pub fn package_delete_function(id: u32) -> String {
    with_package(|pkg| match pkg.delete_function(crate::ir::FunctionId(id)) {
        Ok(()) => to_json(&DeletedResponse::new(id)),
        Err(e) => to_json(&package_fail(&e)),
    })
}

/// Rename a function by numeric id, preserving its stable id.
pub fn package_rename_function(id: u32, name: &str) -> String {
    with_package(
        |pkg| match pkg.try_rename(crate::ir::FunctionId(id), name) {
            Ok(()) => {
                let info = pkg
                    .get_function(crate::ir::FunctionId(id))
                    .expect("just renamed");
                to_json(&FunctionResponse::from(&info))
            }
            Err(e) => to_json(&package_fail(&e)),
        },
    )
}

/// Wipe helpers, re-create an empty `main`.
pub fn package_clear() -> String {
    with_package(|pkg| {
        let held = pkg.list_functions().len().saturating_sub(1);
        pkg.clear_package();
        to_json(&ClearedResponse::new(held))
    })
}

/// `declare(fid, name, ty, init?)` -> `{"status":"ok","id"}` (user head).
pub fn package_declare(fid: u32, name: &str, ty: &str, init: Option<String>) -> String {
    with_package(
        |pkg| match pkg.declare(crate::ir::FunctionId(fid), name, ty, init.as_deref()) {
            Ok(id) => to_json(&CommandIdResponse::new(id)),
            Err(e) => to_json(&package_fail(&e)),
        },
    )
}

/// `assign(fid, name, expr)` -> `{"status":"ok","id"}`.
pub fn package_assign(fid: u32, name: &str, expr: &str) -> String {
    with_package(
        |pkg| match pkg.assign(crate::ir::FunctionId(fid), name, expr) {
            Ok(id) => to_json(&CommandIdResponse::new(id)),
            Err(e) => to_json(&package_fail(&e)),
        },
    )
}

/// `print(fid, template)` -> `{"status":"ok","id"}`.
pub fn package_print(fid: u32, template: &str) -> String {
    with_package(
        |pkg| match pkg.print(crate::ir::FunctionId(fid), template) {
            Ok(id) => to_json(&CommandIdResponse::new(id)),
            Err(e) => to_json(&package_fail(&e)),
        },
    )
}

/// `input(fid, ty)` -> `{"status":"ok","id"}`.
pub fn package_input(fid: u32, ty: &str) -> String {
    with_package(|pkg| match pkg.input(crate::ir::FunctionId(fid), ty) {
        Ok(id) => to_json(&CommandIdResponse::new(id)),
        Err(e) => to_json(&package_fail(&e)),
    })
}

/// `cast(fid, name, to, expr)` -> `{"status":"ok","id"}`.
pub fn package_cast(fid: u32, name: &str, to: &str, expr: &str) -> String {
    with_package(
        |pkg| match pkg.cast(crate::ir::FunctionId(fid), name, to, expr) {
            Ok(id) => to_json(&CommandIdResponse::new(id)),
            Err(e) => to_json(&package_fail(&e)),
        },
    )
}

/// `return(fid, expr)` -> `{"status":"ok","id"}`.
pub fn package_return(fid: u32, expr: &str) -> String {
    with_package(|pkg| match pkg.return_(crate::ir::FunctionId(fid), expr) {
        Ok(id) => to_json(&CommandIdResponse::new(id)),
        Err(e) => to_json(&package_fail(&e)),
    })
}

/// `list_commands(fid)` -> `{"status":"ok","commands":[...]}` in user kinds.
pub fn package_list_commands(fid: u32) -> String {
    with_package(|pkg| match pkg.list_commands(crate::ir::FunctionId(fid)) {
        Ok(cmds) => to_json(&ListCommandsResponse::new(cmds)),
        Err(e) => to_json(&package_fail(&e)),
    })
}

/// `set_entry(fid, cmd?)` — cmd head id, `null` clears the entry.
pub fn package_set_entry(fid: u32, cmd: Option<u32>) -> String {
    with_package(|pkg| {
        match pkg.set_entry(crate::ir::FunctionId(fid), cmd.map(crate::ir::CommandId)) {
            Ok(()) => to_json(&OkResponse::default()),
            Err(e) => to_json(&package_fail(&e)),
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
            Ok(()) => to_json(&OkResponse::default()),
            Err(e) => to_json(&package_fail(&e)),
        }
    })
}

/// `delete_command(fid, cmd)` — removes the user op + hidden pair.
pub fn package_delete_command(fid: u32, cmd: u32) -> String {
    with_package(|pkg| {
        match pkg.delete_command(crate::ir::FunctionId(fid), crate::ir::CommandId(cmd)) {
            Ok(()) => to_json(&DeletedResponse::new(cmd)),
            Err(e) => to_json(&package_fail(&e)),
        }
    })
}

/// `if(fid, cond_expr, then_specs, else_specs?)` -> Result<u32, JsValue>.
///
/// Creates an `Op::If` in one call: the condition expression is evaluated
/// into a hidden ValueId appended to the main chain, and each body spec
/// is expanded into raw commands linked in order. Body specs cross as
/// native JS objects (no JSON strings); the Ok value is the new
/// if-command's user id, the Err value is the error message.
#[wasm_bindgen(js_name = optilotus_if)]
pub fn js_package_if(
    fid: u32,
    cond_expr: &str,
    then_specs: Vec<JsValue>,
    else_specs: Option<Vec<JsValue>>,
) -> Result<u32, JsValue> {
    init_panic_hook();
    with_package(|pkg| {
        let then_specs = parse_specs(then_specs)?;
        let else_specs = match else_specs {
            Some(specs) => Some(parse_specs(specs)?),
            None => None,
        };
        pkg.if_with_expr(
            crate::ir::FunctionId(fid),
            cond_expr,
            &then_specs,
            else_specs.as_deref(),
        )
        .map(|id| id.0)
        .map_err(|e| JsValue::from_str(&e.to_string()))
    })
}

/// Deserialize a list of native JS command specs into domain types.
fn parse_specs(specs: Vec<JsValue>) -> Result<Vec<CommandSpec>, JsValue> {
    specs
        .into_iter()
        .map(|js| serde_wasm_bindgen::from_value(js).map_err(|e| JsValue::from_str(&e.to_string())))
        .collect()
}

/// Run `main` by id only (no JSON input). The output is always a JSON
/// string — this never throws across the boundary, so JS callers only parse:
/// ok `{"status":"ok","steps","prints","printed"}` or the typed error object.
pub fn run_program() -> String {
    with_package(|pkg| {
        let mut sink = crate::sink::VecSink::default();
        match pkg.run_main(&mut sink) {
            Ok(report) => to_json(&RunOkResponse::new(
                report.steps,
                report.prints,
                sink.lines,
                None,
            )),
            Err(e) => to_json(&exec_error_json(&e)),
        }
    })
}

/// Run `main` consuming the supplied input lines (JSON array of strings).
/// Malformed JSON returns a typed error — never a silent empty run.
pub fn run_program_with_inputs(inputs_json: &str) -> String {
    let lines: Vec<String> = match serde_json::from_str(inputs_json) {
        Ok(v) => v,
        Err(e) => return invalid_inputs_json(&e),
    };
    with_package(|pkg| {
        let mut sink = crate::sink::VecSink::default();
        match pkg.run_main_with_input_lines(&mut sink, lines) {
            Ok(report) => to_json(&RunOkResponse::new(
                report.steps,
                report.prints,
                sink.lines,
                None,
            )),
            Err(e) => to_json(&exec_error_json(&e)),
        }
    })
}

/// JS: `optilotus_runProgramWithInputs(inputs_json) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_runProgramWithInputs)]
pub fn js_run_program_with_inputs(inputs_json: &str) -> String {
    init_panic_hook();
    run_program_with_inputs(inputs_json)
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

/// JS: `optilotus_renameFunction(id, name) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_renameFunction)]
pub fn js_package_rename(id: u32, name: &str) -> String {
    init_panic_hook();
    package_rename_function(id, name)
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

/// JS: `optilotus_print(fid, template) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_print)]
pub fn js_package_print(fid: u32, template: &str) -> String {
    init_panic_hook();
    package_print(fid, template)
}

/// JS: `optilotus_input(fid, ty) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_input)]
pub fn js_package_input(fid: u32, ty: &str) -> String {
    init_panic_hook();
    package_input(fid, ty)
}

/// JS: `optilotus_cast(fid, name, to, expr) -> string` (JSON)
#[wasm_bindgen(js_name = optilotus_cast)]
pub fn js_package_cast(fid: u32, name: &str, to: &str, expr: &str) -> String {
    init_panic_hook();
    package_cast(fid, name, to, expr)
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

/// JS: `optilotus_setEntry(fid, cmd?) -> string` (JSON, `null` clears)
#[wasm_bindgen(js_name = optilotus_setEntry)]
pub fn js_package_set_entry(fid: u32, cmd: Option<u32>) -> String {
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

/// Record the last execution error for `optilotus_lastError()` queries.
fn record_error(err: crate::error::ExecError) {
    LAST_ERROR.with(|cell| {
        *cell.borrow_mut() = Some(err);
    });
}

fn run_status_json(status: crate::run_resumable::RunStatus) -> String {
    use crate::run_resumable::RunStatus;
    let debug = DEBUG_MODE.with(|cell| *cell.borrow());
    match status {
        RunStatus::WaitingInput { command, ty } => {
            let mut response = WaitingInputResponse::new(command, ty);
            if debug {
                response.peek = Some(true);
            }
            to_json(&response)
        }
        RunStatus::Finished {
            steps,
            prints,
            printed,
            returned,
        } => to_json(&RunOkResponse::new(steps, prints, printed, returned).with_debug(debug)),
        RunStatus::Error(e) => {
            // record for lastError query
            crate::bridge::record_error(e.clone());
            to_json(&exec_error_json(&e))
        }
    }
}

pub fn run_program_start() -> String {
    init_panic_hook();
    RUN.with(|cell| {
        let mut cell = cell.borrow_mut();
        *cell = None;
        let pkg = PACKAGE.with(|p| p.borrow().clone());
        let run = crate::run_resumable::RunSession::start(pkg.as_program());
        let status = run.status();
        *cell = Some(run);
        run_status_json(status)
    })
}

pub fn run_program_provide_input(value: &str) -> String {
    init_panic_hook();
    RUN.with(|cell| {
        let mut cell = cell.borrow_mut();
        if let Some(run) = cell.as_mut() {
            run_status_json(run.provide_input(value))
        } else {
            to_json(&ErrorResponse::new("NoRun", "no active run"))
        }
    })
}

pub fn run_program_cancel() {
    init_panic_hook();
    RUN.with(|cell| {
        *cell.borrow_mut() = None;
    });
}

pub fn run_program_status() -> String {
    init_panic_hook();
    RUN.with(|cell| {
        if let Some(run) = cell.borrow().as_ref() {
            run_status_json(run.status())
        } else {
            to_json(&IdleResponse::default())
        }
    })
}

/// JS: `optilotus_runProgramStart() -> string`
#[wasm_bindgen(js_name = optilotus_runProgramStart)]
pub fn js_run_program_start() -> String {
    init_panic_hook();
    run_program_start()
}

/// JS: `optilotus_runProgramProvideInput(value) -> string`
#[wasm_bindgen(js_name = optilotus_runProgramProvideInput)]
pub fn js_run_program_provide_input(value: &str) -> String {
    init_panic_hook();
    run_program_provide_input(value)
}

/// JS: `optilotus_runProgramCancel() -> void`
#[wasm_bindgen(js_name = optilotus_runProgramCancel)]
pub fn js_run_program_cancel() {
    init_panic_hook();
    run_program_cancel()
}

/// JS: `optilotus_runProgramStatus() -> string`
#[wasm_bindgen(js_name = optilotus_runProgramStatus)]
pub fn js_run_program_status() -> String {
    init_panic_hook();
    run_program_status()
}

/// Peek at pending input without consuming it.
/// Returns `{"status":"waiting_input","command":...,"ty":...}` or `{"status":"idle"}` / error.
#[wasm_bindgen(js_name = optilotus_runProgramPeekPending)]
pub fn js_run_program_peek_pending() -> String {
    init_panic_hook();
    run_program_peek_pending()
}

/// Reset / clear the active run session. Returns `{"status":"idle"}`.
#[wasm_bindgen(js_name = optilotus_runProgramReset)]
pub fn js_run_program_reset() -> String {
    init_panic_hook();
    run_program_reset()
}

/// Query the last recorded error. Returns `{"status":"idle"}` if none.
#[wasm_bindgen(js_name = optilotus_lastError)]
pub fn js_last_error() -> String {
    init_panic_hook();
    run_program_last_error()
}

/// Batch provide multiple input lines sequentially.
/// Stops at the first `waiting_input` or completion.
#[wasm_bindgen(js_name = optilotus_runProgramProvideInputs)]
pub fn js_run_program_provide_inputs(inputs_json: &str) -> String {
    init_panic_hook();
    run_program_provide_inputs(inputs_json)
}

/// Provide a single typed input value (JSON-encoded).
/// The library parses the JSON value according to the pending command's type.
#[wasm_bindgen(js_name = optilotus_runProgramProvideInputTyped)]
pub fn js_run_program_provide_input_typed(value_json: &str) -> String {
    init_panic_hook();
    run_program_provide_input_typed(value_json)
}

/// Enable or disable debug mode (adds extra introspection fields to status JSON).
#[wasm_bindgen(js_name = optilotus_debugMode)]
pub fn js_run_program_debug_mode(enable: bool) {
    init_panic_hook();
    run_program_debug_mode(enable);
}

/// JS: `opilotus_runProgram() -> string` (JSON report, no JSON input)
#[wasm_bindgen(js_name = optilotus_runProgram)]
pub fn js_run_program() -> String {
    init_panic_hook();
    run_program()
}

/// Peek at pending input without consuming it.
/// Returns `{"status":"waiting_input","command":...,"ty":...}` or `{"status":"idle"}` / error.
pub fn run_program_peek_pending() -> String {
    RUN.with(|cell| {
        if let Some(run) = cell.borrow().as_ref() {
            match run.peek_pending() {
                Some(p) => to_json(&WaitingInputResponse::new(p.command, p.ty)),
                None => {
                    if let Some(err) = &run.error {
                        to_json(&exec_error_json(err))
                    } else if run.frames.is_empty() {
                        to_json(&RunOkResponse::new(
                            run.global_steps,
                            run.global_prints,
                            run.sink.lines.clone(),
                            run.result.clone(),
                        ))
                    } else {
                        to_json(&IdleResponse::default())
                    }
                }
            }
        } else {
            to_json(&IdleResponse::default())
        }
    })
}

/// Reset / clear the active run session. Returns `{"status":"idle"}`.
pub fn run_program_reset() -> String {
    RUN.with(|cell| {
        *cell.borrow_mut() = None;
    });
    to_json(&IdleResponse::default())
}

/// Query the last recorded error. Returns `{"status":"idle"}` if none.
pub fn run_program_last_error() -> String {
    LAST_ERROR.with(|cell| match &*cell.borrow() {
        Some(err) => to_json(&exec_error_json(err)),
        None => to_json(&IdleResponse::default()),
    })
}

/// Batch provide multiple input lines sequentially.
/// Feeds each value in order, stopping at the first `waiting_input` or completion.
/// Malformed JSON returns a typed error — never a silent empty batch.
pub fn run_program_provide_inputs(inputs_json: &str) -> String {
    let inputs: Vec<String> = match serde_json::from_str(inputs_json) {
        Ok(v) => v,
        Err(e) => return invalid_inputs_json(&e),
    };
    RUN.with(|cell| {
        let mut cell = cell.borrow_mut();
        if let Some(run) = cell.as_mut() {
            let mut last_status = run.status();
            for input in &inputs {
                match &last_status {
                    crate::run_resumable::RunStatus::WaitingInput { .. } => {
                        last_status = run.provide_input(input);
                    }
                    _ => break,
                }
            }
            run_status_json(last_status)
        } else {
            to_json(&ErrorResponse::new("NoRun", "no active run"))
        }
    })
}

/// Provide a single typed input value (JSON-encoded).
/// The library parses the JSON value according to the pending command's type.
pub fn run_program_provide_input_typed(value_json: &str) -> String {
    RUN.with(|cell| {
        let mut cell = cell.borrow_mut();
        if let Some(run) = cell.as_mut() {
            let pending = match run.peek_pending() {
                Some(p) => p.clone(),
                None => {
                    let e = ExecError::InvalidState;
                    run.error = Some(e.clone());
                    return run_status_json(RunStatus::Error(e));
                }
            };
            let parsed: serde_json::Value = match serde_json::from_str(value_json) {
                Ok(v) => v,
                Err(_) => {
                    let e = ExecError::InputParse {
                        command: pending.command,
                        detail: "invalid JSON input".to_string(),
                    };
                    run.error = Some(e.clone());
                    return run_status_json(RunStatus::Error(e));
                }
            };
            match coerce_json_to_value(&parsed, pending.ty) {
                Ok(v) => {
                    let s = v.to_string();
                    run_status_json(run.provide_input(&s))
                }
                Err(detail) => {
                    let e = ExecError::InputParse {
                        command: pending.command,
                        detail,
                    };
                    run.error = Some(e.clone());
                    run_status_json(RunStatus::Error(e))
                }
            }
        } else {
            to_json(&ErrorResponse::new("NoRun", "no active run"))
        }
    })
}

/// Enable or disable debug mode (adds extra introspection fields to status JSON).
pub fn run_program_debug_mode(enable: bool) {
    DEBUG_MODE.with(|cell| {
        *cell.borrow_mut() = enable;
    });
}

/// Coerce a serde_json::Value into a runtime Value for the given type.
fn coerce_json_to_value(
    v: &serde_json::Value,
    ty: crate::types::Type,
) -> Result<crate::value::Value, String> {
    use crate::value::Value;
    match ty {
        crate::types::Type::String => match v {
            serde_json::Value::String(s) => Ok(Value::String(s.clone())),
            other => Ok(Value::String(other.to_string())),
        },
        crate::types::Type::Bool => match v {
            serde_json::Value::Bool(b) => Ok(Value::Bool(*b)),
            serde_json::Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
                "true" => Ok(Value::Bool(true)),
                "false" => Ok(Value::Bool(false)),
                _ => Err(format!(
                    "invalid bool input {s:?}: expected \"true\" or \"false\""
                )),
            },
            _ => Err(format!("cannot coerce {v} to bool")),
        },
        crate::types::Type::Char => match v {
            serde_json::Value::String(s) => {
                let trimmed = s.trim();
                let mut chars = trimmed.chars();
                match (chars.next(), chars.next()) {
                    (Some(c), None) => Ok(Value::Char(c)),
                    _ => Err(format!(
                        "invalid char input {s:?}: expected a single character"
                    )),
                }
            }
            _ => Err(format!("cannot coerce {v} to char")),
        },
        crate::types::Type::Float32 | crate::types::Type::Float64 => {
            let number: f64 = match v {
                serde_json::Value::Number(n) => n
                    .as_f64()
                    .ok_or_else(|| format!("invalid float input {v}"))?,
                serde_json::Value::String(s) => s
                    .trim()
                    .parse::<f64>()
                    .map_err(|_| format!("invalid float input {s:?}"))?,
                _ => return Err(format!("cannot coerce {v} to float")),
            };
            if ty == crate::types::Type::Float32 {
                Ok(Value::Float32(number as f32))
            } else {
                Ok(Value::Float64(number))
            }
        }
        _ => {
            let raw: i128 = match v {
                serde_json::Value::Number(n) => n
                    .as_i64()
                    .map(|x| x as i128)
                    .ok_or_else(|| format!("invalid int input {v}"))?,
                serde_json::Value::String(s) => s
                    .trim()
                    .parse::<i128>()
                    .map_err(|_| format!("invalid int input {s:?}"))?,
                _ => return Err(format!("cannot coerce {v} to integer")),
            };
            crate::ops::narrow_input_int(raw, ty).map_err(|e| e.to_string())
        }
    }
}
