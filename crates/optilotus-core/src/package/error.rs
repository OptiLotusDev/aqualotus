use crate::ir::{CommandId, FunctionId};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageError {
    ReservedName(String),
    DuplicateName(String),
    UnknownFunction(FunctionId),
    MainProtected,
    InvalidName(String),
    UnknownCommand(CommandId),
    UnknownType(String),
    UndeclaredVariable(String),
    DuplicateVariable(String),
    InvalidCommand(String),
}

impl fmt::Display for PackageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PackageError::ReservedName(name) => {
                write!(f, "cannot create function {name:?}: \"main\" is reserved")
            }
            PackageError::DuplicateName(name) => {
                write!(f, "function {name:?} already exists")
            }
            PackageError::UnknownFunction(id) => {
                write!(f, "unknown function {:?}", id.0)
            }
            PackageError::MainProtected => {
                write!(f, "cannot delete entry function \"main\"")
            }
            PackageError::InvalidName(detail) => write!(f, "{detail}"),
            PackageError::UnknownCommand(id) => {
                write!(f, "unknown command {:?}", id.0)
            }
            PackageError::UnknownType(tag) => {
                write!(
                    f,
                    "unknown type {tag:?}: use a lowercase tag like \"int32\" or \"string\""
                )
            }
            PackageError::UndeclaredVariable(var) => {
                write!(
                    f,
                    "cannot assign undeclared variable {var:?}: declare it first"
                )
            }
            PackageError::DuplicateVariable(var) => {
                write!(f, "variable {var:?} is already declared")
            }
            PackageError::InvalidCommand(detail) => write!(f, "{detail}"),
        }
    }
}

impl std::error::Error for PackageError {}
