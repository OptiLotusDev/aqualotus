use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::expr::{check_var_name, ExprFail};
use crate::ir::{Command, CommandId, Function, FunctionId, ValueId};
use crate::ops::Op;
use crate::sink::PrintSink;
use crate::types::Type;
use crate::value::Value;

/// Stable id of the always-present entry function.
pub const MAIN_ID: FunctionId = FunctionId(0);
/// Reserved entry name.
pub const MAIN_NAME: &str = "main";
/// Package name used in [`Package::as_program`]. Hardcoded placeholder
/// until multi-package exists; not user-settable.
pub const PACKAGE_NAME: &str = "app";

/// Owned single-package registry: the single global behind the bridge.
///
/// Holds all functions behind the bridge. `main` (`FunctionId(0)`) always
/// exists and cannot be deleted. Id allocators live here so the UI only
/// passes typed ids, never IR JSON.
///
/// Commands are stored as raw `Function` IR (reused for execution) plus a
/// thin user-facing metadata map for `list_commands`. Each frontend op
/// (`declare`/`assign`/`print`) expands to two raw commands
/// (`Lit`/`Compute` + `Set`/`Print`); `return` is a single `Op::Return`.
/// The user-visible id is the head raw id, so `entry` points at a head and
/// execution reuses the existing `run_function` path.
#[derive(Debug, Clone)]
pub struct Package {
    functions: HashMap<FunctionId, Function>,
    order: Vec<FunctionId>,
    meta: HashMap<FunctionId, HashMap<CommandId, CommandSummary>>,
    next_function_id: u32,
    next_command_id: u32,
    next_value_id: u32,
}

/// Typed failures for package CRUD + command builders.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageError {
    ReservedName(String),
    DuplicateName(String),
    UnknownFunction(FunctionId),
    MainProtected,
    InvalidName(String),
    UnknownCommand(CommandId),
    UnknownType(String),
    UndeclaredVariable(String),
    DuplicateVariable(String),
    InvalidCommand(String),
}

impl fmt::Display for PackageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PackageError::ReservedName(name) => {
                write!(f, "cannot create function {name:?}: \"main\" is reserved")
            }
            PackageError::DuplicateName(name) => {
                write!(f, "function {name:?} already exists")
            }
            PackageError::UnknownFunction(id) => {
                write!(f, "unknown function {:?}", id.0)
            }
            PackageError::MainProtected => {
                write!(f, "cannot delete entry function \"main\"")
            }
            PackageError::InvalidName(detail) => write!(f, "{detail}"),
            PackageError::UnknownCommand(id) => {
                write!(f, "unknown command {:?}", id.0)
            }
            PackageError::UnknownType(tag) => {
                write!(
                    f,
                    "unknown type {tag:?}: use a lowercase tag like \"int32\" or \"string\""
                )
            }
            PackageError::UndeclaredVariable(var) => {
                write!(
                    f,
                    "cannot assign undeclared variable {var:?}: declare it first"
                )
            }
            PackageError::DuplicateVariable(var) => {
                write!(f, "variable {var:?} is already declared")
            }
            PackageError::InvalidCommand(detail) => write!(f, "{detail}"),
        }
    }
}

impl std::error::Error for PackageError {}

/// `{id, name, isMain}` for `list_functions`.
/// Rust fields stay `snake_case`; wire JSON uses `camelCase` for the TS
/// bridge (see `docs/api.md`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct FunctionSummary {
    pub id: FunctionId,
    pub name: String,
    #[serde(rename = "isMain")]
    pub is_main: bool,
}

/// `{id, name, isMain, entry, commandCount}` for `get_function`.
/// `command_count` is the user-visible count (matches `list_commands`
/// length), not raw IR length.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct FunctionInfo {
    pub id: FunctionId,
    pub name: String,
    #[serde(rename = "isMain")]
    pub is_main: bool,
    pub entry: Option<CommandId>,
    #[serde(rename = "commandCount")]
    pub command_count: usize,
}

/// User-facing kind, not raw `Op`. Serialized lowercase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub enum CommandKind {
    Declare,
    Assign,
    Print,
    Input,
    Cast,
    Return,
    If,
}

/// Visibility of a declared variable.
///
/// Scope today: there is exactly one package and no classes, so `public`
/// and `protected` currently mean the same thing — the variable is usable
/// by every function in the package. `private` restricts a variable to
/// the function that declares it, which is also the current runtime
/// behaviour for every variable (each call gets a fresh scope).
///
/// The distinction is recorded and surfaced now so the language has a
/// place for it; enforcement becomes observable when classes and
/// multiple packages exist. See `docs/api.md` for the current limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub enum Access {
    /// Visible to every package (global scope). Currently equivalent to
    /// `Protected`, because only one package can exist.
    Public,
    /// Visible within the declaring package. Currently equivalent to
    /// `Public`; becomes distinct once multiple packages exist.
    Protected,
    /// Visible only inside the declaring scope: the function today, and
    /// the class once classes exist. This is the default, and it matches
    /// the runtime's existing per-call variable scope.
    #[default]
    Private,
}

impl Access {
    /// Parse a wire tag (`"public"` / `"protected"` / `"private"`).
    pub fn parse_tag(tag: &str) -> Option<Self> {
        match tag {
            "public" => Some(Access::Public),
            "protected" => Some(Access::Protected),
            "private" => Some(Access::Private),
            _ => None,
        }
    }

    /// Wire tag for this access level.
    pub fn tag(self) -> &'static str {
        match self {
            Access::Public => "public",
            Access::Protected => "protected",
            Access::Private => "private",
        }
    }
}

/// User-level command spec: the frontend-facing shape for building `if`
/// bodies. A flat struct with a `kind` tag so it serializes exactly like
/// the TS `CommandSpec` union — the bridge passes it as a native JS
/// object (`JsValue`) and deserializes server-side. The server
/// validates, allocates ids and expands each spec into the same raw
/// commands the builders produce; callers never build or pass raw IR.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct CommandSpec {
    pub kind: CommandKind,
    pub var: Option<String>,
    pub ty: Option<Type>,
    /// `declare` only: the variable's visibility (defaults to `private`).
    #[serde(default)]
    pub access: Option<Access>,
    #[serde(default)]
    pub init: Option<String>,
    pub expr: Option<String>,
    pub template: Option<String>,
    pub to: Option<Type>,
}

impl CommandSpec {
    /// Convenience constructors (used by tests and the TS bridge).
    pub fn declare(var: &str, ty: Type, init: Option<String>) -> Self {
        Self {
            kind: CommandKind::Declare,
            var: Some(var.to_string()),
            ty: Some(ty),
            access: None,
            init,
            expr: None,
            template: None,
            to: None,
        }
    }
    pub fn assign(var: &str, expr: &str) -> Self {
        Self {
            kind: CommandKind::Assign,
            var: Some(var.to_string()),
            ty: None,
            access: None,
            init: None,
            expr: Some(expr.to_string()),
            template: None,
            to: None,
        }
    }
    pub fn print(template: &str) -> Self {
        Self {
            kind: CommandKind::Print,
            var: None,
            ty: None,
            access: None,
            init: None,
            expr: None,
            template: Some(template.to_string()),
            to: None,
        }
    }
    pub fn input(ty: Type) -> Self {
        Self {
            kind: CommandKind::Input,
            var: None,
            access: None,
            ty: Some(ty),
            init: None,
            expr: None,
            template: None,
            to: None,
        }
    }
    pub fn cast(var: &str, to: Type, expr: &str) -> Self {
        Self {
            kind: CommandKind::Cast,
            var: Some(var.to_string()),
            ty: None,
            access: None,
            init: None,
            expr: Some(expr.to_string()),
            template: None,
            to: Some(to),
        }
    }
}

/// User-facing command row for `list_commands`.
/// `next` is the following user command head (`None` at the tail end or
/// when the edge was cleared); it is filled from the live raw graph on
/// every `list_commands` call, so rewires are always reflected. The
/// stored meta keeps `None` — the raw `next` edges are the source of truth.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct CommandSummary {
    pub id: CommandId,
    pub kind: CommandKind,
    pub next: Option<CommandId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub var: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub ty: Option<Type>,
    /// `declare` only: the variable's visibility. Omitted for every other
    /// kind, and for declarations made before access existed (which read
    /// as `private`, the historical behaviour).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub access: Option<Access>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub expr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub condition: Option<ValueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub then_body: Option<Vec<CommandId>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub else_body: Option<Vec<CommandId>>,
}

