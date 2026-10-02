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

#[test]
fn self_loop_hits_loop_limit() {
    // A command pointing at itself runs until the cap, then stops.
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
            cmd(2, Op::Print, vec![1], vec![], Some(2)),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function_with_limit(&f, &mut sink, 5).unwrap_err();
    assert_eq!(err, ExecError::LoopLimit { limit: 5 });
    assert_eq!(sink.lines.len(), 4);
}

#[test]
fn three_node_cycle_hits_loop_limit() {
    // A -> B -> C -> A: longer loops are bounded the same way.
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
            cmd(4, Op::Print, vec![2], vec![], Some(2)),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function_with_limit(&f, &mut sink, 7).unwrap_err();
    assert_eq!(err, ExecError::LoopLimit { limit: 7 });
    assert_eq!(sink.lines.len(), 4);
}

#[test]
fn counter_loop_stops_only_at_limit() {
    // Each lap mutates a variable (i = i + 1); state changes never
    // escape the step cap.
    let set_i = |id: u32, next: Option<u32>| {
        cmd(
            id,
            Op::Set {
                var: "i".to_string(),
                ty: Type::Int32,
            },
            vec![1],
            vec![],
            next,
        )
    };
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int32(0)), vec![], vec![1], Some(2)),
            set_i(2, Some(3)),
            cmd(
                3,
                Op::Get {
                    var: "i".to_string(),
                },
                vec![],
                vec![2],
                Some(4),
            ),
            cmd(
                4,
                Op::Compute {
                    expr: "{i} + 1".to_string(),
                },
                vec![],
                vec![1],
                Some(2),
            ),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function_with_limit(&f, &mut sink, 10).unwrap_err();
    assert_eq!(err, ExecError::LoopLimit { limit: 10 });
}

