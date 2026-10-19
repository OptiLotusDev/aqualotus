//! Wire format for the UI ↔ runtime boundary (P18: serialization is a
//! contract, P23: stable interfaces).
//!
//! Every value that crosses the bridge is declared here as a real Rust
//! type rather than an ad-hoc `serde_json::json!` literal. That gives the
//! boundary one authoritative definition, which the TypeScript bindings
//! are generated from (`ts-rs`, behind the `ts-bindings` feature) and
//! which `docs/api.md` documents.
//!
//! Conventions:
//! - Rust fields stay `snake_case`; the wire uses `camelCase` for the
//!   fields the TS bridge reads (`isMain`, `commandCount`), applied with
//!   `#[serde(rename)]` per field so the Rust side reads naturally.
//! - Optional detail fields are omitted when absent
//!   (`skip_serializing_if`), matching the previous `json!` behaviour so
//!   existing TS consumers keep working.
//! - These types are a *contract*: changing a field is a breaking change
//!   to the UI, so it must be deliberate (P18).

use serde::Serialize;

use crate::error::ExecError;
use crate::ir::{CommandId, ValueId};
use crate::package::{CommandSummary, FunctionInfo, FunctionSummary};
use crate::types::Type;

/// The `status` tag every response carries, so the UI can discriminate
/// the union without guessing.
pub const STATUS_OK: &str = "ok";
pub const STATUS_ERROR: &str = "error";
pub const STATUS_IDLE: &str = "idle";
pub const STATUS_WAITING_INPUT: &str = "waiting_input";

/// Error envelope for every failed bridge call (P22: fail explicitly).
///
/// `command` is set when a specific command is responsible, so the editor
/// can highlight the offending block. `detail` carries kind-specific
/// extra information (e.g. the offending expression) when available.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"error\""))]
    pub status: &'static str,
    /// Error family, e.g. `PackageError`, `TypeMismatch`, `NoRun`.
    pub kind: String,
    /// Responsible command id, or `None` when the failure is not tied to one.
    pub command: Option<u32>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub value: Option<u32>,
    /// `Arity` only: the expected parameter shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub expected: Option<String>,
    /// `Arity` only: how many arguments were actually supplied.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub found: Option<usize>,
    /// `LoopLimit` only: the step budget that was exceeded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub limit: Option<usize>,
    /// `UnknownVariable` only: the variable name that was not declared.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub var: Option<String>,
    /// `UnknownFunction` / `MissingReturn` only: the function name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub function: Option<String>,
}

impl ErrorResponse {
    /// Build an error envelope with no command attribution.
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status: STATUS_ERROR,
            kind: kind.into(),
            command: None,
            message: message.into(),
            detail: None,
            value: None,
            expected: None,
            found: None,
            limit: None,
            var: None,
            function: None,
        }
    }

    /// Build an error envelope attributed to a command.
    pub fn at_command(
        kind: impl Into<String>,
        command: CommandId,
        message: impl Into<String>,
    ) -> Self {
        Self {
            status: STATUS_ERROR,
            kind: kind.into(),
            command: Some(command.0),
            message: message.into(),
            detail: None,
            value: None,
            expected: None,
            found: None,
            limit: None,
            var: None,
            function: None,
        }
    }

    /// Attach kind-specific detail.
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    /// Attach the offending value id (used by `MissingValue`).
    pub fn with_value(mut self, value: ValueId) -> Self {
        self.value = Some(value.0);
        self
    }
}

/// `{"status":"idle"}` — no active run session, or nothing to report.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct IdleResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"idle\""))]
    pub status: &'static str,
}

impl Default for IdleResponse {
    fn default() -> Self {
        Self { status: STATUS_IDLE }
    }
}

/// `{"status":"ok"}` — a mutation with no payload to return.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct OkResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
    pub status: &'static str,
}

impl Default for OkResponse {
    fn default() -> Self {
        Self { status: STATUS_OK }
    }
}

/// `{"status":"ok","id"}` — a created or mutated command's user head id.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct CommandIdResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
    pub status: &'static str,
    pub id: u32,
}

impl CommandIdResponse {
    pub fn new(id: CommandId) -> Self {
        Self {
            status: STATUS_OK,
            id: id.0,
        }
    }
}

/// `{"status":"ok","deleted":id}` — a removed function or command.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct DeletedResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
    pub status: &'static str,
    pub deleted: u32,
}

impl DeletedResponse {
    pub fn new(deleted: u32) -> Self {
        Self {
            status: STATUS_OK,
            deleted,
        }
    }
}

/// `{"status":"ok","cleared":n}` — helpers wiped by `clearPackage`.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct ClearedResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
    pub status: &'static str,
    pub cleared: usize,
}

impl ClearedResponse {
    pub fn new(cleared: usize) -> Self {
        Self {
            status: STATUS_OK,
            cleared,
        }
    }
}

/// One function row in `listFunctions`.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FunctionRow {
    pub id: u32,
    pub name: String,
    pub is_main: bool,
}

impl From<&FunctionSummary> for FunctionRow {
    fn from(f: &FunctionSummary) -> Self {
        Self {
            id: f.id.0,
            name: f.name.clone(),
            is_main: f.is_main,
        }
    }
}

/// `{"status":"ok","functions":[...]}` — the whole function registry.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct ListFunctionsResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
    pub status: &'static str,
    pub functions: Vec<FunctionRow>,
}

