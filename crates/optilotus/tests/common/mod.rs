use optilotus::{Command, CommandId, Function, FunctionId, Op, ValueId};

/// Build a command from raw numeric ids.
pub fn cmd(id: u32, op: Op, inputs: Vec<u32>, outputs: Vec<u32>, next: Option<u32>) -> Command {
    Command {
        id: CommandId(id),
        op,
        inputs: inputs.into_iter().map(ValueId).collect(),
        outputs: outputs.into_iter().map(ValueId).collect(),
        next: next.map(CommandId),
    }
}

/// Build a test function with an optional entry point.
pub fn fun(entry: Option<u32>, commands: Vec<Command>) -> Function {
    Function {
        id: FunctionId(1),
        name: "test".to_string(),
        entry: entry.map(CommandId),
        commands,
    }
}
