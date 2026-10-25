use std::collections::HashSet;

use crate::ir::{CommandId, FunctionId};
use crate::package::command_summary::CommandSummary;
use crate::package::error::PackageError;
use crate::package::kind::CommandKind;

use crate::package::registry::Package;

impl Package {
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
    pub(crate) fn raw_group(
        &self,
        fid: FunctionId,
        head: CommandId,
    ) -> Result<Vec<CommandId>, PackageError> {
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
    pub(crate) fn user_next(&self, fid: FunctionId, head: CommandId) -> Option<CommandId> {
        let tail = self.pair_tail(fid, head).ok()?;
        let next = self.functions.get(&fid)?.find_command(tail)?.next?;
        let meta = self.meta.get(&fid)?;
        meta.contains_key(&next).then_some(next)
    }

    pub(crate) fn pair_tail(
        &self,
        fid: FunctionId,
        head: CommandId,
    ) -> Result<CommandId, PackageError> {
        let meta = self
            .meta
            .get(&fid)
            .ok_or(PackageError::UnknownFunction(fid))?;
        let summary = meta.get(&head).ok_or(PackageError::UnknownCommand(head))?;
        match summary.kind {
            CommandKind::Return
            | CommandKind::If
            | CommandKind::Input
            | CommandKind::Cast
            | CommandKind::Unknown => Ok(head),
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
}
