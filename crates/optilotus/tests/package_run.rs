use optilotus::{run_program, Package, VecSink, MAIN_ID};

#[test]
fn run_program_runs_main_by_id() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("41")).unwrap();
    pkg.assign(MAIN_ID, "n", "{n} + 1").unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    let mut sink = VecSink::default();
    let report = pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["42".to_string()]);
    assert_eq!(report.prints, 1);
}

#[test]
fn run_program_bridge_envelope() {
    optilotus::package_clear();
    optilotus::package_declare(0, "n", "int32", Some("41".to_string()));
    optilotus::package_assign(0, "n", "{n} + 1");
    optilotus::package_print(0, "\"{n}\"");
    let out: serde_json::Value = serde_json::from_str(&run_program()).unwrap();
    assert_eq!(out["status"], "ok");
    assert_eq!(out["printed"], serde_json::json!(["42"]));
    assert_eq!(out["prints"], 1);
}

#[test]
fn run_program_reports_errors_with_command() {
    optilotus::package_clear();
    // print of unknown variable: bridge envelope carries the block id
    optilotus::package_print(0, "\"hi {ghost}\"");
    let out: serde_json::Value = serde_json::from_str(&run_program()).unwrap();
    assert_eq!(out["status"], "error");
    assert_eq!(out["kind"], "UnknownVariable");
    assert!(out["command"].is_number());
}

#[test]
fn assign_math_expression_evaluates_and_stores_result() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    pkg.declare(MAIN_ID, "y", "int32", Some("5")).unwrap();
    pkg.declare(MAIN_ID, "z", "int32", None).unwrap();
    pkg.assign(MAIN_ID, "z", "{x} + {y}").unwrap();
    pkg.print(MAIN_ID, "\"{z}\"").unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["15".to_string()]);
}

#[test]
fn assign_math_expression_with_operators() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "a", "int32", Some("20")).unwrap();
    pkg.declare(MAIN_ID, "b", "int32", Some("4")).unwrap();
    pkg.declare(MAIN_ID, "result", "int32", None).unwrap();
    pkg.assign(MAIN_ID, "result", "{a} * {b} - 2").unwrap();
    pkg.print(MAIN_ID, "\"{result}\"").unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["78".to_string()]);
}

#[test]
fn print_template_evaluates_math_expression() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    pkg.declare(MAIN_ID, "y", "int32", Some("5")).unwrap();
    pkg.print(MAIN_ID, "\"{x} + {y}\"").unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["15".to_string()]);
}
