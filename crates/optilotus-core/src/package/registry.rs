use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::ir::Function;
use crate::ir::{CommandId, FunctionId};
use crate::package::command_summary::CommandSummary;
use crate::session::Commit;

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
///
/// **Undo/Redo support**: This package tracks an undo/redo stack of commits.
/// Every data-affecting action automatically creates a commit and pushes it
/// onto the undo stack. `undo()` and `redo()` can be called to navigate the
/// history. Empty stacks result in silent no-ops (no errors).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Package {
    pub(crate) functions: HashMap<FunctionId, Function>,
    pub(crate) order: Vec<FunctionId>,
    pub(crate) meta: HashMap<FunctionId, HashMap<CommandId, CommandSummary>>,
    pub(crate) next_function_id: u32,
    pub(crate) next_command_id: u32,
    pub(crate) next_value_id: u32,

    /// Stack of commits for undo. Each commit captures enough information
    /// to reverse the corresponding action.
    pub(crate) undo_stack: Vec<Commit>,

    /// Stack of commits for redo. Populated when `undo()` is called;
    /// cleared when new actions are performed.
    pub(crate) redo_stack: Vec<Commit>,
}

impl Package {
    /// Create a new empty package with the main function pre-initialized.
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
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    /// Serialize the entire package to a JSON snapshot string.
    pub fn snapshot_json(&self) -> Result<String, serde_json::Error> {
        PackageSnapshot::new(self.clone()).to_json()
    }

    /// Restore a package from a JSON snapshot string.
    pub fn from_snapshot_json(json: &str) -> Result<Self, serde_json::Error> {
        PackageSnapshot::from_json(json).map(|snap| snap.package)
    }

    /// Undo the last action. Returns a short description of what was undone,
    /// or `None` if the undo stack was empty (silent no-op).
    pub fn undo(&mut self) -> Option<String> {
        if let Some(commit) = self.undo_stack.pop() {
            let desc = commit.description();
            commit.inverse_apply(self);
            self.redo_stack.push(commit);
            Some(desc)
        } else {
            None
        }
    }

    /// Redo the last undone action. Returns a short description of what was
    /// redone, or `None` if the redo stack was empty (silent no-op).
    pub fn redo(&mut self) -> Option<String> {
        if let Some(commit) = self.redo_stack.pop() {
            let desc = commit.description();
            commit.forward_apply(self);
            self.undo_stack.push(commit);
            Some(desc)
        } else {
            None
        }
    }

    /// Push a commit onto the undo stack, clearing the redo stack.
    pub fn record(&mut self, commit: Commit) {
        self.undo_stack.push(commit);
        self.redo_stack.clear();
    }
}

/// Versioned snapshot DTO for full-package restore (used by `PackageCleared`
/// history commits). The version field lets the format evolve without
/// breaking older snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageSnapshot {
    pub version: u32,
    pub package: Package,
}

impl PackageSnapshot {
    pub const CURRENT_VERSION: u32 = 1;

    pub fn new(package: Package) -> Self {
        Self {
            version: Self::CURRENT_VERSION,
            package,
        }
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}