#[test]
fn cascaded_compute_pipeline() {
    // a = 2*3 = 6; b = a*10+4 = 64; c = (b-4)/3 = 20; print "20".
    // Each stage flows through Set/Get: the cascade pattern.
    let set = |id: u32, var: &str, ty: Type, next: Option<u32>| {
        cmd(
            id,
            Op::Set {
                var: var.to_string(),
                ty,
            },
            vec![1],
            vec![],
            next,
        )
    };
    let compute = |id: u32, expr: &str, next: Option<u32>| {
        cmd(
            id,
            Op::Compute {
                expr: expr.to_string(),
            },
            vec![],
            vec![1],
            next,
        )
    };
    let f = fun(
        Some(1),
        vec![
            compute(1, "2 * 3", Some(2)),
            set(2, "a", Type::Int32, Some(3)),
            compute(3, "{a} * 10 + 4", Some(4)),
            set(4, "b", Type::Int32, Some(5)),
            compute(5, "({b} - 4) / 3", Some(6)),
            set(6, "c", Type::Int32, Some(7)),
            cmd(
                7,
                Op::Get {
                    var: "c".to_string(),
                },
                vec![],
                vec![2],
                Some(8),
            ),
            cmd(8, Op::Print, vec![2], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["20".to_string()]);
    assert_eq!(report.steps, 8);
}

#[test]
fn reassignment_in_sequence() {
    // i = 0, then three inline re-sets (Get/Compute/Set); print "3".
    let inc = |get_id: u32, compute_id: u32, set_id: u32, next: Option<u32>| {
        vec![
            cmd(
                get_id,
                Op::Get {
                    var: "i".to_string(),
                },
                vec![],
                vec![2],
                Some(compute_id),
            ),
            cmd(
                compute_id,
                Op::Compute {
                    expr: "{i} + 1".to_string(),
                },
                vec![],
                vec![1],
                Some(set_id),
            ),
            cmd(
                set_id,
                Op::Set {
                    var: "i".to_string(),
                    ty: Type::Int32,
                },
                vec![1],
                vec![],
                next,
            ),
        ]
    };
    let mut commands = vec![
        cmd(1, Op::Lit(Value::Int32(0)), vec![], vec![1], Some(2)),
        cmd(
            2,
            Op::Set {
                var: "i".to_string(),
                ty: Type::Int32,
            },
            vec![1],
            vec![],
            Some(3),
        ),
    ];
    commands.extend(inc(3, 4, 5, Some(6)));
    commands.extend(inc(6, 7, 8, Some(9)));
    commands.extend(inc(9, 10, 11, Some(12)));
    commands.push(cmd(
        12,
        Op::Get {
            var: "i".to_string(),
        },
        vec![],
        vec![2],
        Some(13),
    ));
    commands.push(cmd(13, Op::Print, vec![2], vec![], None));
    let f = fun(Some(1), commands);
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["3".to_string()]);
    assert_eq!(report.steps, 13);
}

#[test]
fn mid_chain_failure_keeps_earlier_prints() {
    // Two prints land, then a bad Compute fails: partial effects stay,
    // and the error still reports its command.
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("\"first\"".to_string())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(2, Op::Print, vec![1], vec![], Some(3)),
            cmd(
                3,
                Op::Lit(Value::String("\"second\"".to_string())),
                vec![],
                vec![2],
                Some(4),
            ),
            cmd(4, Op::Print, vec![2], vec![], Some(5)),
            cmd(
                5,
                Op::Compute {
                    expr: "(3 +".to_string(),
                },
                vec![],
                vec![3],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert!(matches!(err, ExecError::ExprError { .. }));
    assert_eq!(sink.lines, vec!["first".to_string(), "second".to_string()]);
}

#[test]
fn unknown_command_mid_chain() {
    // First command runs, then `next` points nowhere.
    let f = fun(
        Some(1),
        vec![cmd(1, Op::Lit(Value::Int32(1)), vec![], vec![1], Some(99))],
    );
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert_eq!(
        err,
        ExecError::UnknownCommand {
            command: CommandId(99)
        }
    );
}

#[test]
fn dangling_entry_fails() {
    let f = fun(None, vec![]);
    let dangling = optilotus::Function {
        id: optilotus::FunctionId(1),
        name: "dangling".to_string(),
        entry: Some(CommandId(99)),
        commands: f.commands,
    };
    let mut sink = VecSink::default();
    let err = run_function(&dangling, &mut sink).unwrap_err();
    assert_eq!(
        err,
        ExecError::UnknownCommand {
            command: CommandId(99)
        }
    );
}

#[test]
fn missing_value_print_fails() {
    // Print names a ValueId no command ever produced.
    let f = fun(Some(1), vec![cmd(1, Op::Print, vec![7], vec![], None)]);
    let mut sink = VecSink::default();
    let err = run_function(&f, &mut sink).unwrap_err();
    assert_eq!(
        err,
        ExecError::MissingValue {
            command: CommandId(1),
            value: optilotus::ValueId(7),
        }
    );
}

#[test]
fn arity_violations_are_reported() {
    // Set with no input.
    let f = fun(
        Some(1),
        vec![cmd(
            1,
            Op::Set {
                var: "x".to_string(),
                ty: Type::Int32,
            },
            vec![],
            vec![],
            None,
        )],
    );
    let mut sink = VecSink::default();
    assert!(matches!(
        run_function(&f, &mut sink).unwrap_err(),
        ExecError::Arity { .. }
    ));

    // Get with two outputs.
    let f = fun(
        Some(1),
        vec![cmd(
            1,
            Op::Get {
                var: "x".to_string(),
            },
            vec![],
            vec![1, 2],
            None,
        )],
    );
    assert!(matches!(
        run_function(&f, &mut sink).unwrap_err(),
        ExecError::Arity { .. }
    ));

    // Compute with an input.
    let f = fun(
        Some(1),
        vec![cmd(
            1,
            Op::Compute {
                expr: "1".to_string(),
            },
            vec![1],
            vec![2],
            None,
        )],
    );
    assert!(matches!(
        run_function(&f, &mut sink).unwrap_err(),
        ExecError::Arity { .. }
    ));

    // Print with an output.
    let f = fun(Some(1), vec![cmd(1, Op::Print, vec![1], vec![2], None)]);
    assert!(matches!(
        run_function(&f, &mut sink).unwrap_err(),
        ExecError::Arity { .. }
    ));
}

#[test]
fn set_void_type_rejected() {
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Void), vec![], vec![1], Some(2)),
            cmd(
                2,
                Op::Set {
                    var: "v".to_string(),
                    ty: Type::Void,
                },
                vec![1],
                vec![],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    assert!(matches!(
        run_function(&f, &mut sink).unwrap_err(),
        ExecError::TypeMismatch { .. }
    ));
}

#[test]
fn empty_template_prints_empty_line() {
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("".to_string())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(2, Op::Print, vec![1], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["".to_string()]);
    assert_eq!(report.prints, 1);
}

#[test]
fn adjacent_refs_and_multi_concat() {
    // "{a}{b}" + "-" + "{a}" with a=x, b=y -> "xy-x".
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("x".to_string())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(
                2,
                Op::Set {
                    var: "a".to_string(),
                    ty: Type::String,
                },
                vec![1],
                vec![],
                Some(3),
            ),
            cmd(
                3,
                Op::Lit(Value::String("y".to_string())),
                vec![],
                vec![2],
                Some(4),
            ),
            cmd(
                4,
                Op::Set {
                    var: "b".to_string(),
                    ty: Type::String,
                },
                vec![2],
                vec![],
                Some(5),
            ),
            cmd(
                5,
                Op::Lit(Value::String("\"{a}{b}\" + \"-\" + \"{a}\"".to_string())),
                vec![],
                vec![3],
                Some(6),
            ),
            cmd(6, Op::Print, vec![3], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    run_function(&f, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["xy-x".to_string()]);
}

#[test]
fn compute_all_operators_end_to_end() {
    // 10%3=1, 7/2=3, 2.5*4=10, 5-8=-3, 2*(3+4)=14.
    let compute_print = |id: u32, expr: &str, out: u32, next: Option<u32>| {
        vec![
            cmd(
                id,
                Op::Compute {
                    expr: expr.to_string(),
                },
                vec![],
                vec![out],
                Some(id + 1),
            ),
            cmd(id + 1, Op::Print, vec![out], vec![], next),
        ]
    };
    let mut commands = vec![];
    commands.extend(compute_print(1, "10 % 3", 1, Some(3)));
    commands.extend(compute_print(3, "7 / 2", 2, Some(5)));
    commands.extend(compute_print(5, "2.5 * 4", 3, Some(7)));
    commands.extend(compute_print(7, "5 - 8", 4, Some(9)));
    commands.extend(compute_print(9, "2 * (3 + 4)", 5, None));
    let f = fun(Some(1), commands);
    let mut sink = VecSink::default();
    let report = run_function(&f, &mut sink).unwrap();
    assert_eq!(
        sink.lines,
        vec![
            "1".to_string(),
            "3".to_string(),
            "10".to_string(),
            "-3".to_string(),
            "14".to_string(),
        ]
    );
    assert_eq!(report.prints, 5);
}

#[test]
fn string_var_in_arithmetic_fails() {
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("x".to_string())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(
                2,
                Op::Set {
                    var: "s".to_string(),
                    ty: Type::String,
                },
                vec![1],
                vec![],
                Some(3),
            ),
            cmd(
                3,
                Op::Compute {
                    expr: "{s} + 1".to_string(),
                },
                vec![],
                vec![2],
                None,
            ),
        ],
    );
    let mut sink = VecSink::default();
    assert!(matches!(
        run_function(&f, &mut sink).unwrap_err(),
        ExecError::TypeMismatch { .. }
    ));
}
