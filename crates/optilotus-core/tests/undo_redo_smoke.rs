use optilotus_core::{Package, VecSink, MAIN_ID};

#[test]
fn undo_redo_empty_no_error() {
    let mut pkg = Package::new();
    assert!(pkg.undo().is_none());
    assert!(pkg.redo().is_none());
    assert!(pkg.undo().is_none());
    assert!(pkg.redo().is_none());
}

#[test]
fn undo_redo_declare() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("41")).unwrap();
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 1);

    let desc = pkg.undo().unwrap();
    assert!(desc.contains("Declare"));
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 0);

    let desc = pkg.redo().unwrap();
    assert!(desc.contains("Declare"));
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 1);
}

#[test]
fn undo_chain() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("41")).unwrap();
    pkg.assign(MAIN_ID, "n", "{n} + 1").unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 3);

    pkg.undo().unwrap();
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 2);

    pkg.undo().unwrap();
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 1);

    pkg.redo().unwrap();
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 2);

    pkg.redo().unwrap();
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 3);
}

#[test]
fn undo_redo_exec() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("41")).unwrap();
    pkg.assign(MAIN_ID, "n", "{n} + 1").unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    pkg.undo().unwrap();
    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, Vec::<String>::new());

    pkg.redo().unwrap();
    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["42".to_string()]);
}
