use std::fmt;

use crate::ir::{CommandId, ValueId};

/// All Phase 1 execution failures. Carries the offending `CommandId`
/// wherever a command is responsible, so the editor can highlight it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecError {
    TypeMismatch {
        command: CommandId,
        detail: String,
    },
    Overflow {
        command: CommandId,
    },
    DivByZero {
        command: CommandId,
    },
    MissingValue {
        command: CommandId,
        value: ValueId,
    },
    Arity {
        command: CommandId,
        expected: String,
        found: usize,
    },
    UnknownCommand {
        command: CommandId,
    },
    LoopLimit {
        limit: usize,
    },
    UnknownVariable {
        command: CommandId,
        var: String,
    },
    ExprError {
        command: CommandId,
        detail: String,
    },
    UnknownFunction {
        command: CommandId,
        name: String,
    },
    MissingReturn {
        command: CommandId,
        function: String,
    },
}

impl fmt::Display for ExecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExecError::TypeMismatch { command, detail } => {
                write!(f, "type mismatch at {:?}: {detail}", command.0)
            }
            ExecError::Overflow { command } => {
                write!(f, "integer overflow at {:?}", command.0)
            }
            ExecError::DivByZero { command } => {
                write!(f, "division by zero at {:?}", command.0)
            }
            ExecError::MissingValue { command, value } => {
                write!(f, "missing value {:?} at {:?}", value.0, command.0)
            }
            ExecError::Arity {
                command,
                expected,
                found,
            } => {
                write!(
                    f,
                    "arity error at {:?}: expected {expected}, found {found}",
                    command.0
                )
            }
            ExecError::UnknownCommand { command } => {
                write!(f, "unknown command {:?}", command.0)
            }
            ExecError::LoopLimit { limit } => {
                write!(f, "step limit {limit} exceeded")
            }
            ExecError::UnknownVariable { command, var } => {
                write!(f, "unknown variable {var:?} at {:?}", command.0)
            }
            ExecError::ExprError { command, detail } => {
                write!(f, "expression error at {:?}: {detail}", command.0)
            }
            ExecError::UnknownFunction { command, name } => {
                write!(f, "unknown function {name:?} at {:?}", command.0)
            }
            ExecError::MissingReturn { command, function } => {
                write!(
                    f,
                    "function {function:?} returned no value at {:?}",
                    command.0
                )
            }
        }
    }
}

impl std::error::Error for ExecError {}
