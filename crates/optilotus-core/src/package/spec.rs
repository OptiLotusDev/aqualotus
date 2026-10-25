use serde::Deserialize;

use crate::package::access::Access;
use crate::package::kind::CommandKind;
use crate::types::Type;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct CommandSpec {
    pub kind: CommandKind,
    pub var: Option<String>,
    pub ty: Option<Type>,
    /// `declare` only: the variable's visibility (defaults to `private`).
    #[serde(default)]
    pub access: Option<Access>,
    #[serde(default)]
    pub init: Option<String>,
    pub expr: Option<String>,
    pub template: Option<String>,
    pub to: Option<Type>,
}

impl CommandSpec {
    /// Convenience constructors (used by tests and the TS bridge).
    pub fn declare(var: &str, ty: Type, init: Option<String>) -> Self {
        Self {
            kind: CommandKind::Declare,
            var: Some(var.to_string()),
            ty: Some(ty),
            access: None,
            init,
            expr: None,
            template: None,
            to: None,
        }
    }
    pub fn assign(var: &str, expr: &str) -> Self {
        Self {
            kind: CommandKind::Assign,
            var: Some(var.to_string()),
            ty: None,
            access: None,
            init: None,
            expr: Some(expr.to_string()),
            template: None,
            to: None,
        }
    }
    pub fn print(template: &str) -> Self {
        Self {
            kind: CommandKind::Print,
            var: None,
            ty: None,
            access: None,
            init: None,
            expr: None,
            template: Some(template.to_string()),
            to: None,
        }
    }
    pub fn input(ty: Type) -> Self {
        Self {
            kind: CommandKind::Input,
            var: None,
            access: None,
            ty: Some(ty),
            init: None,
            expr: None,
            template: None,
            to: None,
        }
    }
    pub fn cast(var: &str, to: Type, expr: &str) -> Self {
        Self {
            kind: CommandKind::Cast,
            var: Some(var.to_string()),
            ty: None,
            access: None,
            init: None,
            expr: Some(expr.to_string()),
            template: None,
            to: Some(to),
        }
    }
}
