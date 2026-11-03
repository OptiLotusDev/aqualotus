use optilotus::{
    CommandKind, Package, PackageError, RunSession, RunStatus, Type, Value, VecSink, VecSource,
    MAIN_ID,
};

fn source(lines: &[&str]) -> VecSource {
    VecSource {
        lines: lines.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    }
}

#[test]
fn input_into_binds_the_read_value() {
    let mut pkg = Package::new();
    let input = pkg.input_into(MAIN_ID, "n", "int32").unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(cmds.len(), 2);
    assert_eq!(cmds[0].id, input);
    assert_eq!(cmds[0].kind, CommandKind::Input);
    assert_eq!(cmds[0].var.as_deref(), Some("n"));
    assert_eq!(cmds[0].ty, Some(Type::Int32));
    // The hidden `Set` pair tail is never a user-visible command; the
    // user edge skips it and lands on the print.
    assert_eq!(cmds[0].next, Some(cmds[1].id));
    assert_eq!(pkg.get_function(MAIN_ID).unwrap().command_count, 2);
    assert_ne!(cmds[0].id, cmds[1].id);
    assert_eq!(cmds[1].kind, CommandKind::Print);
    assert_eq!(cmds[1].next, None);

    let mut sink = VecSink::default();
    let mut input = source(&["7"]);
    pkg.run_main_with_input(&mut sink, &mut input).unwrap();
    assert_eq!(sink.lines, vec!["7".to_string()]);
}

#[test]
fn input_into_registers_a_variable_for_assign() {
    let mut pkg = Package::new();
    pkg.input_into(MAIN_ID, "n", "int32").unwrap();
    pkg.assign(MAIN_ID, "n", "{n} + 1").unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    let mut sink = VecSink::default();
    let mut input = source(&["41"]);
    pkg.run_main_with_input(&mut sink, &mut input).unwrap();
    assert_eq!(sink.lines, vec!["42".to_string()]);
}

#[test]
fn input_into_rejects_a_duplicate_variable_name() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", None).unwrap();
    assert_eq!(
        pkg.input_into(MAIN_ID, "n", "int32"),
        Err(PackageError::DuplicateVariable("n".to_string()))
    );

    pkg.input_into(MAIN_ID, "other", "int32").unwrap();
    assert_eq!(
        pkg.input_into(MAIN_ID, "other", "string"),
        Err(PackageError::DuplicateVariable("other".to_string()))
    );
}

#[test]
fn input_into_rejects_void_and_bad_names() {
    let mut pkg = Package::new();
    assert!(matches!(
        pkg.input_into(MAIN_ID, "n", "void"),
        Err(PackageError::InvalidCommand(_))
    ));
    assert!(matches!(
        pkg.input_into(MAIN_ID, "", "int32"),
        Err(PackageError::InvalidName(_))
    ));
}

#[test]
fn deleting_an_input_into_repairs_the_chain() {
    let mut pkg = Package::new();
    let read = pkg.input_into(MAIN_ID, "n", "int32").unwrap();
    let print = pkg.print(MAIN_ID, "\"done\"").unwrap();

    pkg.delete_command(MAIN_ID, read).unwrap();
    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(cmds.len(), 1);
    assert_eq!(cmds[0].id, print);
    assert_eq!(cmds[0].next, None);
    assert_eq!(pkg.get_function(MAIN_ID).unwrap().entry, Some(print));

    // The whole hidden pair is gone: no stray value is read.
    let mut sink = VecSink::default();
    let report = pkg.run_main(&mut sink).unwrap();
    assert_eq!(report.steps, 2);
    assert_eq!(sink.lines, vec!["done".to_string()]);
}

#[test]
fn resumable_run_pauses_then_returns_the_read_value() {
    let mut pkg = Package::new();
    let read = pkg.input_into(MAIN_ID, "n", "int32").unwrap();
    pkg.return_(MAIN_ID, "{n}").unwrap();

    let mut session = RunSession::start(pkg.as_program());
    assert_eq!(
        session.status(),
        RunStatus::WaitingInput {
            command: read,
            ty: Type::Int32,
            printed: vec![],
        }
    );

    match session.provide_input("9") {
        RunStatus::Finished { returned, .. } => {
            assert_eq!(returned, Some(Value::Int32(9)));
        }
        other => panic!("expected finished, got {other:?}"),
    }
}
