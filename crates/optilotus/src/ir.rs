use serde::{Deserialize, Serialize};

use crate::ops::Op;

/// Stable identity of a function. Names are display only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FunctionId(pub u32);

/// Stable identity of a command (control node).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CommandId(pub u32);

/// Stable identity of a data value edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ValueId(pub u32);

/// Authoritative program: versioned package of functions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Program {
    pub version: u32,
    pub package: String,
    pub functions: Vec<Function>,
}

/// A function is a bag of commands with an `entry` root.
///
/// List order is storage only; execution follows `entry` -> `next`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Function {
    pub id: FunctionId,
    pub name: String,
    pub entry: Option<CommandId>,
    pub commands: Vec<Command>,
}

impl Function {
    /// Look up a command by id. Returns `None` for dangling edges.
    pub fn find_command(&self, id: CommandId) -> Option<&Command> {
        self.commands.iter().find(|c| c.id == id)
    }
}

/// One control node: data in/out via `ValueId`, control out via `next`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Command {
    pub id: CommandId,
    pub op: Op,
    pub inputs: Vec<ValueId>,
    pub outputs: Vec<ValueId>,
    pub next: Option<CommandId>,
}
