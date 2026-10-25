//! Validation: pure checks for command specs and package state.
//!
//! Split into two layers:
//! - **Spec validation** (`validate_spec`): checks a `CommandSpec`'s shape
//!   without any package context. Pure and side-effect free.
//! - **Context validation** (`validate_function_exists`, `validate_var_declared`,
//!   etc.): checks against live `Package` state.
//!
//! This keeps validation logic in one place instead of being scattered
//! across builders, stage, functions, and branch modules.

use crate::expr::check_var_name;
use crate::ir::FunctionId;
use crate::package::access::Access;
use crate::package::error::PackageError;
use crate::package::kind::CommandKind;
use crate::package::registry::Package;
use crate::package::spec::CommandSpec;
use crate::types::Type;

/// Validate a `CommandSpec`'s shape without any package context.
///
/// Pure: catches malformed specs (bad variable names, unknown type tags,
/// void types, empty expressions, disallowed access modifiers on if-body
/// declares) but does not check whether functions or variables exist.
pub fn validate_spec(spec: &CommandSpec) -> Result<(), PackageError> {
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
                parse_type_tag_text(ty, text)?;
            }
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
        CommandKind::Return => Ok(()),
        CommandKind::If => Err(PackageError::InvalidCommand(
            "return and if cannot be staged as if-body commands".to_string(),
        )),
    }
}

/// Validate that a function id exists in the package.
pub fn validate_function_exists(
    pkg: &Package,
    fid: FunctionId,
) -> Result<(), PackageError> {
    if !pkg.functions.contains_key(&fid) {
        return Err(PackageError::UnknownFunction(fid));
    }
    Ok(())
}

/// Validate that a variable is declared in a function, returning its type.
pub fn validate_var_declared(
    pkg: &Package,
    fid: FunctionId,
    var: &str,
) -> Result<Type, PackageError> {
    pkg.declared_type(fid, var)
        .ok_or_else(|| PackageError::UndeclaredVariable(var.to_string()))
}

/// Validate that a variable is NOT already declared in a function.
pub fn validate_var_not_declared(
    pkg: &Package,
    fid: FunctionId,
    var: &str,
) -> Result<(), PackageError> {
    if pkg.declared_type(fid, var).is_some() {
        return Err(PackageError::DuplicateVariable(var.to_string()));
    }
    Ok(())
}

/// Validate a function name (non-empty, no special chars, not "main", no duplicates).
pub fn validate_function_name(
    pkg: &Package,
    raw: &str,
) -> Result<String, PackageError> {
    let name = raw.trim().to_string();
    if name.is_empty() {
        return Err(PackageError::InvalidName(
            "function name must not be empty".to_string(),
        ));
    }
    if name.chars().any(|c| c == '{' || c == '}' || c == '"') {
        return Err(PackageError::InvalidName(format!(
            "invalid function name {name:?}: must not contain '{{', '}}' or '\"'"
        )));
    }
    if name == crate::package::registry::MAIN_NAME {
        return Err(PackageError::ReservedName(name));
    }
    if pkg.functions.values().any(|f| f.name == name) {
        return Err(PackageError::DuplicateName(name));
    }
    Ok(name)
}

/// Validate a condition expression is non-empty.
pub fn validate_condition_expr(expr: &str) -> Result<(), PackageError> {
    if expr.trim().is_empty() {
        return Err(PackageError::InvalidCommand(
            "condition expression must not be empty".to_string(),
        ));
    }
    Ok(())
}

/// Parse a type tag, rejecting unknown tags.
pub fn parse_type_tag(ty_tag: &str) -> Result<Type, PackageError> {
    Type::parse_tag(ty_tag)
        .ok_or_else(|| PackageError::UnknownType(ty_tag.to_string()))
}

/// Validate that an init text parses to a value of the given type.
fn parse_type_tag_text(ty: Type, text: &str) -> Result<(), PackageError> {
    use crate::package::literal::parse_value;
    parse_value(ty, text)
        .map(|_| ())
        .map_err(|e| PackageError::InvalidCommand(e.to_string()))
}