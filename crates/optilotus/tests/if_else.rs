mod common;

use common::{cmd, fun};
use optilotus::{
    run_function, Command, CommandId, ExecError, FunctionId, Op, Package, Value, ValueId, VecSink,
    MAIN_ID,
};

fn if_true_program() -> optilotus::Function {
    fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Bool(true)), vec![], vec![1], Some(4)),
            cmd(
                2,
                Op::Lit(Value::String("\"then\"".to_string())),
                vec![],
                vec![2],
                Some(3),
            ),
            cmd(3, Op::Print, vec![2], vec![], None),
            cmd(
                4,
                Op::If {
                    condition: ValueId(1),
                    then_body: vec![CommandId(2), CommandId(3)],
                    else_body: None,
                },
                vec![],
                vec![],
                None,
            ),
        ],
    )
}

#[test]
fn if_true_runs_then_body() {
    let f = if_true_program();
    let mut sink = VecSink::default();
    run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["then".to_string()]);
}

#[test]
fn if_false_runs_else_body() {
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Bool(false)), vec![], vec![1], Some(4)),
            cmd(
                2,
                Op::Lit(Value::String("\"then\"".to_string())),
                vec![],
                vec![2],
                Some(3),
            ),
            cmd(3, Op::Print, vec![2], vec![], None),
            cmd(
                5,
                Op::Lit(Value::String("\"else\"".to_string())),
                vec![],
                vec![5],
                Some(6),
            ),
            cmd(6, Op::Print, vec![5], vec![], None),
            cmd(
                4,
                Op::If {
                    condition: ValueId(1),
                    then_body: vec![CommandId(2), CommandId(3)],
                    else_body: Some(vec![CommandId(5), CommandId(6)]),
                },
                vec![],
                vec![],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["else".to_string()]);
}

#[test]
fn if_false_without_else_skips_and_continues() {
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Bool(false)), vec![], vec![1], Some(4)),
            cmd(
                2,
                Op::Lit(Value::String("\"skipped\"".to_string())),
                vec![],
                vec![2],
                Some(3),
            ),
            cmd(3, Op::Print, vec![2], vec![], None),
            cmd(
                4,
                Op::If {
                    condition: ValueId(1),
                    then_body: vec![CommandId(2), CommandId(3)],
                    else_body: None,
                },
                vec![],
                vec![],
                Some(7),
            ),
            cmd(
                7,
                Op::Lit(Value::String("\"after\"".to_string())),
                vec![],
                vec![7],
                Some(8),
            ),
            cmd(8, Op::Print, vec![7], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["after".to_string()]);
}

#[test]
fn nested_if_executes_inner_branch() {
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Bool(true)), vec![], vec![1], Some(2)),
            cmd(2, Op::Lit(Value::Bool(false)), vec![], vec![2], Some(10)),
            cmd(
                3,
                Op::Lit(Value::String("\"inner-else\"".to_string())),
                vec![],
                vec![3],
                Some(4),
            ),
            cmd(4, Op::Print, vec![3], vec![], None),
            cmd(
                5,
                Op::Lit(Value::String("\"inner-then\"".to_string())),
                vec![],
                vec![5],
                Some(6),
            ),
            cmd(6, Op::Print, vec![5], vec![], None),
            cmd(
                11,
                Op::If {
                    condition: ValueId(2),
                    then_body: vec![CommandId(5), CommandId(6)],
                    else_body: Some(vec![CommandId(3), CommandId(4)]),
                },
                vec![],
                vec![],
                None,
            ),
            cmd(
                10,
                Op::If {
                    condition: ValueId(1),
                    then_body: vec![CommandId(11)],
                    else_body: None,
                },
                vec![],
                vec![],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["inner-else".to_string()]);
}

#[test]
fn non_bool_condition_is_typed_type_error() {
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int32(1)), vec![], vec![1], Some(2)),
            cmd(
                2,
                Op::If {
                    condition: ValueId(1),
                    then_body: vec![],
                    else_body: None,
                },
                vec![],
                vec![],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert!(
        matches!(
            err,
            ExecError::TypeMismatch {
                command: CommandId(2),
                ..
            }
        ),
        "got {err:?}"
    );
}

#[test]
fn missing_condition_value_is_typed() {
    let f = fun(
        Some(2),
        vec![cmd(
            2,
            Op::If {
                condition: ValueId(99),
                then_body: vec![],
                else_body: None,
            },
            vec![],
            vec![],
            None,
        )],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert!(
        matches!(
            err,
            ExecError::MissingValue {
                command: CommandId(2),
                value: ValueId(99)
            }
        ),
        "got {err:?}"
    );
}

#[test]
fn if_serialization_round_trips() {
    let f = if_true_program();
    let program = optilotus::Program {
        version: 1,
        package: "app".to_string(),
        functions: vec![f],
    };
    let json = serde_json::to_string(&program).unwrap();
    let back: optilotus::Program = serde_json::from_str(&json).unwrap();
    assert_eq!(program, back);
}

/// Build an unlinked `Lit(string) -> Print` pair as an if body.
fn raw_print_body(pkg: &mut Package, fid: FunctionId, text: &str) -> (CommandId, CommandId) {
    let vid = pkg.alloc_value_id();
    let lit_id = pkg.alloc_command_id();
    let print_id = pkg.alloc_command_id();
    pkg.add_raw_command(
        fid,
        Command {
            id: lit_id,
            op: Op::Lit(Value::String(text.to_string())),
            inputs: vec![],
            outputs: vec![vid],
            next: Some(print_id),
        },
    )
    .unwrap();
    pkg.add_raw_command(
        fid,
        Command {
            id: print_id,
            op: Op::Print,
            inputs: vec![vid],
            outputs: vec![],
            next: None,
        },
    )
    .unwrap();
    (lit_id, print_id)
}

fn package_if_program(x_init: &str) -> Package {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some(x_init)).unwrap();
    let cond = pkg.eval_cond(MAIN_ID, "{x} > 5").unwrap();
    let (then_lit, then_print) = raw_print_body(&mut pkg, MAIN_ID, "\"big\"");
    let (else_lit, else_print) = raw_print_body(&mut pkg, MAIN_ID, "\"small\"");
    pkg.if_(
        MAIN_ID,
        cond,
        vec![then_lit, then_print],
        Some(vec![else_lit, else_print]),
    )
    .unwrap();
    pkg
}

#[test]
fn package_if_takes_then_branch() {
    let pkg = package_if_program("10");
    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["big".to_string()]);
}

#[test]
fn package_if_takes_else_branch() {
    let pkg = package_if_program("3");
    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["small".to_string()]);
}

#[test]
fn package_if_lists_with_condition_and_bodies() {
    let pkg = package_if_program("10");
    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    let if_cmd = cmds
        .iter()
        .find(|c| c.kind == optilotus::CommandKind::If)
        .expect("if command listed");
    assert!(if_cmd.condition.is_some());
    assert_eq!(if_cmd.then_body.as_ref().unwrap().len(), 2);
    assert_eq!(if_cmd.else_body.as_ref().unwrap().len(), 2);
}
