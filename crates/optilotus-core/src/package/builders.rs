use crate::expr::check_var_name;
use crate::ir::{CommandId, FunctionId};
use crate::ops::Op;
use crate::package::command_summary::CommandSummary;
use crate::package::error::PackageError;
use crate::package::literal::{default_value, parse_value};
use crate::types::Type;
use crate::value::Value;

use crate::package::access::Access;
use crate::package::registry::Package;
use crate::package::validation;
use crate::session::Commit;

use crate::ir::Command;
use crate::package::kind::CommandKind;

impl Package {
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
        let ty = validation::parse_type_tag(ty_tag)?;
        if ty == Type::Void {
            return Err(PackageError::InvalidCommand(
                "cannot declare a variable of type void".to_string(),
            ));
        }
        validation::validate_function_exists(self, fid)?;
        validation::validate_var_not_declared(self, fid, &var)?;
        let old_entry = self.function(fid).and_then(|f| f.entry);
        let value = match init {
            Some(text) => {
                parse_value(ty, text).map_err(|e| PackageError::InvalidCommand(e.to_string()))?
            }
            None => default_value(ty),
        };
        let (head, tail) = self.declare_group(fid, &var, ty, value)?;
        self.link_chain(fid, head.id)?;
        let summary = CommandSummary {
            var: Some(var.clone()),
            ty: Some(ty),
            access: Some(access),
            expr: init.map(|s| s.to_string()),
            ..CommandSummary::blank(head.id, CommandKind::Declare)
        };
        self.meta_mut(fid)?.insert(head.id, summary.clone());
        self.record(Commit::CommandAdded {
            fid,
            head_id: head.id,
            kind: CommandKind::Declare,
            var: Some(var),
            commands: vec![head.clone(), tail],
            summary,
            old_entry,
        });
        Ok(head.id)
    }

    /// Build the raw `Compute` -> `Set` pair for an `assign` and push it
    /// into the function's command list (not yet linked). Returns
    /// `(head, tail)` commands.
    pub(crate) fn assign_group(
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
        validation::validate_function_exists(self, fid)?;
        let ty = validation::validate_var_declared(self, fid, &var)?;
        if expr.trim().is_empty() {
            return Err(PackageError::InvalidCommand(
                "assign expression must not be empty".to_string(),
            ));
        }
        let (head, tail) = self.assign_group(fid, &var, ty, expr)?;
        let old_entry = self.function(fid).and_then(|f| f.entry);
        self.link_chain(fid, head.id)?;
        let summary = CommandSummary {
            var: Some(var.clone()),
            ty: Some(ty),
            expr: Some(expr.to_string()),
            ..CommandSummary::blank(head.id, CommandKind::Assign)
        };
        self.meta_mut(fid)?.insert(head.id, summary.clone());
        self.record(Commit::CommandAdded {
            fid,
            head_id: head.id,
            kind: CommandKind::Assign,
            var: Some(var),
            commands: vec![head.clone(), tail],
            summary,
            old_entry,
        });
        Ok(head.id)
    }

    /// Build the raw `Lit` -> `Print` pair for a `print` and push it into
    /// the function's command list (not yet linked). Returns
    /// `(head, tail)` commands.
    pub(crate) fn print_group(
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
        validation::validate_function_exists(self, fid)?;
        let old_entry = self.function(fid).and_then(|f| f.entry);
        let (head, tail) = self.print_group(fid, template)?;
        self.link_chain(fid, head.id)?;
        let summary = CommandSummary {
            template: Some(template.to_string()),
            ..CommandSummary::blank(head.id, CommandKind::Print)
        };
        self.meta_mut(fid)?.insert(head.id, summary.clone());
        self.record(Commit::CommandAdded {
            fid,
            head_id: head.id,
            kind: CommandKind::Print,
            var: None,
            commands: vec![head.clone(), tail],
            summary,
            old_entry,
        });
        Ok(head.id)
    }

    /// Build the raw `Input` command for an `input` and push it into the
    /// function's command list (not yet linked). Returns the command as
    /// both head and tail (single-command group).
    pub(crate) fn input_group(
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
        validation::validate_function_exists(self, fid)?;
        let ty = validation::parse_type_tag(ty_tag)?;
        if ty == Type::Void {
            return Err(PackageError::InvalidCommand(
                "cannot read a value of type void".to_string(),
            ));
        }
        let old_entry = self.function(fid).and_then(|f| f.entry);
        let (head, tail) = self.input_group(fid, ty)?;
        self.link_chain(fid, head.id)?;
        let summary = CommandSummary {
            ty: Some(ty),
            ..CommandSummary::blank(head.id, CommandKind::Input)
        };
        self.meta_mut(fid)?.insert(head.id, summary.clone());
        self.record(Commit::CommandAdded {
            fid,
            head_id: head.id,
            kind: CommandKind::Input,
            var: None,
            commands: vec![head.clone(), tail],
            summary,
            old_entry,
        });
        Ok(head.id)
    }

    /// Build the raw `Compute` -> `Cast` -> `Set` triple for a `cast` and
    /// push it into the function's command list (not yet linked).
    /// Returns `(compute, cast, set)` commands; the user-facing head is
    /// the `set` command (matching `pair_tail`/`delete_command`).
    pub(crate) fn cast_group(
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
        let to = validation::parse_type_tag(to_tag)?;
        if to == Type::Void {
            return Err(PackageError::InvalidCommand(
                "cannot cast to void".to_string(),
            ));
        }
        validation::validate_function_exists(self, fid)?;
        validation::validate_var_not_declared(self, fid, &var)?;
        if expr.trim().is_empty() {
            return Err(PackageError::InvalidCommand(
                "cast expression must not be empty".to_string(),
            ));
        }
        let old_entry = self.function(fid).and_then(|f| f.entry);
        let (compute, cast_cmd, set) = self.cast_group(fid, &var, to, expr)?;
        self.link_chain(fid, compute.id)?;
        let summary = CommandSummary {
            var: Some(var.clone()),
            ty: Some(to),
            expr: Some(expr.to_string()),
            ..CommandSummary::blank(set.id, CommandKind::Cast)
        };
        self.meta_mut(fid)?.insert(set.id, summary.clone());
        self.record(Commit::CommandAdded {
            fid,
            head_id: set.id,
            kind: CommandKind::Cast,
            var: Some(var),
            commands: vec![compute.clone(), cast_cmd.clone(), set.clone()],
            summary,
            old_entry,
        });
        Ok(set.id)
    }

    /// `return(expr)`: single `Op::Return`.
    pub fn return_(&mut self, fid: FunctionId, expr: &str) -> Result<CommandId, PackageError> {
        validation::validate_function_exists(self, fid)?;
        if expr.trim().is_empty() {
            return Err(PackageError::InvalidCommand(
                "return expression must not be empty".to_string(),
            ));
        }
        let old_entry = self.function(fid).and_then(|f| f.entry);
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
        self.append_raw(fid, head.clone(), None);
        let summary = CommandSummary {
            expr: Some(expr.to_string()),
            ..CommandSummary::blank(head_id, CommandKind::Return)
        };
        self.meta_mut(fid)?.insert(head_id, summary.clone());
        self.record(Commit::CommandAdded {
            fid,
            head_id,
            kind: CommandKind::Return,
            var: None,
            commands: vec![head.clone()],
            summary,
            old_entry,
        });
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
        validation::validate_function_exists(self, fid)?;
        let old_entry = self.function(fid).and_then(|f| f.entry);
        let cmd_id = command.id;
        let func = self.function_mut(fid)?;
        func.commands.push(command.clone());
        let summary = CommandSummary::blank(cmd_id, CommandKind::Unknown); // placeholder
        self.record(Commit::CommandAdded {
            fid,
            head_id: cmd_id,
            kind: CommandKind::Unknown, // placeholder
            var: None,
            commands: vec![command.clone()],
            summary,
            old_entry,
        });
        Ok(())
    }
}
