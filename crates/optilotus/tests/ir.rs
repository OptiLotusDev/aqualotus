use optilotus::{Command, CommandId, Function, FunctionId, Op, Value, ValueId};

#[test]
fn entry_lookup_finds_nodes_and_misses_dangling() {
    let fun = Function {
        id: FunctionId(1),
        name: "main".to_string(),
        entry: Some(CommandId(7)),
        commands: vec![Command {
            id: CommandId(7),
            op: Op::Lit(Value::Int32(1)),
            inputs: vec![],
            outputs: vec![],
            next: None,
        }],
    };
    assert!(fun.find_command(CommandId(7)).is_some());
    assert!(fun.find_command(CommandId(99)).is_none());
}

#[test]
fn list_order_is_storage_only() {
    let a = Command {
        id: CommandId(1),
        op: Op::Print,
        inputs: vec![ValueId(0)],
        outputs: vec![],
        next: Some(CommandId(2)),
    };
    let b = Command {
        id: CommandId(2),
        op: Op::Print,
        inputs: vec![ValueId(0)],
        outputs: vec![],
        next: None,
    };
    // Stored reversed; lookup still works because identity is by id.
    let fun = Function {
        id: FunctionId(1),
        name: "f".to_string(),
        entry: Some(CommandId(1)),
        commands: vec![b, a],
    };
    assert_eq!(
        fun.find_command(CommandId(1)).unwrap().next,
        Some(CommandId(2))
    );
}
