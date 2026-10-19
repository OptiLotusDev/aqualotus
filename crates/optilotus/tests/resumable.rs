mod common;
use common::cmd;
use optilotus::{
    run_resumable, Command, CommandId, Function, FunctionId, Op, Program, Type, Value,
};

fn main_fn(entry: u32, commands: Vec<Command>) -> Function {
    Function {
        id: FunctionId(0),
        name: "main".to_string(),
        entry: Some(CommandId(entry)),
        commands,
    }
}

#[test]
fn pause_at_input_then_resume_and_complete() {
    // main: input int32 -> value 1; print value 1
    let f = main_fn(
        1,
        vec![
            cmd(1, Op::Input { ty: Type::Int32 }, vec![], vec![1], Some(2)),
            cmd(2, Op::Print, vec![1], vec![], None),
        ],
    );
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f],
    };
    let status = run_resumable::start(program);
    assert!(matches!(
        status,
        run_resumable::RunStatus::WaitingInput {
            command: CommandId(1),
            ty: Type::Int32
        }
    ));
    let status = run_resumable::provide_input("42");
    match status {
        run_resumable::RunStatus::Finished {
            steps,
            prints,
            printed,
            returned,
        } => {
            assert_eq!(steps, 2);
            assert_eq!(prints, 1);
            assert_eq!(printed, vec!["42".to_string()]);
            assert_eq!(returned, None);
        }
        other => panic!("expected finished, got {:?}", other),
    }
}

#[test]
fn input_returned_as_main_result() {
    // main: input int32 -> value 1; set var "x"; return "{x}"
    let f = main_fn(
        1,
        vec![
            cmd(1, Op::Input { ty: Type::Int32 }, vec![], vec![1], Some(2)),
            cmd(
                2,
                Op::Set {
                    var: "x".to_string(),
                    ty: Type::Int32,
                },
                vec![1],
                vec![],
                Some(3),
            ),
            cmd(
                3,
                Op::Return {
                    expr: "{x}".to_string(),
                },
                vec![],
                vec![],
                None,
            ),
        ],
    );
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f],
    };
    let status = run_resumable::start(program);
    assert!(matches!(
        status,
        run_resumable::RunStatus::WaitingInput { .. }
    ));
    let status = run_resumable::provide_input("7");
    match status {
        run_resumable::RunStatus::Finished { returned, .. } => {
            assert_eq!(returned, Some(Value::Int32(7)));
        }
        other => panic!("expected finished, got {:?}", other),
    }
}

#[test]
fn provide_input_rejects_bad_parse() {
    let f = main_fn(
        1,
        vec![cmd(1, Op::Input { ty: Type::Int32 }, vec![], vec![1], None)],
    );
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f],
    };
    let _ = run_resumable::start(program);
    let status = run_resumable::provide_input("abc");
    assert!(matches!(
        status,
        run_resumable::RunStatus::Error(optilotus::ExecError::InputParse { .. })
    ));
}

#[test]
fn provide_input_without_pending_is_invalid_state() {
    // A completed run (Lit, no input) leaves nothing pending.
    let f = main_fn(
        1,
        vec![cmd(
            1,
            Op::Lit(optilotus::Value::Int32(1)),
            vec![],
            vec![1],
            None,
        )],
    );
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f],
    };
    let _ = run_resumable::start(program);
    let status = run_resumable::provide_input("anything");
    assert!(matches!(
        status,
        run_resumable::RunStatus::Error(optilotus::ExecError::InvalidState)
    ));
}

#[test]
fn nested_helper_with_input() {
    // helper: input int32 -> 10; set "r"; return "{r}"
    // main: r = helper(); print value 1
    let helper = Function {
        id: FunctionId(1),
        name: "helper".to_string(),
        entry: Some(CommandId(10)),
        commands: vec![
            cmd(
                10,
                Op::Input { ty: Type::Int32 },
                vec![],
                vec![10],
                Some(11),
            ),
            cmd(
                11,
                Op::Set {
                    var: "r".to_string(),
                    ty: Type::Int32,
                },
                vec![10],
                vec![],
                Some(12),
            ),
            cmd(
                12,
                Op::Return {
                    expr: "{r}".to_string(),
                },
                vec![],
                vec![],
                None,
            ),
        ],
    };
    let main = Function {
        id: FunctionId(0),
        name: "main".to_string(),
        entry: Some(CommandId(1)),
        commands: vec![
            cmd(
                1,
                Op::Compute {
                    expr: "helper()".to_string(),
                },
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(2, Op::Print, vec![1], vec![], None),
        ],
    };
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![main, helper],
    };
    let status = run_resumable::start(program);
    assert!(matches!(
        status,
        run_resumable::RunStatus::WaitingInput { .. }
    ));
    let status = run_resumable::provide_input("7");
    match status {
        run_resumable::RunStatus::Finished { printed, .. } => {
            assert_eq!(printed, vec!["7".to_string()]);
        }
        other => panic!("expected finished, got {:?}", other),
    }
}