impl CommandSummary {
    /// Blank row: identity, kind and linkage only. Builders fill the
    /// per-kind detail fields, so adding a field touches one place.
    fn blank(id: CommandId, kind: CommandKind) -> Self {
        Self {
            id,
            kind,
            next: None,
            var: None,
            ty: None,
            access: None,
            expr: None,
            template: None,
            condition: None,
            then_body: None,
            else_body: None,
        }
    }
}

fn default_value(ty: Type) -> Value {
    match ty {
        Type::Int8 => Value::Int8(0),
        Type::Int16 => Value::Int16(0),
        Type::Int32 => Value::Int32(0),
        Type::Int64 => Value::Int64(0),
        Type::Int128 => Value::Int128(0),
        Type::Uint8 => Value::Uint8(0),
        Type::Uint16 => Value::Uint16(0),
        Type::Uint32 => Value::Uint32(0),
        Type::Uint64 => Value::Uint64(0),
        Type::Uint128 => Value::Uint128(0),
        Type::Float32 => Value::Float32(0.0),
        Type::Float64 => Value::Float64(0.0),
        Type::Bool => Value::Bool(false),
        Type::Char => Value::Char('\0'),
        Type::String => Value::String(String::new()),
        Type::Void => Value::Void,
    }
}

/// Parse user text into a value of the declared type.
///
/// `string` is kept verbatim (no trimming); every other type trims
/// surrounding whitespace. Out-of-range integers are `Overflow`,
/// malformed text is `Parse`, `void` is rejected.
fn parse_value(ty: Type, text: &str) -> Result<Value, ExprFail> {
    match ty {
        Type::String => Ok(Value::String(text.to_string())),
        Type::Void => Err(ExprFail::TypeMismatch(
            "cannot declare a variable of type void".to_string(),
        )),
        Type::Bool => match text.trim() {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            _ => Err(ExprFail::Parse(format!(
                "invalid bool literal {text:?}: expected \"true\" or \"false\""
            ))),
        },
        Type::Char => {
            let mut chars = text.trim().chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Ok(Value::Char(c)),
                _ => Err(ExprFail::Parse(format!(
                    "invalid char literal {text:?}: expected a single character"
                ))),
            }
        }
        Type::Float32 | Type::Float64 => {
            let number: f64 = text
                .trim()
                .parse()
                .map_err(|_| ExprFail::Parse(format!("invalid {} literal {text:?}", ty.tag())))?;
            if ty == Type::Float32 {
                Ok(Value::Float32(number as f32))
            } else {
                Ok(Value::Float64(number))
            }
        }
        _ => {
            let raw = text
                .trim()
                .parse::<i128>()
                .map_err(|_| ExprFail::Parse(format!("invalid {} literal {text:?}", ty.tag())))?;
            narrow_int(raw, ty)
        }
    }
}

fn narrow_int(raw: i128, ty: Type) -> Result<Value, ExprFail> {
    match ty {
        Type::Int8 => i8::try_from(raw)
            .map(Value::Int8)
            .map_err(|_| ExprFail::Overflow),
        Type::Int16 => i16::try_from(raw)
            .map(Value::Int16)
            .map_err(|_| ExprFail::Overflow),
        Type::Int32 => i32::try_from(raw)
            .map(Value::Int32)
            .map_err(|_| ExprFail::Overflow),
        Type::Int64 => i64::try_from(raw)
            .map(Value::Int64)
            .map_err(|_| ExprFail::Overflow),
        Type::Int128 => Ok(Value::Int128(raw)),
        Type::Uint8 => u8::try_from(raw)
            .map(Value::Uint8)
            .map_err(|_| ExprFail::Overflow),
        Type::Uint16 => u16::try_from(raw)
            .map(Value::Uint16)
            .map_err(|_| ExprFail::Overflow),
        Type::Uint32 => u32::try_from(raw)
            .map(Value::Uint32)
            .map_err(|_| ExprFail::Overflow),
        Type::Uint64 => u64::try_from(raw)
            .map(Value::Uint64)
            .map_err(|_| ExprFail::Overflow),
        Type::Uint128 => u128::try_from(raw)
            .map(Value::Uint128)
            .map_err(|_| ExprFail::Overflow),
        _ => Err(ExprFail::TypeMismatch(format!(
            "cannot parse {} value from text",
            ty.tag()
        ))),
    }
}

/// Which branch of an `if` command the caller wants to target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IfSide {
    /// The `then_body` branch of an `if`.
    Then,
    /// The `else_body` branch of an `if`.
    Else,
}

impl IfSide {
    /// Wire spelling of the side (`"then"` / `"else"`), used only for
    /// serialisation / display round-trips.
    pub fn tag(self) -> &'static str {
        match self {
            IfSide::Then => "then",
            IfSide::Else => "else",
        }
    }
}

impl Package {
    /// Empty package with a single empty `main`.
    pub fn new() -> Self {
        let mut functions = HashMap::new();
        functions.insert(
            MAIN_ID,
            Function {
                id: MAIN_ID,
                name: MAIN_NAME.to_string(),
                entry: None,
                commands: Vec::new(),
            },
        );
        let mut meta = HashMap::new();
        meta.insert(MAIN_ID, HashMap::new());
        Self {
            functions,
            order: vec![MAIN_ID],
            meta,
            next_function_id: 1,
            next_command_id: 1,
            next_value_id: 1,
        }
    }

    fn validate_function_name(&self, raw: &str) -> Result<String, PackageError> {
        let name = raw.trim().to_string();
        if name.is_empty() {
            return Err(PackageError::InvalidName(
                "function name must not be empty".to_string(),
            ));
        }
        if name.chars().any(|c| c == '{' || c == '}' || c == '"') {
            return Err(PackageError::InvalidName(format!(
                "invalid function name {name:?}: must not contain '{{', '}}' or '\"'"
            )));
        }
        if name == MAIN_NAME {
            return Err(PackageError::ReservedName(name));
        }
        if self.functions.values().any(|f| f.name == name) {
            return Err(PackageError::DuplicateName(name));
        }
        Ok(name)
    }

    /// List all functions in id order (`main` first).
    pub fn list_functions(&self) -> Vec<FunctionSummary> {
        let mut ids: Vec<FunctionId> = self.order.clone();
        ids.sort_by_key(|id| id.0);
        ids.into_iter()
            .filter_map(|id| self.functions.get(&id))
            .map(|f| FunctionSummary {
                id: f.id,
                name: f.name.clone(),
                is_main: f.id == MAIN_ID,
            })
            .collect()
    }

    /// Create a function; rejects `"main"` and duplicate names.
    pub fn create_function(&mut self, name: &str) -> Result<FunctionId, PackageError> {
        let clean = self.validate_function_name(name)?;
        let id = FunctionId(self.next_function_id);
        self.next_function_id += 1;
        self.functions.insert(
            id,
            Function {
                id,
                name: clean,
                entry: None,
                commands: Vec::new(),
            },
        );
        self.meta.insert(id, HashMap::new());
        self.order.push(id);
        Ok(id)
    }

    /// Inspect one function.
    pub fn get_function(&self, id: FunctionId) -> Result<FunctionInfo, PackageError> {
        let f = self
            .functions
            .get(&id)
            .ok_or(PackageError::UnknownFunction(id))?;
        let count = self.meta.get(&id).map(|m| m.len()).unwrap_or(0);
        Ok(FunctionInfo {
            id: f.id,
            name: f.name.clone(),
            is_main: f.id == MAIN_ID,
            entry: f.entry,
            command_count: count,
        })
    }

    /// Delete a helper; `main` is protected.
    pub fn delete_function(&mut self, id: FunctionId) -> Result<(), PackageError> {
        if id == MAIN_ID {
            return Err(PackageError::MainProtected);
        }
        if self.functions.remove(&id).is_none() {
            return Err(PackageError::UnknownFunction(id));
        }
        self.meta.remove(&id);
        self.order.retain(|kept| *kept != id);
        Ok(())
    }

    /// Rename a function, preserving its stable `FunctionId`.
    ///
    /// Validates the new name (non-empty, no `{}"` chars, not `"main"` unless
    /// renaming `main` itself, no duplicates). Mutates only the `name` field;
    /// all IDs, references, and `ValueId`s are untouched.
    pub fn try_rename(&mut self, id: FunctionId, new_name: &str) -> Result<(), PackageError> {
        if !self.functions.contains_key(&id) {
            return Err(PackageError::UnknownFunction(id));
        }
        let clean = new_name.trim().to_string();
        if clean.is_empty() {
            return Err(PackageError::InvalidName(
                "function name must not be empty".to_string(),
            ));
        }
        if clean.chars().any(|c| c == '{' || c == '}' || c == '"') {
            return Err(PackageError::InvalidName(format!(
                "invalid function name {clean:?}: must not contain '{{', '}}' or '\"'"
            )));
        }
        if clean == MAIN_NAME && id != MAIN_ID {
            return Err(PackageError::ReservedName(clean));
        }
        let current_name = self.functions.get(&id).expect("exists").name.clone();
        if clean != current_name && self.functions.values().any(|f| f.name == clean) {
            return Err(PackageError::DuplicateName(clean));
        }
        self.functions.get_mut(&id).expect("exists").name = clean;
        Ok(())
    }

