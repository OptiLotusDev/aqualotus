use serde::{Deserialize, Serialize};

use crate::package::kind::CommandKind;
use crate::package::command_summary::CommandSummary;
use crate::ir::{Command, Function, FunctionId, CommandId};
use crate::package::registry::{Package, PackageSnapshot};

/***
 * One history commit — the material needed to undo and redo a single
 * user-level action. Commits stay small: ids + a few optional strings for
 * adds. Full payload is stored only for destructive ops (`delete_*`,
 * `clear_package`).
 *
 * **Note**: This type implements `Clone`, `Serialize`, `Deserialize`
 * so it can be stored in the package's undo/redo stacks.
 ***/
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Commit {
    CommandAdded {
        fid: FunctionId,
        head_id: CommandId,
        kind: CommandKind,
        var: Option<String>,
        commands: Vec<Command>,
        summary: CommandSummary,
        old_entry: Option<CommandId>,
    },

    FunctionCreated {
        fid: FunctionId,
        name: String,
        function: Function,
        meta: Vec<(CommandId, CommandSummary)>,
        order: Vec<FunctionId>,
        next_function_id: u32,
    },

    FunctionRenamed {
        fid: FunctionId,
        old_name: String,
        new_name: String,
    },

    EntryChanged {
        fid: FunctionId,
        old_entry: Option<CommandId>,
        new_entry: Option<CommandId>,
    },

    FunctionDeleted {
        fid: FunctionId,
        function: Function,
        meta: Vec<(CommandId, CommandSummary)>,
        next_function_id: u32,
        next_command_id: u32,
        next_value_id: u32,
    },

    PackageCleared {
        snapshot: PackageSnapshot,
    },
}

impl Commit {
    /// Returns a short human-readable description of this commit.
    pub fn description(&self) -> String {
        match self {
            Commit::CommandAdded { kind, var, .. } => {
                let kind_str = format!("{:?}", kind);
                match var {
                    Some(v) => format!("{} {}", kind_str, v),
                    None => kind_str,
                }
            }
            Commit::FunctionCreated { name, .. } => format!("create function {}", name),
            Commit::FunctionRenamed { old_name, new_name, .. } => {
                format!("rename {} to {}", old_name, new_name)
            }
            Commit::EntryChanged { .. } => "change entry".to_string(),
            Commit::FunctionDeleted { .. } => "delete function".to_string(),
            Commit::PackageCleared { .. } => "clear package".to_string(),
        }
    }
    /// Apply forward (redo direction).
    pub fn forward_apply(&self, pkg: &mut Package) {
        match self {
            Commit::CommandAdded { fid, head_id, commands, summary, .. } => {
                // Re-add commands
                if let Some(func) = pkg.functions.get_mut(fid) {
                    for cmd in commands {
                        func.commands.push(cmd.clone());
                    }
                }
                // Re-link
                let _ = pkg.link_chain(*fid, *head_id);
                // Re-insert meta
                if let Some(meta) = pkg.meta.get_mut(fid) {
                    meta.insert(*head_id, summary.clone());
                }
            }
            Commit::PackageCleared { snapshot } => {
                // Restore from snapshot
                *pkg = snapshot.package.clone();
            }
            // Other variants: no-op for now (TODO)
            _ => {}
        }
    }

    /// Apply the inverse of this commit (undo direction).
    pub fn inverse_apply(&self, pkg: &mut Package) {
        match self {
            Commit::CommandAdded { fid, head_id, commands, old_entry, .. } => {
                // Remove added commands
                if let Some(func) = pkg.functions.get_mut(fid) {
                    // Clear next pointers that pointed to removed commands
                    let removed_ids: std::collections::HashSet<_> = commands.iter().map(|c| c.id).collect();
                    for cmd in func.commands.iter_mut() {
                        if let Some(next) = cmd.next {
                            if removed_ids.contains(&next) {
                                cmd.next = None;
                            }
                        }
                    }
                    for cmd in commands {
                        func.commands.retain(|c| c.id != cmd.id);
                    }
                    func.entry = *old_entry;
                }
                // Remove meta
                if let Some(meta) = pkg.meta.get_mut(fid) {
                    meta.remove(head_id);
                }
            }
            Commit::PackageCleared { snapshot } => {
                // Restore from snapshot (same as forward for clear)
                *pkg = snapshot.package.clone();
            }
            // Other variants: no-op for now (TODO)
            _ => {}
        }
    }
}