#[test]
fn helper_calling_helper_with_input() {
    // inner: input int32 -> 20; set "r"; return "{r}"
    // outer: v = inner(); set "v"; return "{v}"
    // main: r = outer(); print value 1
    let inner = Function {
        id: FunctionId(1),
        name: "inner".to_string(),
        entry: Some(CommandId(20)),
        commands: vec![
            cmd(
                20,
                Op::Input { ty: Type::Int32 },
                vec![],
                vec![20],
                Some(21),
            ),
            cmd(
                21,
                Op::Set {
                    var: "r".to_string(),
                    ty: Type::Int32,
                },
                vec![20],
                vec![],
                Some(22),
            ),
            cmd(
                22,
                Op::Return {
                    expr: "{r}".to_string(),
                },
                vec![],
                vec![],
                None,
            ),
        ],
    };
    let outer = Function {
        id: FunctionId(2),
        name: "outer".to_string(),
        entry: Some(CommandId(10)),
        commands: vec![
            cmd(
                10,
                Op::Compute {
                    expr: "inner()".to_string(),
                },
                vec![],
                vec![10],
                Some(11),
            ),
            cmd(
                11,
                Op::Set {
                    var: "v".to_string(),
                    ty: Type::Int32,
                },
                vec![10],
                vec![],
                Some(12),
            ),
            cmd(
                12,
                Op::Return {
                    expr: "{v}".to_string(),
                },
                vec![],
                vec![],
                None,
            ),
        ],
    };
    let main = Function {
        id: FunctionId(0),
        name: "main".to_string(),
        entry: Some(CommandId(1)),
        commands: vec![
            cmd(
                1,
                Op::Compute {
                    expr: "outer()".to_string(),
                },
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(2, Op::Print, vec![1], vec![], None),
        ],
    };
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![main, outer, inner],
    };
    let status = run_resumable::start(program);
    assert!(matches!(
        status,
        run_resumable::RunStatus::WaitingInput { .. }
    ));
    let status = run_resumable::provide_input("5");
    match status {
        run_resumable::RunStatus::Finished { printed, .. } => {
            assert_eq!(printed, vec!["5".to_string()]);
        }
        other => panic!("expected finished, got {:?}", other),
    }
}

#[test]
fn cancel_clears_state() {
    let f = main_fn(
        1,
        vec![cmd(1, Op::Input { ty: Type::Int32 }, vec![], vec![1], None)],
    );
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f.clone()],
    };
    let _ = run_resumable::start(program);
    run_resumable::cancel();
    let st = run_resumable::status();
    assert!(matches!(st, run_resumable::RunStatus::Error(_)));
    // Providing input with no active run is an error.
    let st = run_resumable::provide_input("1");
    assert!(matches!(st, run_resumable::RunStatus::Error(_)));
    // A fresh start works after cancel.
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f],
    };
    let st = run_resumable::start(program);
    assert!(matches!(st, run_resumable::RunStatus::WaitingInput { .. }));
    run_resumable::cancel();
    assert!(matches!(
        run_resumable::status(),
        run_resumable::RunStatus::Error(_)
    ));
}

#[test]
fn peek_pending_without_consuming() {
    let f = main_fn(
        1,
        vec![cmd(1, Op::Input { ty: Type::Int32 }, vec![], vec![1], None)],
    );
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f],
    };
    let _ = run_resumable::start(program);

    // Peek returns the pending input without consuming it.
    let peek = run_resumable::peek();
    assert!(matches!(
        peek,
        Some(optilotus::run_resumable::PendingInput {
            command: CommandId(1),
            ty: Type::Int32
        })
    ));

    // Peek again — still pending, not consumed.
    let peek2 = run_resumable::peek();
    assert!(peek2.is_some());

    // Providing input consumes it.
    let status = run_resumable::provide_input("42");
    assert!(matches!(status, run_resumable::RunStatus::Finished { .. }));

    // After completion, no pending input.
    let peek3 = run_resumable::peek();
    assert!(peek3.is_none());
}

#[test]
fn peek_pending_when_no_active_run() {
    let peek = run_resumable::peek();
    assert!(peek.is_none());
}

#[test]
fn reset_clears_active_run() {
    let f = main_fn(
        1,
        vec![cmd(1, Op::Input { ty: Type::Int32 }, vec![], vec![1], None)],
    );
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f.clone()],
    };
    let _ = run_resumable::start(program);
    run_resumable::reset();
    let st = run_resumable::status();
    assert!(matches!(st, run_resumable::RunStatus::Error(_)));
    // Fresh start works after reset.
    let program = Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f],
    };
    let st = run_resumable::start(program);
    assert!(matches!(st, run_resumable::RunStatus::WaitingInput { .. }));
}
