use std::collections::HashMap;

use crate::ir::{Command, CommandId, Function, FunctionId};
use crate::package::error::PackageError;

use crate::ops::Op;
use crate::package::command_summary::CommandSummary;
use crate::package::registry::Package;
use crate::types::Type;
use crate::value::Value;
use std::collections::HashSet;

impl Package {
    pub(crate) fn tail_of(func: &Function) -> Option<CommandId> {
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
    pub(crate) fn append_raw(&mut self, fid: FunctionId, head: Command, tail: Option<Command>) {
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

    pub(crate) fn meta_mut(
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
    pub(crate) fn declare_group(
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
    pub(crate) fn link_chain(
        &mut self,
        fid: FunctionId,
        head_id: CommandId,
    ) -> Result<(), PackageError> {
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
}
