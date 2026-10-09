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
#[serde(rename_all = "lowercase")]
pub enum CommandKind {
    Declare,
    Assign,
    Print,
    Return,
    If,
}

/// User-facing command row for `list_commands`.
/// `next` is the following user command head (`None` at the tail end or
/// when the edge was cleared); it is filled from the live raw graph on
/// every `list_commands` call, so rewires are always reflected. The
/// stored meta keeps `None` — the raw `next` edges are the source of truth.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandSummary {
    pub id: CommandId,
    pub kind: CommandKind,
    pub next: Option<CommandId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub var: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ty: Option<Type>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<ValueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub then_body: Option<Vec<CommandId>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub else_body: Option<Vec<CommandId>>,
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
                if s.kind == CommandKind::Declare && s.var.as_deref() == Some(var) {
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

    /// `declare(name, ty, init?)`: optional `Lit` -> `Set`.
    pub fn declare(
        &mut self,
        fid: FunctionId,
        name: &str,
        ty_tag: &str,
        init: Option<&str>,
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
                var: var.clone(),
                ty,
            },
            inputs: vec![vid],
            outputs: vec![],
            next: None,
        };
        self.append_raw(fid, head, Some(tail));
        self.meta_mut(fid)?.insert(
            head_id,
            CommandSummary {
                id: head_id,
                kind: CommandKind::Declare,
                next: None,
                var: Some(var),
                ty: Some(ty),
                expr: init.map(|s| s.to_string()),
                template: None,
                condition: None,
                then_body: None,
                else_body: None,
            },
        );
        Ok(head_id)
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
                var: var.clone(),
                ty,
            },
            inputs: vec![vid],
            outputs: vec![],
            next: None,
        };
        self.append_raw(fid, head, Some(tail));
        self.meta_mut(fid)?.insert(
            head_id,
            CommandSummary {
                id: head_id,
                kind: CommandKind::Assign,
                next: None,
                var: Some(var),
                ty: Some(ty),
                expr: Some(expr.to_string()),
                template: None,
                condition: None,
                then_body: None,
                else_body: None,
            },
        );
        Ok(head_id)
    }

    /// `print(template)`: `Lit(template)` -> `Print`.
    pub fn print(&mut self, fid: FunctionId, template: &str) -> Result<CommandId, PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
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
        self.append_raw(fid, head, Some(tail));
        self.meta_mut(fid)?.insert(
            head_id,
            CommandSummary {
                id: head_id,
                kind: CommandKind::Print,
                next: None,
                var: None,
                ty: None,
                expr: None,
                template: Some(template.to_string()),
                condition: None,
                then_body: None,
                else_body: None,
            },
        );
        Ok(head_id)
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
                id: head_id,
                kind: CommandKind::Return,
                next: None,
                var: None,
                ty: None,
                expr: Some(expr.to_string()),
                template: None,
                condition: None,
                then_body: None,
                else_body: None,
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
        let head = Command {
            id: head_id,
            op: Op::Compute {
                expr: expr.to_string(),
            },
            inputs: vec![],
            outputs: vec![vid],
            next: None,
        };
        self.append_raw(fid, head, None);
        Ok(vid)
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
                id: head_id,
                kind: CommandKind::If,
                next: None,
                var: None,
                ty: None,
                expr: None,
                template: None,
                condition: Some(condition),
                then_body: if then_body.is_empty() {
                    None
                } else {
                    Some(then_body)
                },
                else_body: else_body.filter(|b| !b.is_empty()),
            },
        );
        Ok(head_id)
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
            CommandKind::Return | CommandKind::If => Ok(head),
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
        if tail == command {
            func.commands.retain(|c| c.id != command);
        } else {
            func.commands.retain(|c| c.id != command && c.id != tail);
        }
        if let Some(m) = self.meta.get_mut(&fid) {
            m.remove(&command);
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
        crate::exec::run_program_with_limit(&self.as_program(), sink, max_steps)
    }

    /// Same as [`Package::run_main`] but also captures `main`'s `Return`.
    pub fn run_main_returning(
        &self,
        sink: &mut impl PrintSink,
    ) -> Result<(crate::exec::ExecReport, Option<Value>), crate::error::ExecError> {
        crate::exec::run_program_returning_with_limit(
            &self.as_program(),
            sink,
            crate::exec::MAX_STEPS,
        )
    }

    /// Snapshot the registry as a `Program` for the call-aware executor.
    fn as_program(&self) -> crate::ir::Program {
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
