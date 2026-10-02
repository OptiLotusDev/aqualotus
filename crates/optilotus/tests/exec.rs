mod common;

use common::{cmd, fun};
use optilotus::{
    run_function, run_function_with_limit, CommandId, ExecError, Op, Type, Value, VecSink,
};

#[test]
fn compute_print_chain_prints_sum() {
    // Compute "2 + 3" -> 5, print it.
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Compute {
                    expr: "2 + 3".to_string(),
                },
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(2, Op::Print, vec![1], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["5".to_string()]);
    assert_eq!(report.steps, 2);
    assert_eq!(report.prints, 1);
}

#[test]
fn mixed_int_types_are_a_mismatch() {
    // a: int8, b: uint8; "{a} + {b}" stays strict across variables.
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int8(1)), vec![], vec![1], Some(2)),
            cmd(
                2,
                Op::Set {
                    var: "a".to_string(),
                    ty: Type::Int8,
                },
                vec![1],
                vec![],
                Some(3),
            ),
            cmd(3, Op::Lit(Value::Uint8(1)), vec![], vec![2], Some(4)),
            cmd(
                4,
                Op::Set {
                    var: "b".to_string(),
                    ty: Type::Uint8,
                },
                vec![2],
                vec![],
                Some(5),
            ),
            cmd(
                5,
                Op::Compute {
                    expr: "{a} + {b}".to_string(),
                },
                vec![],
                vec![3],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert!(matches!(err, ExecError::TypeMismatch { .. }));
}

#[test]
fn overflow_is_reported() {
    // m: int8 = 127; "{m} + 1" overflows int8.
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int8(i8::MAX)), vec![], vec![1], Some(2)),
            cmd(
                2,
                Op::Set {
                    var: "m".to_string(),
                    ty: Type::Int8,
                },
                vec![1],
                vec![],
                Some(3),
            ),
            cmd(
                3,
                Op::Compute {
                    expr: "{m} + 1".to_string(),
                },
                vec![],
                vec![2],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert_eq!(
        err,
        ExecError::Overflow {
            command: CommandId(3)
        }
    );
}

#[test]
fn three_prints_yield_three_sink_entries() {
    // String inputs to Print are templates, so literals are quoted.
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("\"a\"".to_string())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(2, Op::Print, vec![1], vec![], Some(3)),
            cmd(
                3,
                Op::Lit(Value::String("\"b\"".to_string())),
                vec![],
                vec![2],
                Some(4),
            ),
            cmd(4, Op::Print, vec![2], vec![], Some(5)),
            cmd(
                5,
                Op::Lit(Value::String("\"c\"".to_string())),
                vec![],
                vec![3],
                Some(6),
            ),
            cmd(6, Op::Print, vec![3], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(
        sink.lines,
        vec!["a".to_string(), "b".to_string(), "c".to_string()]
    );
    assert_eq!(report.prints, 3);
}

#[test]
fn cycle_hits_loop_limit() {
    // B1 -> B2 -> B1 ...
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("\"x\"".to_string())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(2, Op::Print, vec![1], vec![], Some(1)),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function_with_limit(&f, &mut sink, 10).unwrap_err();
    assert_eq!(err, ExecError::LoopLimit { limit: 10 });
}

#[test]
fn empty_function_runs_nothing() {
    let f = fun(None, vec![]);
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(report.steps, 0);
    assert_eq!(report.prints, 0);
    assert!(sink.lines.is_empty());
}

#[test]
fn set_get_compute_print_chain() {
    // n = 41 (int32); Compute "{n} + 1"; print "42".
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int32(41)), vec![], vec![1], Some(2)),
            cmd(
                2,
                Op::Set {
                    var: "n".to_string(),
                    ty: Type::Int32,
                },
                vec![1],
                vec![],
                Some(3),
            ),
            cmd(
                3,
                Op::Compute {
                    expr: "{n} + 1".to_string(),
                },
                vec![],
                vec![2],
                Some(4),
            ),
            cmd(4, Op::Print, vec![2], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["42".to_string()]);
    assert_eq!(report.steps, 4);
    assert_eq!(report.prints, 1);
}

