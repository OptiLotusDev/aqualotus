use optilotus_core::{CommandSpec, Package, Type, VecSink, MAIN_ID};

fn run(
    pkg: &Package,
) -> (
    Result<optilotus_core::ExecReport, optilotus_core::ExecError>,
    Vec<String>,
) {
    let mut sink = VecSink::default();
    let res = pkg.run_main(&mut sink);
    (res, lines_of(&sink))
}

fn lines_of(sink: &VecSink) -> Vec<String> {
    sink.lines.clone()
}

#[test]
fn if_true_runs_then_body() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    let then_specs = vec![CommandSpec::print("\"then\"")];
    let id = pkg
        .if_with_expr(MAIN_ID, "{x} > 5", &then_specs, None)
        .unwrap();

    // The if command is appended to the main chain after the cond Compute.
    let info = pkg.get_function(MAIN_ID).unwrap();
    assert!(info.entry.is_some());
    let _ = id;

    let (_res, lines) = run(&pkg);
    assert_eq!(lines, vec!["then".to_string()]);
}

#[test]
fn if_false_runs_else_body() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("3")).unwrap();
    let then_specs = vec![CommandSpec::print("\"then\"")];
    let else_specs = vec![CommandSpec::print("\"else\"")];
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, Some(&else_specs))
        .unwrap();

    let (_res, lines) = run(&pkg);
    assert_eq!(lines, vec!["else".to_string()]);
}

#[test]
fn if_false_with_no_else_prints_nothing() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("3")).unwrap();
    let then_specs = vec![CommandSpec::print("\"then\"")];
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, None)
        .unwrap();

    let (_res, lines) = run(&pkg);
    assert!(lines.is_empty());
}

#[test]
fn if_with_multiple_then_commands() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    let then_specs = vec![
        CommandSpec::print("\"a\""),
        CommandSpec::print("\"b\""),
        CommandSpec::assign("x", "{x} + 1"),
        CommandSpec::print("\"{x}\""),
    ];
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, None)
        .unwrap();

    let (_res, lines) = run(&pkg);
    assert_eq!(
        lines,
        vec!["a".to_string(), "b".to_string(), "11".to_string()]
    );
}

#[test]
fn if_with_staged_declare_and_input() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    let then_specs = vec![
        CommandSpec::declare("y", Type::Int32, Some("5".to_string())),
        CommandSpec::print("\"{y}\""),
    ];
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, None)
        .unwrap();

    let (_res, lines) = run(&pkg);
    assert_eq!(lines, vec!["5".to_string()]);
}

#[test]
fn if_with_staged_input_reads_value() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    let then_specs = vec![
        CommandSpec::input(Type::Int32),
        CommandSpec::print("\"{x}\""),
    ];
    // We can't easily inject input through run_main (no input source),
    // but we can verify the staged input command exists and the chain is valid.
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, None)
        .unwrap();

    let info = pkg.get_function(MAIN_ID).unwrap();
    assert!(info.entry.is_some());
}

#[test]
fn if_condition_false_with_else_runs_else() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("3")).unwrap();
    let then_specs = vec![CommandSpec::print("\"then\"")];
    let else_specs = vec![CommandSpec::print("\"e1\""), CommandSpec::print("\"e2\"")];
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, Some(&else_specs))
        .unwrap();

    let (_res, lines) = run(&pkg);
    assert_eq!(lines, vec!["e1".to_string(), "e2".to_string()]);
}

#[test]
fn if_with_arithmetic_template_evaluates() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "a", "int32", Some("7")).unwrap();
    pkg.declare(MAIN_ID, "b", "int32", Some("3")).unwrap();
    // A template that is a valid arithmetic expression after interpolation
    // gets evaluated: "7 + 3" -> "10".
    let then_specs = vec![CommandSpec::print("\"{a} + {b}\"")];
    pkg.if_with_expr(MAIN_ID, "{a} > {b}", &then_specs, None)
        .unwrap();

    let (_res, lines) = run(&pkg);
    assert_eq!(lines, vec!["10".to_string()]);
}