    /// Wipe all but re-create an empty `main`.
    pub fn clear_package(&mut self) {
        self.functions.clear();
        self.order.clear();
        self.meta.clear();
        self.functions.insert(
            MAIN_ID,
            Function {
                id: MAIN_ID,
                name: MAIN_NAME.to_string(),
                entry: None,
                commands: Vec::new(),
            },
        );
        self.meta.insert(MAIN_ID, HashMap::new());
        self.order.push(MAIN_ID);
        self.next_function_id = 1;
        self.next_command_id = 1;
        self.next_value_id = 1;
    }

    /// Read-only raw access for exec/tests.
    pub fn function(&self, id: FunctionId) -> Option<&Function> {
        self.functions.get(&id)
    }

    /// Allocate a fresh command id.
    pub fn alloc_command_id(&mut self) -> CommandId {
        let id = CommandId(self.next_command_id);
        self.next_command_id += 1;
        id
    }

    /// Allocate a fresh value id.
    pub fn alloc_value_id(&mut self) -> ValueId {
        let id = ValueId(self.next_value_id);
        self.next_value_id += 1;
        id
    }

    // ------------------------------------------------------------------
    // Command builders (Phase 2): thin expansion onto existing IR.
    // ------------------------------------------------------------------

    fn function_mut(&mut self, id: FunctionId) -> Result<&mut Function, PackageError> {
        self.functions
            .get_mut(&id)
            .ok_or(PackageError::UnknownFunction(id))
    }

    fn declared_type(&self, fid: FunctionId, var: &str) -> Option<Type> {
        self.meta.get(&fid).and_then(|m| {
            m.values().find_map(|s| {
                // Both `declare` and `cast` introduce a variable.
                if matches!(s.kind, CommandKind::Declare | CommandKind::Cast)
                    && s.var.as_deref() == Some(var)
                {
                    s.ty
                } else {
                    None
                }
            })
        })
    }

    fn tail_of(func: &Function) -> Option<CommandId> {
        let mut current = func.entry?;
        let mut seen = HashSet::new();
        loop {
            if !seen.insert(current) {
                return Some(current);
            }
            let cmd = func.find_command(current)?;
            match cmd.next {
                Some(n) => current = n,
                None => return Some(current),
            }
            if seen.len() > func.commands.len() + 1 {
                return Some(current);
            }
        }
    }

    /// Append 1-2 raw commands, linking the previous tail to `head`.
    fn append_raw(&mut self, fid: FunctionId, head: Command, tail: Option<Command>) {
        let head_id = head.id;
        let Some(func) = self.functions.get_mut(&fid) else {
            return;
        };
        let prev_tail = if func.entry.is_none() {
            None
        } else {
            Self::tail_of(func)
        };
        func.commands.push(head);
        if let Some(t) = tail {
            func.commands.push(t);
        }
        // Re-borrow after push to update links.
        let func = self.functions.get_mut(&fid).expect("exists");
        match prev_tail {
            None => {
                func.entry = Some(head_id);
            }
            Some(prev) => {
                if prev == head_id {
                    func.entry = Some(head_id);
                } else if let Some(cmd) = func.commands.iter_mut().find(|c| c.id == prev) {
                    // Only link if the previous tail is truly a tail (or at
                    // least not the new head); never overwrite the internal
                    // head->pair edge of the just-pushed group.
                    if cmd.next.is_none() {
                        cmd.next = Some(head_id);
                    } else if func.entry.is_none() {
                        func.entry = Some(head_id);
                    }
                } else {
                    func.entry = Some(head_id);
                }
            }
        }
    }

    fn meta_mut(
        &mut self,
        fid: FunctionId,
    ) -> Result<&mut HashMap<CommandId, CommandSummary>, PackageError> {
        self.meta
            .get_mut(&fid)
            .ok_or(PackageError::UnknownFunction(fid))
    }

    /// Build the raw `Lit` -> `Set` pair for a `declare` and push it into
    /// the function's command list (not yet linked into the main chain).
    /// Returns `(head, tail)` commands.
    fn declare_group(
        &mut self,
        fid: FunctionId,
        var: &str,
        ty: Type,
        value: Value,
    ) -> Result<(Command, Command), PackageError> {
        let vid = self.alloc_value_id();
        let head_id = self.alloc_command_id();
        let tail_id = self.alloc_command_id();
        let head = Command {
            id: head_id,
            op: Op::Lit(value),
            inputs: vec![],
            outputs: vec![vid],
            next: Some(tail_id),
        };
        let tail = Command {
            id: tail_id,
            op: Op::Set {
                var: var.to_string(),
                ty,
            },
            inputs: vec![vid],
            outputs: vec![],
            next: None,
        };
        let func = self.function_mut(fid)?;
        func.commands.push(head.clone());
        func.commands.push(tail.clone());
        Ok((head, tail))
    }

    /// Link a freshly built group head onto the tail of the main chain
    /// (or make it the entry when the chain is empty). Extracted so both
    /// the main-chain builders and the `if`-body stager share one
    /// implementation.
    fn link_chain(&mut self, fid: FunctionId, head_id: CommandId) -> Result<(), PackageError> {
        let prev_tail = self.functions.get(&fid).and_then(|f| {
            if f.entry.is_none() {
                None
            } else {
                Self::tail_of(f)
            }
        });
        let func = self.function_mut(fid)?;
        match prev_tail {
            None => {
                func.entry = Some(head_id);
            }
            Some(prev) => {
                if prev == head_id {
                    func.entry = Some(head_id);
                } else if let Some(cmd) = func.commands.iter_mut().find(|c| c.id == prev) {
                    // Only link if the previous tail is truly a tail (or at
                    // least not the new head); never overwrite the internal
                    // head->pair edge of the just-pushed group.
                    if cmd.next.is_none() {
                        cmd.next = Some(head_id);
                    } else if func.entry.is_none() {
                        func.entry = Some(head_id);
                    }
                } else {
                    func.entry = Some(head_id);
                }
            }
        }
        Ok(())
    }

    /// `declare(name, ty, init?)`: optional `Lit` -> `Set`.
    pub fn declare(
        &mut self,
        fid: FunctionId,
        name: &str,
        ty_tag: &str,
        init: Option<&str>,
    ) -> Result<CommandId, PackageError> {
        self.declare_with_access(fid, name, ty_tag, init, Access::default())
    }

    /// `declare` with an explicit visibility.
    ///
    /// Access is recorded and surfaced but not yet enforced: with one
    /// package and no classes, `public` and `protected` are equivalent,
    /// and `private` matches the runtime's existing per-call variable
    /// scope. See [`Access`].
    pub fn declare_with_access(
        &mut self,
        fid: FunctionId,
        name: &str,
        ty_tag: &str,
        init: Option<&str>,
        access: Access,
    ) -> Result<CommandId, PackageError> {
        let var = check_var_name(name).map_err(|e| PackageError::InvalidName(e.to_string()))?;
        let Some(ty) = Type::parse_tag(ty_tag) else {
            return Err(PackageError::UnknownType(ty_tag.to_string()));
        };
        if ty == Type::Void {
            return Err(PackageError::InvalidCommand(
                "cannot declare a variable of type void".to_string(),
            ));
        }
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        if self.declared_type(fid, &var).is_some() {
            return Err(PackageError::DuplicateVariable(var));
        }
        let value = match init {
            Some(text) => {
                parse_value(ty, text).map_err(|e| PackageError::InvalidCommand(e.to_string()))?
            }
            None => default_value(ty),
        };
        let (head, _tail) = self.declare_group(fid, &var, ty, value)?;
        self.link_chain(fid, head.id)?;
        self.meta_mut(fid)?.insert(
            head.id,
            CommandSummary {
                var: Some(var),
                ty: Some(ty),
                access: Some(access),
                expr: init.map(|s| s.to_string()),
                ..CommandSummary::blank(head.id, CommandKind::Declare)
            },
        );
        Ok(head.id)
    }