#[test]
fn set_rejects_wrong_type() {
    // Declared int32 but given a string.
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("\"oops\"".to_string())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(
                2,
                Op::Set {
                    var: "n".to_string(),
                    ty: Type::Int32,
                },
                vec![1],
                vec![],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert!(matches!(err, ExecError::TypeMismatch { .. }));
}

#[test]
fn set_rejects_type_change() {
    // n starts as int32; re-declaring it as string fails.
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int32(1)), vec![], vec![1], Some(2)),
            cmd(
                2,
                Op::Set {
                    var: "n".to_string(),
                    ty: Type::Int32,
                },
                vec![1],
                vec![],
                Some(3),
            ),
            cmd(
                3,
                Op::Lit(Value::String("\"s\"".to_string())),
                vec![],
                vec![2],
                Some(4),
            ),
            cmd(
                4,
                Op::Set {
                    var: "n".to_string(),
                    ty: Type::String,
                },
                vec![2],
                vec![],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert!(matches!(err, ExecError::TypeMismatch { .. }));
}

#[test]
fn get_returns_set_value() {
    // g = 7; Get g inline; print "7".
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int32(7)), vec![], vec![1], Some(2)),
            cmd(
                2,
                Op::Set {
                    var: "g".to_string(),
                    ty: Type::Int32,
                },
                vec![1],
                vec![],
                Some(3),
            ),
            cmd(
                3,
                Op::Get {
                    var: "g".to_string(),
                },
                vec![],
                vec![2],
                Some(4),
            ),
            cmd(4, Op::Print, vec![2], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["7".to_string()]);
    assert_eq!(report.prints, 1);
}

#[test]
fn get_unknown_variable_fails() {
    let f = fun(
        Some(1),
        vec![cmd(
            1,
            Op::Get {
                var: "ghost".to_string(),
            },
            vec![],
            vec![1],
            None,
        )],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert_eq!(
        err,
        ExecError::UnknownVariable {
            command: CommandId(1),
            var: "ghost".to_string(),
        }
    );
}

#[test]
fn compute_with_variables_in_chain() {
    // x = 3; Compute "(3 + 4) % 2" -> 1... use x: ({x} + 4) % 2 = 1.
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int32(3)), vec![], vec![1], Some(2)),
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
                Op::Compute {
                    expr: "({x} + 4) % 2".to_string(),
                },
                vec![],
                vec![2],
                Some(4),
            ),
            cmd(4, Op::Print, vec![2], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["1".to_string()]);
    assert_eq!(report.prints, 1);
}

#[test]
fn compute_bad_syntax_is_expr_error() {
    let f = fun(
        Some(1),
        vec![cmd(
            1,
            Op::Compute {
                expr: "(3 +".to_string(),
            },
            vec![],
            vec![1],
            None,
        )],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert!(matches!(err, ExecError::ExprError { .. }));
}

#[test]
fn compute_div_by_zero() {
    let f = fun(
        Some(1),
        vec![cmd(
            1,
            Op::Compute {
                expr: "1 / 0".to_string(),
            },
            vec![],
            vec![1],
            None,
        )],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert_eq!(
        err,
        ExecError::DivByZero {
            command: CommandId(1)
        }
    );
}

#[test]
fn print_template_concat_and_interpolation() {
    // name = "Bob"; print "Hello {name}" + " AAA" -> "Hello Bob AAA".
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("Bob".to_string())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(
                2,
                Op::Set {
                    var: "name".to_string(),
                    ty: Type::String,
                },
                vec![1],
                vec![],
                Some(3),
            ),
            cmd(
                3,
                Op::Lit(Value::String("\"Hello {name}\" + \" AAA\"".to_string())),
                vec![],
                vec![2],
                Some(4),
            ),
            cmd(4, Op::Print, vec![2], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["Hello Bob AAA".to_string()]);
    assert_eq!(report.prints, 1);
}

#[test]
fn print_template_unknown_variable_fails() {
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("\"hi {ghost}\"".to_string())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(2, Op::Print, vec![1], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert!(matches!(err, ExecError::UnknownVariable { .. }));
}

#[test]
fn variables_do_not_leak_between_functions() {
    // First function sets x; a second function reading x still fails:
    // scope is per function run.
    let setter = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int32(1)), vec![], vec![1], Some(2)),
            cmd(
                2,
                Op::Set {
                    var: "x".to_string(),
                    ty: Type::Int32,
                },
                vec![1],
                vec![],
                None,
            ),
        ],
    );
    let reader = fun(
        Some(1),
        vec![cmd(
            1,
            Op::Get {
                var: "x".to_string(),
            },
            vec![],
            vec![1],
            None,
        )],
    );
    let mut sink = VecSink::default();
    run_function(&setter, &mut sink).unwrap();
    let err = run_function(&reader, &mut sink).unwrap_err();
    assert!(matches!(err, ExecError::UnknownVariable { .. }));
}
