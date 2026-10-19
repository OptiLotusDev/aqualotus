use optilotus::{Package, VecSink, MAIN_ID};

fn run(
    pkg: &Package,
) -> (
    Result<optilotus::ExecReport, optilotus::ExecError>,
    Vec<String>,
) {
    let mut sink = VecSink::default();
    let res = pkg.run_main(&mut sink);
    (res, sink.lines)
}

#[test]
fn cast_builder_runs_end_to_end() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("41")).unwrap();
    let _cast_id = pkg.cast(MAIN_ID, "y", "int32", "{x}").unwrap();

    // The cast head is the Set command; the chain must include the
    // Compute and Cast commands (entry must not point at the Set).
    let info = pkg.get_function(MAIN_ID).unwrap();
    assert_eq!(info.entry.map(|c| c.0), Some(1)); // entry = first declare's Lit

    let (_res, lines) = run(&pkg);
    assert_eq!(lines, Vec::<String>::new());
}

#[test]
fn cast_then_assign_same_var_works() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    pkg.cast(MAIN_ID, "y", "int32", "{x}").unwrap();
    pkg.assign(MAIN_ID, "y", "{x} + 41").unwrap();

    let (_res, lines) = run(&pkg);
    assert_eq!(lines, Vec::<String>::new());
}

#[test]
fn cast_then_print_value() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("41")).unwrap();
    pkg.cast(MAIN_ID, "y", "int32", "{x}").unwrap();
    pkg.print(MAIN_ID, "\"{y}\"").unwrap();

    let (_res, lines) = run(&pkg);
    assert_eq!(lines, vec!["41".to_string()]);
}

#[test]
fn cast_duplicate_rejected() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    pkg.cast(MAIN_ID, "y", "int32", "{x}").unwrap();
    let err = pkg.cast(MAIN_ID, "y", "int64", "{x}").unwrap_err();
    assert!(matches!(err, optilotus::PackageError::DuplicateVariable(_)));
}

#[test]
fn declare_after_cast_duplicate_rejected() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    pkg.cast(MAIN_ID, "y", "int32", "{x}").unwrap();
    let err = pkg.declare(MAIN_ID, "y", "int32", Some("5")).unwrap_err();
    assert!(matches!(err, optilotus::PackageError::DuplicateVariable(_)));
}

#[test]
fn cast_after_declare_duplicate_rejected() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    pkg.declare(MAIN_ID, "y", "int32", Some("2")).unwrap();
    let err = pkg.cast(MAIN_ID, "y", "int64", "{x}").unwrap_err();
    assert!(matches!(err, optilotus::PackageError::DuplicateVariable(_)));
}

#[test]
fn cast_changes_variable_type() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("41")).unwrap();
    pkg.cast(MAIN_ID, "f", "float64", "{x}").unwrap();
    pkg.print(MAIN_ID, "\"{f}\"").unwrap();

    let (_res, lines) = run(&pkg);
    // `f` is a float64, so its printed form keeps the decimal point.
    assert_eq!(lines, vec!["41.0".to_string()]);
}

#[test]
fn cast_chain_intact_after_other_builders() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    pkg.cast(MAIN_ID, "y", "int32", "{x}").unwrap();
    // Build more commands AFTER the cast — the chain must stay intact.
    pkg.declare(MAIN_ID, "z", "int32", Some("3")).unwrap();
    pkg.assign(MAIN_ID, "z", "{z} + {y}").unwrap();

    let info = pkg.get_function(MAIN_ID).unwrap();
    // entry should be the declare of x (id 1), not corrupted by the cast.
    assert_eq!(info.entry.map(|c| c.0), Some(1));
}

#[test]
fn cast_list_commands_shows_cast_row() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    pkg.cast(MAIN_ID, "y", "int32", "{x}").unwrap();
    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    let cast_row = cmds.iter().find(|c| c.kind == optilotus::CommandKind::Cast);
    assert!(
        cast_row.is_some(),
        "cast row should appear in list_commands"
    );
}