    /// Build the raw `Compute` -> `Set` pair for an `assign` and push it
    /// into the function's command list (not yet linked). Returns
    /// `(head, tail)` commands.
    fn assign_group(
        &mut self,
        fid: FunctionId,
        var: &str,
        ty: Type,
        expr: &str,
    ) -> Result<(Command, Command), PackageError> {
        let vid = self.alloc_value_id();
        let head_id = self.alloc_command_id();
        let tail_id = self.alloc_command_id();
        let head = Command {
            id: head_id,
            op: Op::Compute {
                expr: expr.to_string(),
            },
            inputs: vec![],
            outputs: vec![vid],
            next: Some(tail_id),
        };
        let tail = Command {
            id: tail_id,
            op: Op::Set {
                var: var.to_string(),
                ty,
            },
            inputs: vec![vid],
            outputs: vec![],
            next: None,
        };
        let func = self.function_mut(fid)?;
        func.commands.push(head.clone());
        func.commands.push(tail.clone());
        Ok((head, tail))
    }

    /// `assign(name, expr)`: `Compute` -> `Set` (type from declaration).
    pub fn assign(
        &mut self,
        fid: FunctionId,
        name: &str,
        expr: &str,
    ) -> Result<CommandId, PackageError> {
        let var = check_var_name(name).map_err(|e| PackageError::InvalidName(e.to_string()))?;
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        let Some(ty) = self.declared_type(fid, &var) else {
            return Err(PackageError::UndeclaredVariable(var));
        };
        if expr.trim().is_empty() {
            return Err(PackageError::InvalidCommand(
                "assign expression must not be empty".to_string(),
            ));
        }
        let (head, _tail) = self.assign_group(fid, &var, ty, expr)?;
        self.link_chain(fid, head.id)?;
        self.meta_mut(fid)?.insert(
            head.id,
            CommandSummary {
                var: Some(var),
                ty: Some(ty),
                expr: Some(expr.to_string()),
                ..CommandSummary::blank(head.id, CommandKind::Assign)
            },
        );
        Ok(head.id)
    }

    /// Build the raw `Lit` -> `Print` pair for a `print` and push it into
    /// the function's command list (not yet linked). Returns
    /// `(head, tail)` commands.
    fn print_group(
        &mut self,
        fid: FunctionId,
        template: &str,
    ) -> Result<(Command, Command), PackageError> {
        let vid = self.alloc_value_id();
        let head_id = self.alloc_command_id();
        let tail_id = self.alloc_command_id();
        let head = Command {
            id: head_id,
            op: Op::Lit(Value::String(template.to_string())),
            inputs: vec![],
            outputs: vec![vid],
            next: Some(tail_id),
        };
        let tail = Command {
            id: tail_id,
            op: Op::Print,
            inputs: vec![vid],
            outputs: vec![],
            next: None,
        };
        let func = self.function_mut(fid)?;
        func.commands.push(head.clone());
        func.commands.push(tail.clone());
        Ok((head, tail))
    }

