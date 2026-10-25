use crate::ir::{Command, CommandId, FunctionId, ValueId};
use crate::ops::Op;
use crate::package::command_summary::CommandSummary;
use crate::package::error::PackageError;
use crate::package::if_side::IfSide;
use crate::package::kind::CommandKind;

use crate::package::registry::Package;

impl Package {
    pub fn eval_cond(&mut self, fid: FunctionId, expr: &str) -> Result<ValueId, PackageError> {
        let compute = self.build_cond(fid, expr)?;
        self.append_raw(fid, compute.clone(), None);
        Ok(compute.outputs[0])
    }

    /// Build the hidden `Op::Compute` for a condition expression without
    /// linking it into the function: callers own the splice position.
    pub(crate) fn build_cond(
        &mut self,
        fid: FunctionId,
        expr: &str,
    ) -> Result<Command, PackageError> {
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
                Op::If {
                    then_body,
                    else_body,
                    ..
                } => match side {
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
                if let Op::If {
                    then_body,
                    else_body,
                    ..
                } = &other_cmd.op
                {
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
                let other_is_empty = other_after.as_ref().is_none_or(|list| list.is_empty());
                match side {
                    IfSide::Then => {
                        updated.then_body = Some(branch_after);
                        updated.else_body = if other_is_empty { None } else { other_after };
                    }
                    IfSide::Else => {
                        updated.else_body = Some(branch_after);
                        updated.then_body = if other_is_empty { None } else { other_after };
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
    pub fn if_condition(&self, fid: FunctionId, cmd_id: CommandId) -> Result<String, PackageError> {
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
}
