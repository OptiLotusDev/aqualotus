use std::collections::HashMap;

use crate::ir::Function;
use crate::ir::{CommandId, FunctionId};
use crate::package::command_summary::CommandSummary;

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
    pub(crate) functions: HashMap<FunctionId, Function>,
    pub(crate) order: Vec<FunctionId>,
    pub(crate) meta: HashMap<FunctionId, HashMap<CommandId, CommandSummary>>,
    pub(crate) next_function_id: u32,
    pub(crate) next_command_id: u32,
    pub(crate) next_value_id: u32,
}
