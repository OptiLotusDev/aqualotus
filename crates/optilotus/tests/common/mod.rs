// Shared test helpers, compiled into each integration-test target.
// Helpers unused by a given target are expected, so `dead_code` is
// silenced module-wide rather than per item.
#![allow(dead_code)]

use std::collections::HashMap;

use optilotus::{
    eval_expr, Command, CommandId, ExprFail, Function, FunctionId, Op, Value, ValueId,
};

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

/// Variable environment for expression tests.
pub fn vars(pairs: Vec<(String, Value)>) -> HashMap<String, Value> {
    pairs.into_iter().collect()
}

/// Evaluate an expression with an empty environment.
pub fn eval(expr: &str) -> Result<Value, ExprFail> {
    eval_expr(expr, &HashMap::new())
}
