use crate::expr::check_var_name;
use crate::ir::{CommandId, FunctionId};
use crate::package::error::PackageError;
use crate::package::literal::{default_value, parse_value};
use crate::package::spec::CommandSpec;
use crate::types::Type;

use crate::package::access::Access;
use crate::package::kind::CommandKind;
use crate::package::registry::Package;

impl Package {
    fn validate_spec(spec: &CommandSpec) -> Result<(), PackageError> {
        match spec.kind {
            CommandKind::Declare => {
                let var = spec.var.as_deref().unwrap_or("");
                check_var_name(var).map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(ty) = spec.ty else {
                    return Err(PackageError::InvalidCommand(
                        "declare spec needs a type".to_string(),
                    ));
                };
                if ty == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot declare a variable of type void".to_string(),
                    ));
                }
                if let Some(text) = &spec.init {
                    parse_value(ty, text)
                        .map_err(|e| PackageError::InvalidCommand(e.to_string()))?;
                }
                // Access is accepted here for shape-compatibility with a
                // top-level `declare`, but a body variable is scoped to
                // the branch and never appears in `listCommands`, so
                // there is nothing for a wider visibility to mean yet.
                // Reject a non-default value rather than silently
                // dropping it (P22: fail explicitly).
                if let Some(access) = spec.access {
                    if access != Access::default() {
                        return Err(PackageError::InvalidCommand(format!(
                            "access '{}' is not supported on an if-body declare",
                            access.tag()
                        )));
                    }
                }
                Ok(())
            }
            CommandKind::Assign => {
                let var = spec.var.as_deref().unwrap_or("");
                check_var_name(var).map_err(|e| PackageError::InvalidName(e.to_string()))?;
                if spec
                    .expr
                    .as_deref()
                    .map(|e| e.trim().is_empty())
                    .unwrap_or(true)
                {
                    return Err(PackageError::InvalidCommand(
                        "assign expression must not be empty".to_string(),
                    ));
                }
                Ok(())
            }
            CommandKind::Print => Ok(()),
            CommandKind::Input => {
                let Some(ty) = spec.ty else {
                    return Err(PackageError::InvalidCommand(
                        "input spec needs a type".to_string(),
                    ));
                };
                if ty == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot read a value of type void".to_string(),
                    ));
                }
                Ok(())
            }
            CommandKind::Cast => {
                let var = spec.var.as_deref().unwrap_or("");
                check_var_name(var).map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(to) = spec.to else {
                    return Err(PackageError::InvalidCommand(
                        "cast spec needs a target type".to_string(),
                    ));
                };
                if to == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot cast to void".to_string(),
                    ));
                }
                if spec
                    .expr
                    .as_deref()
                    .map(|e| e.trim().is_empty())
                    .unwrap_or(true)
                {
                    return Err(PackageError::InvalidCommand(
                        "cast expression must not be empty".to_string(),
                    ));
                }
                Ok(())
            }
            CommandKind::Return | CommandKind::If => Err(PackageError::InvalidCommand(
                "return and if cannot be staged as if-body commands".to_string(),
            )),
        }
    }

    /// Expand one validated spec into raw commands, pushed into the
    /// function but NOT linked into the main chain. Returns
    /// `(head_id, all_ids)` where `all_ids` lists every raw command in
    /// the group (head first, then hidden pair tails) so the caller can
    /// build a body list the `Op::If` executor can walk.
    fn stage_group(
        &mut self,
        fid: FunctionId,
        spec: &CommandSpec,
    ) -> Result<(CommandId, Vec<CommandId>), PackageError> {
        match spec.kind {
            CommandKind::Declare => {
                let var = check_var_name(spec.var.as_deref().unwrap_or(""))
                    .map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(ty) = spec.ty else {
                    return Err(PackageError::InvalidCommand(
                        "declare spec needs a type".to_string(),
                    ));
                };
                if ty == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot declare a variable of type void".to_string(),
                    ));
                }
                let value = match &spec.init {
                    Some(text) => parse_value(ty, text)
                        .map_err(|e| PackageError::InvalidCommand(e.to_string()))?,
                    None => default_value(ty),
                };
                let (head, tail) = self.declare_group(fid, &var, ty, value)?;
                Ok((head.id, vec![head.id, tail.id]))
            }
            CommandKind::Assign => {
                let var = check_var_name(spec.var.as_deref().unwrap_or(""))
                    .map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(expr) = spec.expr.as_deref() else {
                    return Err(PackageError::InvalidCommand(
                        "assign spec needs an expression".to_string(),
                    ));
                };
                if expr.trim().is_empty() {
                    return Err(PackageError::InvalidCommand(
                        "assign expression must not be empty".to_string(),
                    ));
                }
                // Type comes from the visible declaration (declare/cast).
                let Some(ty) = self.declared_type(fid, &var) else {
                    return Err(PackageError::UndeclaredVariable(var));
                };
                let (head, tail) = self.assign_group(fid, &var, ty, expr)?;
                Ok((head.id, vec![head.id, tail.id]))
            }
            CommandKind::Print => {
                let Some(template) = spec.template.as_deref() else {
                    return Err(PackageError::InvalidCommand(
                        "print spec needs a template".to_string(),
                    ));
                };
                let (head, tail) = self.print_group(fid, template)?;
                Ok((head.id, vec![head.id, tail.id]))
            }
            CommandKind::Input => {
                let Some(ty) = spec.ty else {
                    return Err(PackageError::InvalidCommand(
                        "input spec needs a type".to_string(),
                    ));
                };
                if ty == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot read a value of type void".to_string(),
                    ));
                }
                let (head, _tail) = self.input_group(fid, ty)?;
                Ok((head.id, vec![head.id]))
            }
            CommandKind::Cast => {
                let var = check_var_name(spec.var.as_deref().unwrap_or(""))
                    .map_err(|e| PackageError::InvalidName(e.to_string()))?;
                let Some(to) = spec.to else {
                    return Err(PackageError::InvalidCommand(
                        "cast spec needs a target type".to_string(),
                    ));
                };
                if to == Type::Void {
                    return Err(PackageError::InvalidCommand(
                        "cannot cast to void".to_string(),
                    ));
                }
                let Some(expr) = spec.expr.as_deref() else {
                    return Err(PackageError::InvalidCommand(
                        "cast spec needs an expression".to_string(),
                    ));
                };
                if expr.trim().is_empty() {
                    return Err(PackageError::InvalidCommand(
                        "cast expression must not be empty".to_string(),
                    ));
                }
                if self.declared_type(fid, &var).is_some() {
                    return Err(PackageError::DuplicateVariable(var));
                }
                let (compute, cast, set) = self.cast_group(fid, &var, to, expr)?;
                Ok((compute.id, vec![compute.id, cast.id, set.id]))
            }
            CommandKind::Return | CommandKind::If => Err(PackageError::InvalidCommand(
                "return and if cannot be staged as if-body commands".to_string(),
            )),
        }
    }

    /// Stage an ordered `if` body: expand each spec and link groups in
    /// order. The last group's tail stays open (`next = None`) so the
    /// executor's body walk stops at the body end. Returns ALL raw
    /// command ids (heads + hidden tails) in execution order — the
    /// `Op::If` executor walks `next` pointers and checks membership,
    /// so every command in the group must appear in the body list.
    fn stage_body(
        &mut self,
        fid: FunctionId,
        specs: &[CommandSpec],
    ) -> Result<Vec<CommandId>, PackageError> {
        let mut all_ids = Vec::new();
        let mut prev_tail: Option<CommandId> = None;
        for spec in specs {
            let (head, group_ids) = self.stage_group(fid, spec)?;
            if let Some(prev) = prev_tail {
                let func = self.function_mut(fid)?;
                if let Some(cmd) = func.commands.iter_mut().find(|c| c.id == prev) {
                    cmd.next = Some(head);
                }
            }
            prev_tail = group_ids.last().copied();
            all_ids.extend(group_ids);
        }
        Ok(all_ids)
    }

    /// Create an `Op::If` from a condition expression and ordered body
    /// specs — the frontend-friendly alternative to `eval_cond` + `if_`.
    ///
    /// The condition expression is evaluated into a hidden `ValueId`
    /// appended to the main chain; each body spec expands into the same
    /// raw commands the builders produce, linked in order. No raw ids or
    /// IR cross the boundary: the caller passes expressions and
    /// user-level specs only.
    pub fn if_with_expr(
        &mut self,
        fid: FunctionId,
        cond_expr: &str,
        then_specs: &[CommandSpec],
        else_specs: Option<&[CommandSpec]>,
    ) -> Result<CommandId, PackageError> {
        if !self.functions.contains_key(&fid) {
            return Err(PackageError::UnknownFunction(fid));
        }
        if cond_expr.trim().is_empty() {
            return Err(PackageError::InvalidCommand(
                "condition expression must not be empty".to_string(),
            ));
        }
        // Validate everything first so a bad spec never leaves the
        // package half-built (no partial staging on error).
        for spec in then_specs {
            Self::validate_spec(spec)?;
        }
        if let Some(specs) = else_specs {
            for spec in specs {
                Self::validate_spec(spec)?;
            }
        }
        let then_body = self.stage_body(fid, then_specs)?;
        let else_body = match else_specs {
            Some(specs) => Some(self.stage_body(fid, specs)?),
            None => None,
        };
        let condition = self.eval_cond(fid, cond_expr)?;
        self.if_(fid, condition, then_body, else_body)
    }
}
