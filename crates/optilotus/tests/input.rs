mod common;

use common::{cmd, fun};
use optilotus::{run_function, CommandId, ExecError, Op, Type, VecSink, VecSource};

#[test]
fn input_string_happy() {
    let f = fun(
        Some(1),
        vec![cmd(
            1,
            Op::Input { ty: Type::String },
            vec![],
            vec![1],
            None,
        )],
    );
    let mut sink = VecSink::default();
    let mut source = VecSource {
        lines: vec!["hello".into()],
        ..Default::default()
    };
    let report = run_function(&f, &mut sink, &mut source).unwrap();
    assert_eq!(report.steps, 1);
}

#[test]
fn input_int32_happy() {
    let f = fun(
        Some(1),
        vec![cmd(1, Op::Input { ty: Type::Int32 }, vec![], vec![1], None)],
    );
    let mut sink = VecSink::default();
    let mut source = VecSource {
        lines: vec!["42".into()],
        ..Default::default()
    };
    // run manually not needed; use function returns no print. Just check no error.
    run_function(&f, &mut sink, &mut source).unwrap();
}

#[test]
fn input_parse_fail() {
    let f = fun(
        Some(1),
        vec![cmd(1, Op::Input { ty: Type::Int32 }, vec![], vec![1], None)],
    );
    let mut sink = VecSink::default();
    let mut source = VecSource {
        lines: vec!["abc".into()],
        ..Default::default()
    };
    let err = run_function(&f, &mut sink, &mut source).unwrap_err();
    assert!(matches!(err, ExecError::InputParse { .. }));
}

#[test]
fn input_eof() {
    let f = fun(
        Some(1),
        vec![cmd(
            1,
            Op::Input { ty: Type::String },
            vec![],
            vec![1],
            None,
        )],
    );
    let mut sink = VecSink::default();
    let mut source = VecSource::default();
    let err = run_function(&f, &mut sink, &mut source).unwrap_err();
    assert!(matches!(
        err,
        ExecError::InputEof {
            command: CommandId(1)
        }
    ));
}

#[test]
fn input_multiple_lines() {
    let f = fun(
        Some(1),
        vec![
            cmd(1, Op::Input { ty: Type::String }, vec![], vec![1], Some(2)),
            cmd(2, Op::Input { ty: Type::String }, vec![], vec![2], None),
        ],
    );
    let mut sink = VecSink::default();
    let mut source = VecSource {
        lines: vec!["a".into(), "b".into()],
        ..Default::default()
    };
    run_function(&f, &mut sink, &mut source).unwrap();
}
