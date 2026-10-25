use crate::ir::{CommandId, FunctionId};
use crate::ops::Op;
use crate::package::error::PackageError;
use crate::package::kind::CommandKind;

use crate::package::registry::Package;

impl Package {
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
            if let Op::If {
                then_body,
                else_body,
                ..
            } = &mut cmd.op
            {
                then_body.retain(|id| !to_delete.contains(id));
                if let Some(list) = else_body {
                    list.retain(|id| !to_delete.contains(id));
                }
            }
        }
        let if_snapshots: Vec<(CommandId, Vec<CommandId>, Option<Vec<CommandId>>)> = func
            .commands
            .iter()
            .filter_map(|c| match &c.op {
                Op::If {
                    then_body,
                    else_body,
                    ..
                } => Some((c.id, then_body.clone(), else_body.clone())),
                _ => None,
            })
            .collect();
        if let Some(meta) = self.meta.get_mut(&fid) {
            for (head, then_body, else_body) in if_snapshots {
                let Some(summary) = meta.get_mut(&head) else {
                    continue;
                };
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
}
