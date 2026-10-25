use std::collections::HashMap;

use crate::ir::{CommandId, Function, FunctionId, ValueId};
use crate::package::error::PackageError;
use crate::package::summary::{FunctionInfo, FunctionSummary};
use crate::types::Type;

use crate::package::kind::CommandKind;
use crate::package::registry::Package;
use crate::package::registry::{MAIN_ID, MAIN_NAME};
use crate::package::validation;

impl Package {
    fn validate_function_name(&self, raw: &str) -> Result<String, PackageError> {
        validation::validate_function_name(self, raw)
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

    pub(crate) fn function_mut(&mut self, id: FunctionId) -> Result<&mut Function, PackageError> {
        self.functions
            .get_mut(&id)
            .ok_or(PackageError::UnknownFunction(id))
    }

    pub(crate) fn declared_type(&self, fid: FunctionId, var: &str) -> Option<Type> {
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
}