impl ListFunctionsResponse {
    pub fn new(functions: Vec<FunctionRow>) -> Self {
        Self {
            status: STATUS_OK,
            functions,
        }
    }
}

/// `{"status":"ok","id","name","isMain"}` — create / rename result.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FunctionResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
    pub status: &'static str,
    pub id: u32,
    pub name: String,
    pub is_main: bool,
}

impl From<&FunctionInfo> for FunctionResponse {
    fn from(info: &FunctionInfo) -> Self {
        Self {
            status: STATUS_OK,
            id: info.id.0,
            name: info.name.clone(),
            is_main: info.is_main,
        }
    }
}

/// `{"status":"ok","id","name","isMain","entry","commandCount"}` —
/// full inspection of one function.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FunctionInfoResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
    pub status: &'static str,
    pub id: u32,
    pub name: String,
    pub is_main: bool,
    /// Entry command id, or `None` when the function has no entry point.
    pub entry: Option<u32>,
    pub command_count: usize,
}

impl From<&FunctionInfo> for FunctionInfoResponse {
    fn from(info: &FunctionInfo) -> Self {
        Self {
            status: STATUS_OK,
            id: info.id.0,
            name: info.name.clone(),
            is_main: info.is_main,
            entry: info.entry.map(|c| c.0),
            command_count: info.command_count,
        }
    }
}

/// `{"status":"ok","commands":[...]}` — one function's user commands.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct ListCommandsResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
    pub status: &'static str,
    pub commands: Vec<CommandSummary>,
}

impl ListCommandsResponse {
    pub fn new(commands: Vec<CommandSummary>) -> Self {
        Self {
            status: STATUS_OK,
            commands,
        }
    }
}

/// `{"status":"ok","steps","prints","printed","returned"}` — a completed
/// run. `returned` is the value `main` produced, or `None`.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct RunOkResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
    pub status: &'static str,
    pub steps: usize,
    pub prints: usize,
    pub printed: Vec<String>,
    pub returned: Option<crate::value::Value>,
    /// Present only in debug mode: mirrors `steps` for introspection.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub step_count: Option<usize>,
}

impl RunOkResponse {
    pub fn new(
        steps: usize,
        prints: usize,
        printed: Vec<String>,
        returned: Option<crate::value::Value>,
    ) -> Self {
        Self {
            status: STATUS_OK,
            steps,
            prints,
            printed,
            returned,
            step_count: None,
        }
    }

    /// Attach the debug-mode step mirror.
    pub fn with_debug(mut self, debug: bool) -> Self {
        if debug {
            self.step_count = Some(self.steps);
        }
        self
    }
}

/// `{"status":"waiting_input","command","ty"}` — the run paused for input.
/// `peek` is present only in debug mode.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct WaitingInputResponse {
    #[cfg_attr(feature = "ts-bindings", ts(type = "\"waiting_input\""))]
    pub status: &'static str,
    pub command: u32,
    pub ty: Type,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub peek: Option<bool>,
}

impl WaitingInputResponse {
    pub fn new(command: CommandId, ty: Type) -> Self {
        Self {
            status: STATUS_WAITING_INPUT,
            command: command.0,
            ty,
            peek: None,
        }
    }
}

/// Convert an execution error into its wire envelope. One place owns the
/// mapping, so the TS union and `docs/api.md` stay in step with
/// `ExecError` (P1: one responsibility).
pub fn exec_error_response(err: &ExecError) -> ErrorResponse {
    use ExecError as E;
    let message = err.to_string();
    match err {
        E::TypeMismatch { command, detail } => {
            ErrorResponse::at_command("TypeMismatch", *command, message).with_detail(detail)
        }
        E::Overflow { command } => ErrorResponse::at_command("Overflow", *command, message),
        E::DivByZero { command } => ErrorResponse::at_command("DivByZero", *command, message),
        E::MissingValue { command, value } => {
            ErrorResponse::at_command("MissingValue", *command, message).with_value(*value)
        }
        E::Arity {
            command,
            expected,
            found,
        } => {
            let mut response = ErrorResponse::at_command("Arity", *command, message);
            response.expected = Some(expected.clone());
            response.found = Some(*found);
            response
        }
        E::UnknownCommand { command } => {
            ErrorResponse::at_command("UnknownCommand", *command, message)
        }
        E::LoopLimit { limit } => {
            let mut response = ErrorResponse::new("LoopLimit", message);
            response.limit = Some(*limit);
            response
        }
        E::UnknownVariable { command, var } => {
            let mut response = ErrorResponse::at_command("UnknownVariable", *command, message);
            response.var = Some(var.clone());
            response
        }
        E::ExprError { command, detail } => {
            ErrorResponse::at_command("ExprError", *command, message).with_detail(detail)
        }
        E::UnknownFunction { command, name } => {
            let mut response = ErrorResponse::at_command("UnknownFunction", *command, message);
            response.function = Some(name.clone());
            response
        }
        E::MissingReturn { command, function } => {
            let mut response = ErrorResponse::at_command("MissingReturn", *command, message);
            response.function = Some(function.clone());
            response
        }
        E::InputEof { command } => ErrorResponse::at_command("InputEof", *command, message),
        E::InputParse { command, detail } => {
            ErrorResponse::at_command("InputParse", *command, message).with_detail(detail)
        }
        E::Paused => ErrorResponse::new("Paused", message),
        E::InvalidState => ErrorResponse::new("InvalidState", message),
    }
}