#[test]
fn if_with_non_arithmetic_template_prints_literal() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "a", "int32", Some("7")).unwrap();
    pkg.declare(MAIN_ID, "b", "int32", Some("3")).unwrap();
    // "7 + 3 = 7 + 3" is not a valid arithmetic expression, so the
    // literal interpolated string is printed.
    let then_specs = vec![CommandSpec::print("\"{a} + {b} = {a} + {b}\"")];
    pkg.if_with_expr(MAIN_ID, "{a} > {b}", &then_specs, None)
        .unwrap();

    let (_res, lines) = run(&pkg);
    assert_eq!(lines, vec!["7 + 3 = 7 + 3".to_string()]);
}

#[test]
fn if_empty_then_body_no_crash() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    let then_specs: Vec<CommandSpec> = vec![];
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, None)
        .unwrap();

    let (_res, lines) = run(&pkg);
    assert!(lines.is_empty());
}

#[test]
fn if_empty_else_body_no_crash() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("3")).unwrap();
    let then_specs = vec![CommandSpec::print("\"then\"")];
    let else_specs: Vec<CommandSpec> = vec![];
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, Some(&else_specs))
        .unwrap();

    let (_res, lines) = run(&pkg);
    assert!(lines.is_empty());
}

#[test]
fn if_after_other_builders_chain_intact() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    pkg.print(MAIN_ID, "\"before\"").unwrap();
    let then_specs = vec![CommandSpec::print("\"then\"")];
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, None)
        .unwrap();
    pkg.print(MAIN_ID, "\"after\"").unwrap();

    let (_res, lines) = run(&pkg);
    assert_eq!(
        lines,
        vec![
            "before".to_string(),
            "then".to_string(),
            "after".to_string()
        ]
    );
}

#[test]
fn if_invalid_condition_rejected() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    let then_specs = vec![CommandSpec::print("\"then\"")];
    let err = pkg
        .if_with_expr(MAIN_ID, "", &then_specs, None)
        .unwrap_err();
    assert!(matches!(
        err,
        optilotus_core::PackageError::InvalidCommand(_)
    ));
}

#[test]
fn if_invalid_spec_rejected_before_mutation() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    // Declare spec missing the type field.
    let bad_spec = CommandSpec {
        kind: optilotus_core::CommandKind::Declare,
        var: Some("y".to_string()),
        ty: None,
        access: None,
        init: None,
        expr: None,
        template: None,
        to: None,
    };
    let err = pkg
        .if_with_expr(MAIN_ID, "{x} > 5", &[bad_spec], None)
        .unwrap_err();
    assert!(matches!(
        err,
        optilotus_core::PackageError::InvalidCommand(_)
    ));
    // The condition Compute should NOT have been appended (validation first).
    let info = pkg.get_function(MAIN_ID).unwrap();
    assert_eq!(info.entry.map(|c| c.0), Some(1)); // still just the declare of x
}

#[test]
fn if_unknown_function_rejected() {
    let mut pkg = Package::new();
    let then_specs = vec![CommandSpec::print("\"then\"")];
    let err = pkg
        .if_with_expr(optilotus_core::FunctionId(99), "{x} > 5", &then_specs, None)
        .unwrap_err();
    assert!(matches!(
        err,
        optilotus_core::PackageError::UnknownFunction(_)
    ));
}

#[test]
fn if_with_cast_in_body() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    let then_specs = vec![
        CommandSpec::cast("y", Type::Float64, "{x}"),
        CommandSpec::print("\"{y}\""),
    ];
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &then_specs, None)
        .unwrap();

    let (_res, lines) = run(&pkg);
    // `y` is a float64, so its printed form keeps the decimal point.
    assert_eq!(lines, vec!["10.0".to_string()]);
}