    /// `print(template)`: `Lit(template)` -> `Print`.
    pub fn print(&mut self, fid: FunctionId, template: &str) -> Result<CommandId, PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        let (head, _tail) = self.print_group(fid, template)?;
        self.link_chain(fid, head.id)?;
        self.meta_mut(fid)?.insert(
            head.id,
            CommandSummary {
                template: Some(template.to_string()),
                ..CommandSummary::blank(head.id, CommandKind::Print)
            },
        );
        Ok(head.id)
    }

    /// Build the raw `Input` command for an `input` and push it into the
    /// function's command list (not yet linked). Returns the command as
    /// both head and tail (single-command group).
    fn input_group(
        &mut self,
        fid: FunctionId,
        ty: Type,
    ) -> Result<(Command, Command), PackageError> {
        let vid = self.alloc_value_id();
        let head_id = self.alloc_command_id();
        let head = Command {
            id: head_id,
            op: Op::Input { ty },
            inputs: vec![],
            outputs: vec![vid],
            next: None,
        };
        let func = self.function_mut(fid)?;
        func.commands.push(head.clone());
        Ok((head.clone(), head))
    }

    /// `input(ty)`: single `Op::Input` producing one typed value.
    pub fn input(&mut self, fid: FunctionId, ty_tag: &str) -> Result<CommandId, PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        let Some(ty) = Type::parse_tag(ty_tag) else {
            return Err(PackageError::UnknownType(ty_tag.to_string()));
        };
        if ty == Type::Void {
            return Err(PackageError::InvalidCommand(
                "cannot read a value of type void".to_string(),
            ));
        }
        let (head, _tail) = self.input_group(fid, ty)?;
        self.link_chain(fid, head.id)?;
        self.meta_mut(fid)?.insert(
            head.id,
            CommandSummary {
                ty: Some(ty),
                ..CommandSummary::blank(head.id, CommandKind::Input)
            },
        );
        Ok(head.id)
    }

    /// Build the raw `Compute` -> `Cast` -> `Set` triple for a `cast` and
    /// push it into the function's command list (not yet linked).
    /// Returns `(compute, cast, set)` commands; the user-facing head is
    /// the `set` command (matching `pair_tail`/`delete_command`).
    fn cast_group(
        &mut self,
        fid: FunctionId,
        var: &str,
        to: Type,
        expr: &str,
    ) -> Result<(Command, Command, Command), PackageError> {
        let temp = self.alloc_value_id();
        let result = self.alloc_value_id();
        let compute_id = self.alloc_command_id();
        let cast_id = self.alloc_command_id();
        let set_id = self.alloc_command_id();
        let compute = Command {
            id: compute_id,
            op: Op::Compute {
                expr: expr.to_string(),
            },
            inputs: vec![],
            outputs: vec![temp],
            next: Some(cast_id),
        };
        let cast = Command {
            id: cast_id,
            op: Op::Cast { to },
            inputs: vec![temp],
            outputs: vec![result],
            next: Some(set_id),
        };
        let set = Command {
            id: set_id,
            op: Op::Set {
                var: var.to_string(),
                ty: to,
            },
            inputs: vec![result],
            outputs: vec![],
            next: None,
        };
        let func = self.function_mut(fid)?;
        func.commands.push(compute.clone());
        func.commands.push(cast.clone());
        func.commands.push(set.clone());
        Ok((compute, cast, set))
    }

    /// `cast(name, to, expr)`: declare `name` of type `to` initialized by
    /// casting `expr` to `to`. Expands to `Compute` -> `Cast` -> `Set`.
    ///
    /// The whole group is pushed first and then linked once onto the main
    /// chain — linking in two steps (the old implementation) reset
    /// `entry` to the `Set` because `tail_of` could not see the
    /// not-yet-pushed command, orphaning the `Compute`/`Cast` pair.
    pub fn cast(
        &mut self,
        fid: FunctionId,
        name: &str,
        to_tag: &str,
        expr: &str,
    ) -> Result<CommandId, PackageError> {
        let var = check_var_name(name).map_err(|e| PackageError::InvalidName(e.to_string()))?;
        let Some(to) = Type::parse_tag(to_tag) else {
            return Err(PackageError::UnknownType(to_tag.to_string()));
        };
        if to == Type::Void {
            return Err(PackageError::InvalidCommand(
                "cannot cast to void".to_string(),
            ));
        }
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        if self.declared_type(fid, &var).is_some() {
            return Err(PackageError::DuplicateVariable(var));
        }
        if expr.trim().is_empty() {
            return Err(PackageError::InvalidCommand(
                "cast expression must not be empty".to_string(),
            ));
        }
        let (compute, _cast, set) = self.cast_group(fid, &var, to, expr)?;
        self.link_chain(fid, compute.id)?;
        self.meta_mut(fid)?.insert(
            set.id,
            CommandSummary {
                var: Some(var),
                ty: Some(to),
                expr: Some(expr.to_string()),
                ..CommandSummary::blank(set.id, CommandKind::Cast)
            },
        );
        Ok(set.id)
    }

    /// `return(expr)`: single `Op::Return`.
    pub fn return_(&mut self, fid: FunctionId, expr: &str) -> Result<CommandId, PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        if expr.trim().is_empty() {
            return Err(PackageError::InvalidCommand(
                "return expression must not be empty".to_string(),
            ));
        }
        let head_id = self.alloc_command_id();
        let head = Command {
            id: head_id,
            op: Op::Return {
                expr: expr.to_string(),
            },
            inputs: vec![],
            outputs: vec![],
            next: None,
        };
        self.append_raw(fid, head, None);
        self.meta_mut(fid)?.insert(
            head_id,
            CommandSummary {
                expr: Some(expr.to_string()),
                ..CommandSummary::blank(head_id, CommandKind::Return)
            },
        );
        Ok(head_id)
    }

    /// Add a raw command to a function without linking it into the main chain.
    ///
    /// Used for building `if` body commands that are only reachable through
    /// the parent `Op::If`. The caller is responsible for setting up the
    /// body command `next` pointers.
    pub fn add_raw_command(
        &mut self,
        fid: FunctionId,
        command: Command,
    ) -> Result<(), PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        let func = self.function_mut(fid)?;
        func.commands.push(command);
        Ok(())
    }

    /// Evaluate `expr` into a fresh `ValueId`, linked into the main chain.
    ///
    /// Hidden intermediate (no user meta): the intended producer for an
    /// [`Package::if_`] condition. Returns the output `ValueId`.
    pub fn eval_cond(&mut self, fid: FunctionId, expr: &str) -> Result<ValueId, PackageError> {
        let compute = self.build_cond(fid, expr)?;
        self.append_raw(fid, compute.clone(), None);
        Ok(compute.outputs[0])
    }

    /// Build the hidden `Op::Compute` for a condition expression without
    /// linking it into the function: callers own the splice position.
    fn build_cond(&mut self, fid: FunctionId, expr: &str) -> Result<Command, PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        if expr.trim().is_empty() {
            return Err(PackageError::InvalidCommand(
                "condition expression must not be empty".to_string(),
            ));
        }
        let vid = self.alloc_value_id();
        let head_id = self.alloc_command_id();
        Ok(Command {
            id: head_id,
            op: Op::Compute {
                expr: expr.to_string(),
            },
            inputs: vec![],
            outputs: vec![vid],
            next: None,
        })
    }

    /// `if(condition, then_body, else_body?)`: single `Op::If`.
    ///
    /// The condition is a `ValueId` that must produce a `Bool` at runtime
    /// (see [`Package::eval_cond`]).
    /// `then_body` and `else_body` are ordered lists of command IDs that
    /// form the branches. The body commands must already exist in the
    /// function (added via [`Package::add_raw_command`]).
    pub fn if_(
        &mut self,
        fid: FunctionId,
        condition: ValueId,
        then_body: Vec<CommandId>,
        else_body: Option<Vec<CommandId>>,
    ) -> Result<CommandId, PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        let head_id = self.alloc_command_id();
        let head = Command {
            id: head_id,
            op: Op::If {
                condition,
                then_body: then_body.clone(),
                else_body: else_body.clone(),
            },
            inputs: vec![],
            outputs: vec![],
            next: None,
        };
        self.append_raw(fid, head, None);
        self.meta_mut(fid)?.insert(
            head_id,
            CommandSummary {
                condition: Some(condition),
                then_body: if then_body.is_empty() {
                    None
                } else {
                    Some(then_body)
                },
                else_body: else_body.filter(|b| !b.is_empty()),
                ..CommandSummary::blank(head_id, CommandKind::If)
            },
        );
        Ok(head_id)
    }

    /// Append a freshly created command to the end of an `if` branch.
    ///
    /// The new command becomes the new head of the branch (its `next` is
    /// chained off the previous tail), and the `if`'s summary is refreshed
    /// so the UI keeps seeing the updated branch list. The `if`'s own
    /// `next` (the join after the whole `if`/`else`) is untouched.
    pub fn if_append(
        &mut self,
        fid: FunctionId,
        cmd_id: CommandId,
        side: IfSide,
        new_id: CommandId,
    ) -> Result<(), PackageError> {
        // Phase 1 (reads, raw-group aware): resolve the target branch,
        // its tail, and the incoming command's current linkage. All
        // validation happens here so a rejected append never half-mutates
        // the graph.
        //
        // A user command can occupy several raw nodes (print: Lit head ->
        // tail; cast: compute -> cast -> set) and both the branch walk and
        // the main chain cross those internal edges. The branch list must
        // carry every raw id (documented `stage_body` contract: the
        // executor checks membership), the moved group ends its chain at
        // its last raw node, and its chain successor is read from there.
        let (tail_id, old_next, incoming_group) = {
            let incoming_group = self.raw_group(fid, new_id)?;
            let incoming_tail = *incoming_group
                .last()
                .expect("raw_group always returns at least the head");
            let successor = self
                .functions
                .get(&fid)
                .ok_or(PackageError::UnknownFunction(fid))?
                .find_command(incoming_tail)
                .and_then(|c| c.next);
            let function = self
                .functions
                .get(&fid)
                .ok_or(PackageError::UnknownFunction(fid))?;
            let command = function
                .find_command(cmd_id)
                .ok_or(PackageError::UnknownCommand(cmd_id))?;
            let branch = match &command.op {
                Op::If { then_body, else_body, .. } => match side {
                    IfSide::Then => then_body.clone(),
                    IfSide::Else => else_body.clone().unwrap_or_default(),
                },
                _ => {
                    return Err(PackageError::InvalidCommand(
                        "expected an `if` command".to_string(),
                    ))
                }
            };
            if branch.contains(&new_id) {
                return Err(PackageError::InvalidCommand(
                    "command is already wired to this branch".to_string(),
                ));
            }
            if new_id == cmd_id {
                return Err(PackageError::InvalidCommand(
                    "an `if` cannot be wired into its own branch".to_string(),
                ));
            }
            let Some(incoming) = function.find_command(new_id) else {
                return Err(PackageError::UnknownCommand(new_id));
            };
            // Engine parity with `stage_group`: branches take plain
            // compute commands only.
            match incoming.op {
                Op::If { .. } | Op::Return { .. } => {
                    return Err(PackageError::InvalidCommand(
                        "if and return cannot join an `if` branch".to_string(),
                    ))
                }
                _ => {}
            }
            // The command may not sit in a branch of any other `if`.
            for other_cmd in &function.commands {
                if other_cmd.id == cmd_id {
                    continue;
                }
                if let Op::If { then_body, else_body, .. } = &other_cmd.op {
                    let in_else = else_body
                        .as_ref()
                        .map(|b| b.contains(&new_id))
                        .unwrap_or(false);
                    if then_body.contains(&new_id) || in_else {
                        return Err(PackageError::InvalidCommand(
                            "command is already wired to another branch".to_string(),
                        ));
                    }
                }
            }
            // Branch tail: the last listed id is already the branch's
            // last raw node (stage bodies and appends both list every
            // raw id), so it directly adopts `next = head`.
            (branch.last().copied(), successor, incoming_group)
        };

        // Phase 2 (mutate) in one borrow region. Order matters: the old
        // `next` was captured first, so bridging and rewriting cannot
        // read a clobbered value.
        let (branch_after, other_after) = {
            let function = self
                .functions
                .get_mut(&fid)
                .ok_or(PackageError::UnknownFunction(fid))?;
            // Detach the incoming command from wherever it currently
            // chains: every predecessor pointing at it adopts its old
            // `next`, so a move never tears a gap into the old chain.
            for prev in function.commands.iter_mut() {
                if prev.next == Some(new_id) {
                    prev.next = old_next;
                }
            }
            // The branch tail exits back to the join, so the appended
            // group must end the chain (`next = None`) — the executor's
            // body walk stops there and flow continues at `if`'s `next`.
            // Group-aware: the chain ends at the incoming group's last
            // raw node; internal edges (head -> tail, cast chain) keep
            // their `next`, or the member's later nodes would never run.
            let incoming_tail = *incoming_group
                .last()
                .expect("raw_group always returns at least the head");
            if let Some(entry) = function.find_command_mut(incoming_tail) {
                entry.next = None;
            }
            // Same-if cross-branch move: lift the command out of the
            // opposite branch list before appending to the target side.
            let command = function
                .find_command_mut(cmd_id)
                .ok_or(PackageError::UnknownCommand(cmd_id))?;
            let Op::If {
                then_body,
                else_body,
                ..
            } = &mut command.op
            else {
                return Err(PackageError::InvalidCommand(
                    "expected an `if` command".to_string(),
                ));
            };
            let (branch, other) = match side {
                IfSide::Then => {
                    let other_after = match else_body {
                        Some(list) => {
                            list.retain(|id| !incoming_group.contains(id));
                            list.clone()
                        }
                        None => Vec::new(),
                    };
                    (&mut *then_body, Some(other_after))
                }
                IfSide::Else => {
                    then_body.retain(|id| !incoming_group.contains(id));
                    let other_after = then_body.clone();
                    let list = else_body.get_or_insert_with(Vec::new);
                    (list, Some(other_after))
                }
            };
            // Membership lists every raw id of the member group (the
            // executor's body walk checks membership — documented
            // `stage_body` contract).
            branch.extend(incoming_group.iter().copied());
            (branch.clone(), other)
        };

        // Phase 3: chain the previous branch tail forward so the branch
        // execution order matches the list order (executor starts at
        // `body[0]` and walks `next`). Captured before Phase 2, so a
        // moved-in tail never surprises the bridge above.
        if let Some(t) = tail_id {
            let function = self
                .functions
                .get_mut(&fid)
                .ok_or(PackageError::UnknownFunction(fid))?;
            let tail_cmd = function
                .find_command_mut(t)
                .ok_or(PackageError::UnknownCommand(t))?;
            tail_cmd.next = Some(new_id);
        }

        // Phase 4: refresh the `if`'s summary in the meta map so the UI
        // sees the updated branch lists on the next `list_commands`.
        if let Some(meta) = self.meta.get_mut(&fid) {
            if let Some(summary) = meta.get_mut(&cmd_id) {
                let mut updated = summary.clone();
                let other_is_empty =
                    other_after.as_ref().map_or(true, |list| list.is_empty());
                match side {
                    IfSide::Then => {
                        updated.then_body = Some(branch_after);
                        updated.else_body = if other_is_empty {
                            None
                        } else {
                            other_after
                        };
                    }
                    IfSide::Else => {
                        updated.else_body = Some(branch_after);
                        updated.then_body = if other_is_empty {
                            None
                        } else {
                            other_after
                        };
                    }
                }
                *summary = updated;
            }
        }

        Ok(())
    }

    // ------------------------------------------------------------------
    // if-with-expression: frontend-friendly `if` creation.
    // ------------------------------------------------------------------

    /// The condition expression a staged `if` was built from.
    ///
    /// `eval_cond` wraps the user text in one hidden `Op::Compute` whose
    /// output is the `ValueId` the `Op::If` reads, so recovering the text
    /// means locating that compute. Re-parsed conditions accumulate
    /// orphaned computes (harmless, never executed — `list_commands`
    /// skips commands without meta).
    pub fn if_condition(
        &self,
        fid: FunctionId,
        cmd_id: CommandId,
    ) -> Result<String, PackageError> {
        let function = self
            .functions
            .get(&fid)
            .ok_or(PackageError::UnknownFunction(fid))?;
        let command = function
            .find_command(cmd_id)
            .ok_or(PackageError::UnknownCommand(cmd_id))?;
        let Op::If { condition, .. } = &command.op else {
            return Err(PackageError::InvalidCommand(
                "expected an `if` command".to_string(),
            ));
        };
        for candidate in &function.commands {
            if !candidate.outputs.contains(condition) {
                continue;
            }
            if let Op::Compute { expr } = &candidate.op {
                return Ok(expr.clone());
            }
        }
        Err(PackageError::InvalidCommand(
            "if condition expression not found".to_string(),
        ))
    }

    /// Replace an `if`'s condition expression in place.
    ///
    /// The branch bodies stay untouched (they hold raw command ids that
    /// a delete/recreate cannot preserve), so the inspector can edit the
    /// condition without destroying the block. The new expression is
    /// validated through [`Package::eval_cond`] before any mutation; a
    /// parse failure (including an empty string) leaves the block as is.
    pub fn if_set_condition(
        &mut self,
        fid: FunctionId,
        cmd_id: CommandId,
        expr: &str,
    ) -> Result<(), PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        {
            let function = self
                .functions
                .get(&fid)
                .ok_or(PackageError::UnknownFunction(fid))?;
            let command = function
                .find_command(cmd_id)
                .ok_or(PackageError::UnknownCommand(cmd_id))?;
            if !matches!(command.op, Op::If { .. }) {
                return Err(PackageError::InvalidCommand(
                    "expected an `if` command".to_string(),
                ));
            }
        }
        // Build the new condition compute without linking it, then splice
        // it directly in front of the `if` head: the `if` reads the
        // value at execution time, so the hidden compute must run just
        // before it (appending at the chain tail would place it *after*
        // the `if` and leave the read dangling). The old compute becomes
        // orphaned (`list_commands` never surfaces non-meta commands —
        // documented in `if_condition`).
        let compute = self.build_cond(fid, expr)?;
        let cond = compute.outputs[0];
        {
            let function = self.function_mut(fid)?;
            let compute_id = compute.id;
            function.commands.push(compute);
            // Hand the incoming edges off to the splice.
            let preds: Vec<CommandId> = function
                .commands
                .iter()
                .filter(|c| c.next == Some(cmd_id))
                .map(|c| c.id)
                .collect();
            for prev in preds {
                if let Some(p) = function.find_command_mut(prev) {
                    p.next = Some(compute_id);
                }
            }
            if function.entry == Some(cmd_id) {
                function.entry = Some(compute_id);
            }
            if let Some(c) = function.find_command_mut(compute_id) {
                c.next = Some(cmd_id);
            }
            // Point the `if` at the new value.
            if let Some(cmd) = function.find_command_mut(cmd_id) {
                match &mut cmd.op {
                    Op::If { condition, .. } => *condition = cond,
                    _ => {
                        return Err(PackageError::InvalidCommand(
                            "expected an `if` command".to_string(),
                        ))
                    }
                }
            }
        }
        if let Some(meta) = self.meta.get_mut(&fid) {
            if let Some(summary) = meta.get_mut(&cmd_id) {
                let mut updated = summary.clone();
                updated.condition = Some(cond);
                *summary = updated;
            }
        }
        Ok(())
    }

    /// Validate a user-level spec without mutating anything. All specs are
    /// validated before any staging so a bad spec never leaves the
    /// package half-built.
    fn validate_spec(spec: &CommandSpec) -> Result<(), PackageError> {
        match spec.kind {
            CommandKind::Declare => {
                let var = spec.var.as_deref().unwrap_or("");
                check_var_name(var).map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(ty) = spec.ty else {
                    return Err(PackageError::InvalidCommand(
                        "declare spec needs a type".to_string(),
                    ));
                };
                if ty == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot declare a variable of type void".to_string(),
                    ));
                }
                if let Some(text) = &spec.init {
                    parse_value(ty, text)
                        .map_err(|e| PackageError::InvalidCommand(e.to_string()))?;
                }
                // Access is accepted here for shape-compatibility with a
                // top-level `declare`, but a body variable is scoped to
                // the branch and never appears in `listCommands`, so
                // there is nothing for a wider visibility to mean yet.
                // Reject a non-default value rather than silently
                // dropping it (P22: fail explicitly).
                if let Some(access) = spec.access {
                    if access != Access::default() {
                        return Err(PackageError::InvalidCommand(format!(
                            "access '{}' is not supported on an if-body declare",
                            access.tag()
                        )));
                    }
                }
                Ok(())
            }
            CommandKind::Assign => {
                let var = spec.var.as_deref().unwrap_or("");
                check_var_name(var).map_err(|e| PackageError::InvalidName(e.to_string()))?;
                if spec
                    .expr
                    .as_deref()
                    .map(|e| e.trim().is_empty())
                    .unwrap_or(true)
                {
                    return Err(PackageError::InvalidCommand(
                        "assign expression must not be empty".to_string(),
                    ));
                }
                Ok(())
            }
            CommandKind::Print => Ok(()),
            CommandKind::Input => {
                let Some(ty) = spec.ty else {
                    return Err(PackageError::InvalidCommand(
                        "input spec needs a type".to_string(),
                    ));
                };
                if ty == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot read a value of type void".to_string(),
                    ));
                }
                Ok(())
            }
            CommandKind::Cast => {
                let var = spec.var.as_deref().unwrap_or("");
                check_var_name(var).map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(to) = spec.to else {
                    return Err(PackageError::InvalidCommand(
                        "cast spec needs a target type".to_string(),
                    ));
                };
                if to == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot cast to void".to_string(),
                    ));
                }
                if spec
                    .expr
                    .as_deref()
                    .map(|e| e.trim().is_empty())
                    .unwrap_or(true)
                {
                    return Err(PackageError::InvalidCommand(
                        "cast expression must not be empty".to_string(),
                    ));
                }
                Ok(())
            }
            CommandKind::Return | CommandKind::If => Err(PackageError::InvalidCommand(
                "return and if cannot be staged as if-body commands".to_string(),
            )),
        }
    }

    /// Expand one validated spec into raw commands, pushed into the
    /// function but NOT linked into the main chain. Returns
    /// `(head_id, all_ids)` where `all_ids` lists every raw command in
    /// the group (head first, then hidden pair tails) so the caller can
    /// build a body list the `Op::If` executor can walk.
    fn stage_group(
        &mut self,
        fid: FunctionId,
        spec: &CommandSpec,
    ) -> Result<(CommandId, Vec<CommandId>), PackageError> {
        match spec.kind {
            CommandKind::Declare => {
                let var = check_var_name(spec.var.as_deref().unwrap_or(""))
                    .map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(ty) = spec.ty else {
                    return Err(PackageError::InvalidCommand(
                        "declare spec needs a type".to_string(),
                    ));
                };
                if ty == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot declare a variable of type void".to_string(),
                    ));
                }
                let value = match &spec.init {
                    Some(text) => parse_value(ty, text)
                        .map_err(|e| PackageError::InvalidCommand(e.to_string()))?,
                    None => default_value(ty),
                };
                let (head, tail) = self.declare_group(fid, &var, ty, value)?;
                Ok((head.id, vec![head.id, tail.id]))
            }
            CommandKind::Assign => {
                let var = check_var_name(spec.var.as_deref().unwrap_or(""))
                    .map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(expr) = spec.expr.as_deref() else {
                    return Err(PackageError::InvalidCommand(
                        "assign spec needs an expression".to_string(),
                    ));
                };
                if expr.trim().is_empty() {
                    return Err(PackageError::InvalidCommand(
                        "assign expression must not be empty".to_string(),
                    ));
                }
                // Type comes from the visible declaration (declare/cast).
                let Some(ty) = self.declared_type(fid, &var) else {
                    return Err(PackageError::UndeclaredVariable(var));
                };
                let (head, tail) = self.assign_group(fid, &var, ty, expr)?;
                Ok((head.id, vec![head.id, tail.id]))
            }
            CommandKind::Print => {
                let Some(template) = spec.template.as_deref() else {
                    return Err(PackageError::InvalidCommand(
                        "print spec needs a template".to_string(),
                    ));
                };
                let (head, tail) = self.print_group(fid, template)?;
                Ok((head.id, vec![head.id, tail.id]))
            }
            CommandKind::Input => {
                let Some(ty) = spec.ty else {
                    return Err(PackageError::InvalidCommand(
                        "input spec needs a type".to_string(),
                    ));
                };
                if ty == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot read a value of type void".to_string(),
                    ));
                }
                let (head, _tail) = self.input_group(fid, ty)?;
                Ok((head.id, vec![head.id]))
            }
            CommandKind::Cast => {
                let var = check_var_name(spec.var.as_deref().unwrap_or(""))
                    .map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(to) = spec.to else {
                    return Err(PackageError::InvalidCommand(
                        "cast spec needs a target type".to_string(),
                    ));
                };
                if to == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot cast to void".to_string(),
                    ));
                }
                let Some(expr) = spec.expr.as_deref() else {
                    return Err(PackageError::InvalidCommand(
                        "cast spec needs an expression".to_string(),
                    ));
                };
                if expr.trim().is_empty() {
                    return Err(PackageError::InvalidCommand(
                        "cast expression must not be empty".to_string(),
                    ));
                }
                if self.declared_type(fid, &var).is_some() {
                    return Err(PackageError::DuplicateVariable(var));
                }
                let (compute, cast, set) = self.cast_group(fid, &var, to, expr)?;
                Ok((compute.id, vec![compute.id, cast.id, set.id]))
            }
            CommandKind::Return | CommandKind::If => Err(PackageError::InvalidCommand(
                "return and if cannot be staged as if-body commands".to_string(),
            )),
        }
    }

    /// Stage an ordered `if` body: expand each spec and link groups in
    /// order. The last group's tail stays open (`next = None`) so the
    /// executor's body walk stops at the body end. Returns ALL raw
    /// command ids (heads + hidden tails) in execution order — the
    /// `Op::If` executor walks `next` pointers and checks membership,
    /// so every command in the group must appear in the body list.
    fn stage_body(
        &mut self,
        fid: FunctionId,
        specs: &[CommandSpec],
    ) -> Result<Vec<CommandId>, PackageError> {
        let mut all_ids = Vec::new();
        let mut prev_tail: Option<CommandId> = None;
        for spec in specs {
            let (head, group_ids) = self.stage_group(fid, spec)?;
            if let Some(prev) = prev_tail {
                let func = self.function_mut(fid)?;
                if let Some(cmd) = func.commands.iter_mut().find(|c| c.id == prev) {
                    cmd.next = Some(head);
                }
            }
            prev_tail = group_ids.last().copied();
            all_ids.extend(group_ids);
        }
        Ok(all_ids)
    }

    /// Create an `Op::If` from a condition expression and ordered body
    /// specs — the frontend-friendly alternative to `eval_cond` + `if_`.
    ///
    /// The condition expression is evaluated into a hidden `ValueId`
    /// appended to the main chain; each body spec expands into the same
    /// raw commands the builders produce, linked in order. No raw ids or
    /// IR cross the boundary: the caller passes expressions and
    /// user-level specs only.
    pub fn if_with_expr(
        &mut self,
        fid: FunctionId,
        cond_expr: &str,
        then_specs: &[CommandSpec],
        else_specs: Option<&[CommandSpec]>,
    ) -> Result<CommandId, PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        if cond_expr.trim().is_empty() {
            return Err(PackageError::InvalidCommand(
                "condition expression must not be empty".to_string(),
            ));
        }
        // Validate everything first so a bad spec never leaves the
        // package half-built (no partial staging on error).
        for spec in then_specs {
            Self::validate_spec(spec)?;
        }
        if let Some(specs) = else_specs {
            for spec in specs {
                Self::validate_spec(spec)?;
            }
        }
        let then_body = self.stage_body(fid, then_specs)?;
        let else_body = match else_specs {
            Some(specs) => Some(self.stage_body(fid, specs)?),
            None => None,
        };
        let condition = self.eval_cond(fid, cond_expr)?;
        self.if_(fid, condition, then_body, else_body)
    }

    /// User kinds in execution order (reachable first), then orphans.
    pub fn list_commands(&self, fid: FunctionId) -> Result<Vec<CommandSummary>, PackageError> {
        let func = self
            .functions
            .get(&fid)
            .ok_or(PackageError::UnknownFunction(fid))?;
        let meta = self
            .meta
            .get(&fid)
            .ok_or(PackageError::UnknownFunction(fid))?;
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let mut current = func.entry;
        let mut guard = 0usize;
        while let Some(id) = current {
            if guard > func.commands.len() + meta.len() + 2 {
                break;
            }
            guard += 1;
            if !seen.insert(id) {
                break;
            }
            if let Some(summary) = meta.get(&id) {
                out.push(summary.clone());
            }
            let Some(cmd) = func.find_command(id) else {
                break;
            };
            // Skip the hidden pair tail: head -> pair -> user-next.
            // Pair tails are never in `meta`, so jumping one extra step
            // only when the immediate next is a hidden node keeps user
            // order stable without exposing raw ids.
            match cmd.next {
                None => break,
                Some(n) => {
                    if meta.contains_key(&id) && !meta.contains_key(&n) {
                        match func.find_command(n) {
                            Some(pair) => current = pair.next,
                            None => break,
                        }
                    } else {
                        current = Some(n);
                    }
                }
            }
        }
        // Orphans last, sorted for determinism.
        let mut orphans: Vec<&CommandSummary> =
            meta.values().filter(|s| !seen.contains(&s.id)).collect();
        orphans.sort_by_key(|s| s.id.0);
        out.extend(orphans.into_iter().cloned());
        // Fill user-level linkage from the live raw graph, so the editor
        // can reconstruct the chain from this list + `get_function.entry`.
        // Dangling edges (no known head) surface as `None`.
        for summary in out.iter_mut() {
            summary.next = self.user_next(fid, summary.id);
        }
        Ok(out)
    }

    /// All raw node ids of a user command, in execution order
    /// (`[head, ..., tail]`). Single-node kinds return `[head]`; pair and
    /// cast groups follow their internal `next` edges over every raw
    /// node that is not itself a user head. This is the membership list
    /// the executor expects for branch bodies (see `stage_body`).
    fn raw_group(&self, fid: FunctionId, head: CommandId) -> Result<Vec<CommandId>, PackageError> {
        let meta = self
            .meta
            .get(&fid)
            .ok_or(PackageError::UnknownFunction(fid))?;
        if !meta.contains_key(&head) {
            return Err(PackageError::UnknownCommand(head));
        }
        let func = self
            .functions
            .get(&fid)
            .ok_or(PackageError::UnknownFunction(fid))?;
        let mut ids = vec![head];
        let mut current = head;
        loop {
            let next = func
                .find_command(current)
                .ok_or(PackageError::UnknownCommand(current))?
                .next;
            match next {
                Some(n) if !meta.contains_key(&n) => {
                    ids.push(n);
                    current = n;
                }
                _ => {
                    break;
                }
            }
        }
        Ok(ids)
    }

    /// Following user edge of `head`: the raw pair tail's `next`, kept
    /// only when it points at a known user head.
    fn user_next(&self, fid: FunctionId, head: CommandId) -> Option<CommandId> {
        let tail = self.pair_tail(fid, head).ok()?;
        let next = self.functions.get(&fid)?.find_command(tail)?.next?;
        let meta = self.meta.get(&fid)?;
        meta.contains_key(&next).then_some(next)
    }

    fn pair_tail(&self, fid: FunctionId, head: CommandId) -> Result<CommandId, PackageError> {
        let meta = self
            .meta
            .get(&fid)
            .ok_or(PackageError::UnknownFunction(fid))?;
        let summary = meta.get(&head).ok_or(PackageError::UnknownCommand(head))?;
        match summary.kind {
            CommandKind::Return | CommandKind::If | CommandKind::Input | CommandKind::Cast => {
                Ok(head)
            }
            CommandKind::Declare | CommandKind::Assign | CommandKind::Print => {
                let func = self
                    .functions
                    .get(&fid)
                    .ok_or(PackageError::UnknownFunction(fid))?;
                let head_cmd = func
                    .find_command(head)
                    .ok_or(PackageError::UnknownCommand(head))?;
                head_cmd.next.ok_or(PackageError::UnknownCommand(head))
            }
        }
    }

    /// Set the entry to a user command head (or `None` to clear).
    pub fn set_entry(
        &mut self,
        fid: FunctionId,
        entry: Option<CommandId>,
    ) -> Result<(), PackageError> {
        if let Some(id) = entry {
            let meta = self
                .meta
                .get(&fid)
                .ok_or(PackageError::UnknownFunction(fid))?;
            if !meta.contains_key(&id) {
                return Err(PackageError::UnknownCommand(id));
            }
        }
        let func = self.function_mut(fid)?;
        func.entry = entry;
        Ok(())
    }

    /// Rewire `command -> next` at user level (both must be heads).
    pub fn set_next(
        &mut self,
        fid: FunctionId,
        command: CommandId,
        next: Option<CommandId>,
    ) -> Result<(), PackageError> {
        if let Some(n) = next {
            let meta = self
                .meta
                .get(&fid)
                .ok_or(PackageError::UnknownFunction(fid))?;
            if !meta.contains_key(&n) {
                return Err(PackageError::UnknownCommand(n));
            }
        }
        let tail = self.pair_tail(fid, command)?;
        let func = self.function_mut(fid)?;
        let tail_cmd = func
            .commands
            .iter_mut()
            .find(|c| c.id == tail)
            .ok_or(PackageError::UnknownCommand(tail))?;
        tail_cmd.next = next;
        Ok(())
    }

    /// Delete a user command (head + hidden pair) and repair the chain.
    pub fn delete_command(
        &mut self,
        fid: FunctionId,
        command: CommandId,
    ) -> Result<(), PackageError> {
        let tail = self.pair_tail(fid, command)?;
        let func = self
            .functions
            .get(&fid)
            .ok_or(PackageError::UnknownFunction(fid))?;
        // Successor = tail.next; predecessor = whoever points at head.
        let successor = func
            .find_command(tail)
            .ok_or(PackageError::UnknownCommand(tail))?
            .next;
        // Collect hidden commands that belong to a `Cast` group so they are
        // removed together with the user-visible head.
        let mut hidden: Vec<CommandId> = Vec::new();
        let is_cast = self
            .meta
            .get(&fid)
            .and_then(|m| m.get(&command))
            .map(|s| s.kind == CommandKind::Cast)
            .unwrap_or(false);
        if is_cast {
            // cast_id is the command whose `next` points at the user head.
            let cast_id = func
                .commands
                .iter()
                .find(|c| c.next == Some(command))
                .map(|c| c.id);
            if let Some(cid) = cast_id {
                hidden.push(cid);
                let compute_id = func
                    .commands
                    .iter()
                    .find(|c| c.next == Some(cid))
                    .map(|c| c.id);
                if let Some(xid) = compute_id {
                    hidden.push(xid);
                }
            }
        }
        // Repair every edge pointing at the deleted head (cycles/orphans
        // can leave several); the internal head->pair edge dies with the
        // group and needs no repair.
        let preds: Vec<CommandId> = func
            .commands
            .iter()
            .filter(|c| c.next == Some(command))
            .map(|c| c.id)
            .collect();
        let entry_points_at_head = func.entry == Some(command);
        let func = self.function_mut(fid)?;
        for prev in preds {
            if let Some(cmd) = func.commands.iter_mut().find(|c| c.id == prev) {
                cmd.next = successor;
            }
        }
        if entry_points_at_head {
            func.entry = successor;
        }
        let mut to_delete = vec![command];
        if tail != command {
            to_delete.push(tail);
        }
        to_delete.extend(hidden);
        func.commands.retain(|c| !to_delete.contains(&c.id));
        // Branch lists (then/else) of every surviving `if` drop the
        // deleted ids — the executor's body walk checks membership, so a
        // lingering reference would crash mid-branch. Hidden member ids
        // of the removed group are gone too (members list every raw id).
        for cmd in func.commands.iter_mut() {
            if let Op::If { then_body, else_body, .. } = &mut cmd.op {
                then_body.retain(|id| !to_delete.contains(id));
                if let Some(list) = else_body {
                    list.retain(|id| !to_delete.contains(id));
                }
            }
        }
        let if_snapshots: Vec<(CommandId, Vec<CommandId>, Option<Vec<CommandId>>)> = func
            .commands
            .iter()
            .filter_map(|c| { 
                match &c.op {
                    Op::If { then_body, else_body, .. } => {
                        Some((c.id, then_body.clone(), else_body.clone()))
                    }
                    _ => None,
                }
            })
            .collect();
        if let Some(meta) = self.meta.get_mut(&fid) {
            for (head, then_body, else_body) in if_snapshots {
                let Some(summary) = meta.get_mut(&head) else { continue };
                summary.then_body = if then_body.is_empty() {
                    None
                } else {
                    Some(then_body)
                };
                summary.else_body = else_body.filter(|b| !b.is_empty());
            }
            meta.remove(&command);
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Run (Phase 3): resolve `main`, execute via the existing path.
    // Phase 4 extends this with call-aware evaluation; the ID-only shape
    // stays the same.
    // ------------------------------------------------------------------

    /// Run `main` from its entry. Reuses the existing executor; `Return`
    /// stops the run (value discarded here, observed via calls in Phase 4).
    pub fn run_main(
        &self,
        sink: &mut impl PrintSink,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        self.run_main_with_limit(sink, crate::exec::MAX_STEPS)
    }

    /// Same as [`Package::run_main`] with an explicit step cap.
    pub fn run_main_with_limit(
        &self,
        sink: &mut impl PrintSink,
        max_steps: usize,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        let mut source = crate::sink::VecSource::default();
        crate::exec::run_program_with_limit(&self.as_program(), sink, &mut source, max_steps)
    }

    /// Same as [`Package::run_main`] but reads from the supplied input source.
    pub fn run_main_with_input(
        &self,
        sink: &mut impl PrintSink,
        input: &mut impl crate::sink::InputSource,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        self.run_main_with_input_with_limit(sink, input, crate::exec::MAX_STEPS)
    }

    /// Same as [`Package::run_main_with_limit`] but reads from the supplied input source.
    pub fn run_main_with_input_with_limit(
        &self,
        sink: &mut impl PrintSink,
        input: &mut impl crate::sink::InputSource,
        max_steps: usize,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        crate::exec::run_program_with_limit(&self.as_program(), sink, input, max_steps)
    }

    /// Run `main` reading successive lines from `lines`.
    pub fn run_main_with_input_lines(
        &self,
        sink: &mut impl PrintSink,
        lines: Vec<String>,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        let mut source = crate::sink::VecSource {
            lines,
            ..crate::sink::VecSource::default()
        };
        crate::exec::run_program_with_limit(
            &self.as_program(),
            sink,
            &mut source,
            crate::exec::MAX_STEPS,
        )
    }

    /// Same as [`Package::run_main`] but also captures `main`'s `Return`.
    pub fn run_main_returning(
        &self,
        sink: &mut impl PrintSink,
    ) -> Result<(crate::exec::ExecReport, Option<Value>), crate::error::ExecError> {
        let mut source = crate::sink::VecSource::default();
        crate::exec::run_program_returning_with_limit(
            &self.as_program(),
            sink,
            &mut source,
            crate::exec::MAX_STEPS,
        )
    }

    /// Snapshot the registry as a `Program` for the call-aware executor.
    pub fn as_program(&self) -> crate::ir::Program {
        let mut functions: Vec<Function> = self.functions.values().cloned().collect();
        functions.sort_by_key(|f| f.id.0);
        crate::ir::Program {
            version: 1,
            package: PACKAGE_NAME.to_string(),
            functions,
        }
    }
}

impl Default for Package {
    fn default() -> Self {
        Self::new()
    }
}
