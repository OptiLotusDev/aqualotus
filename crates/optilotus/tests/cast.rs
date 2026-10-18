mod common;

use common::{cmd, fun};
use optilotus::{run_function, Op, Type, Value, VecSink, VecSource};

#[test]
fn cast_int_to_float() {
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int32(42)), vec![], vec![1], Some(2)),
            cmd(2, Op::Cast { to: Type::Float64 }, vec![1], vec![2], Some(3)),
            cmd(3, Op::Print, vec![2], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let mut source = VecSource::default();
    run_function(&f, &mut sink, &mut source).unwrap();
    assert_eq!(sink.lines, vec!["42".to_string()]);
}

#[test]
fn cast_string_to_int() {
    let f = fun(
        Some(1),
        vec![
            cmd(
                1,
                Op::Lit(Value::String("7".into())),
                vec![],
                vec![1],
                Some(2),
            ),
            cmd(2, Op::Cast { to: Type::Int32 }, vec![1], vec![2], Some(3)),
            cmd(3, Op::Print, vec![2], vec![], None),
        ],
    );
    let mut sink = VecSink::default();
    let mut source = VecSource::default();
    run_function(&f, &mut sink, &mut source).unwrap();
    assert_eq!(sink.lines, vec!["7".to_string()]);
}

#[test]
fn cast_overflow_fails() {
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Lit(Value::Int32(1000)), vec![], vec![1], Some(2)),
            cmd(2, Op::Cast { to: Type::Int8 }, vec![1], vec![2], None),
        ],
    );
    let mut sink = VecSink::default();
    let mut source = VecSource::default();
    let err = run_function(&f, &mut sink, &mut source).unwrap_err();
    assert!(matches!(err, optilotus::ExecError::TypeMismatch { .. }));
}
