use optilotus::{ExecError, Package, VecSink, MAIN_ID};

#[test]
fn call_in_expression_uses_return_value() {
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();
    // helper returns 41 (int literal narrows to int32)
    pkg.return_(helper, "41").unwrap();

    pkg.declare(MAIN_ID, "x", "int32", Some("0")).unwrap();
    pkg.assign(MAIN_ID, "x", "helper()").unwrap();
    pkg.print(MAIN_ID, "\"{x}\"").unwrap();

    let mut sink = VecSink::default();
    let report = pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["41".to_string()]);
    assert_eq!(report.prints, 1);
}

#[test]
fn string_return_travels_through_call() {
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();
    pkg.return_(helper, "\"hi\"").unwrap();

    pkg.declare(MAIN_ID, "s", "string", Some("")).unwrap();
    pkg.assign(MAIN_ID, "s", "helper()").unwrap();
    pkg.print(MAIN_ID, "\"{s}!\"").unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["hi!".to_string()]);
}

#[test]
fn call_result_participates_in_arithmetic() {
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();
    pkg.return_(helper, "40").unwrap();

    pkg.declare(MAIN_ID, "x", "int32", Some("0")).unwrap();
    pkg.assign(MAIN_ID, "x", "helper() + 2").unwrap();
    pkg.print(MAIN_ID, "\"{x}\"").unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["42".to_string()]);
}

#[test]
fn unknown_function_is_typed() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("0")).unwrap();
    pkg.assign(MAIN_ID, "x", "ghost()").unwrap();

    let mut sink = VecSink::default();
    let err = pkg.run_main(&mut sink).unwrap_err();
    assert!(matches!(err, ExecError::UnknownFunction { .. }));
}

#[test]
fn missing_return_is_typed() {
    let mut pkg = Package::new();
    let helper = pkg.create_function("noreturn").unwrap();
    // no Return: only a print (prints don't produce a value)
    pkg.print(helper, "\"hi\"").unwrap();

    pkg.declare(MAIN_ID, "x", "int32", Some("0")).unwrap();
    pkg.assign(MAIN_ID, "x", "noreturn()").unwrap();

    let mut sink = VecSink::default();
    let err = pkg.run_main(&mut sink).unwrap_err();
    assert!(matches!(err, ExecError::MissingReturn { .. }));
}

#[test]
fn recursion_hits_limit() {
    let mut pkg = Package::new();
    let loopy = pkg.create_function("loopy").unwrap();
    // direct self-recursion via expression call
    pkg.declare(loopy, "x", "int32", Some("0")).unwrap();
    pkg.assign(loopy, "x", "loopy()").unwrap();
    pkg.return_(loopy, "{x}").unwrap();

    pkg.declare(MAIN_ID, "y", "int32", Some("0")).unwrap();
    pkg.assign(MAIN_ID, "y", "loopy()").unwrap();

    let mut sink = VecSink::default();
    let err = pkg.run_main_with_limit(&mut sink, 500).unwrap_err();
    assert!(matches!(err, ExecError::LoopLimit { .. }));
}

#[test]
fn cannot_call_main() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("0")).unwrap();
    pkg.assign(MAIN_ID, "x", "main()").unwrap();

    let mut sink = VecSink::default();
    let err = pkg.run_main(&mut sink).unwrap_err();
    // entry-only: surfaces as an expression error, not a silent run
    assert!(matches!(err, ExecError::ExprError { .. }));
}

#[test]
fn callee_prints_share_sink() {
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();
    pkg.print(helper, "\"from-helper\"").unwrap();
    pkg.return_(helper, "1").unwrap();

    pkg.declare(MAIN_ID, "x", "int32", Some("0")).unwrap();
    pkg.assign(MAIN_ID, "x", "helper()").unwrap();
    pkg.print(MAIN_ID, "\"from-main\"").unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(
        sink.lines,
        vec!["from-helper".to_string(), "from-main".to_string()]
    );
}
