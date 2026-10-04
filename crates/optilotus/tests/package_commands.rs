use optilotus::{run_function, CommandKind, Package, VecSink, MAIN_ID};

#[test]
fn build_main_via_api_lists_back() {
    let mut pkg = Package::new();
    let d = pkg.declare(MAIN_ID, "n", "int32", Some("41")).unwrap();
    let a = pkg.assign(MAIN_ID, "n", "{n} + 1").unwrap();
    let p = pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(cmds.len(), 3);
    assert_eq!(cmds[0].id, d);
    assert_eq!(cmds[0].kind, CommandKind::Declare);
    assert_eq!(cmds[0].var.as_deref(), Some("n"));
    assert_eq!(cmds[0].next, Some(a));
    assert_eq!(cmds[1].id, a);
    assert_eq!(cmds[1].kind, CommandKind::Assign);
    assert_eq!(cmds[1].next, Some(p));
    assert_eq!(cmds[2].id, p);
    assert_eq!(cmds[2].kind, CommandKind::Print);
    assert_eq!(cmds[2].next, None);

    let info = pkg.get_function(MAIN_ID).unwrap();
    assert_eq!(info.command_count, 3);
    assert_eq!(info.entry, Some(d));
}

#[test]
fn declare_without_init_uses_zero_default() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", None).unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();
    pkg.declare(MAIN_ID, "s", "string", None).unwrap();
    pkg.print(MAIN_ID, "\"<{s}>\"").unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["0".to_string(), "<>".to_string()]);
}

#[test]
fn delete_middle_of_chain_repairs_link() {
    let mut pkg = Package::new();
    let a = pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    let b = pkg.print(MAIN_ID, "\"{n}\"").unwrap();
    let c = pkg.print(MAIN_ID, "\"done\"").unwrap();

    // Delete the reachable middle: a -> c must hold afterwards.
    pkg.delete_command(MAIN_ID, b).unwrap();
    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(cmds.len(), 2);
    assert_eq!(cmds[0].id, a);
    assert_eq!(cmds[0].next, Some(c));
    assert_eq!(cmds[1].id, c);
    assert_eq!(cmds[1].next, None);

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["done".to_string()]);
}

#[test]
fn delete_entry_moves_entry_to_successor() {
    let mut pkg = Package::new();
    let a = pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    let b = pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    pkg.delete_command(MAIN_ID, a).unwrap();
    let info = pkg.get_function(MAIN_ID).unwrap();
    assert_eq!(info.entry, Some(b));

    // b alone needs `n`, which died with `a`: the error names the block.
    let mut sink = VecSink::default();
    let err = pkg.run_main(&mut sink).unwrap_err();
    assert!(matches!(err, optilotus::ExecError::UnknownVariable { .. }));
}

#[test]
fn set_next_then_run_program_uses_product_path() {
    let mut pkg = Package::new();
    let a = pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    let b = pkg.print(MAIN_ID, "\"{n}\"").unwrap();
    let c = pkg.print(MAIN_ID, "\"done\"").unwrap();

    pkg.set_next(MAIN_ID, a, Some(c)).unwrap();
    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(cmds[0].next, Some(c));

    // Same rewire through `run_main` (the `runProgram` product path).
    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["done".to_string()]);
    let _ = b;
}

#[test]
fn clear_entry_empties_run_but_keeps_commands() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    pkg.set_entry(MAIN_ID, None).unwrap();
    assert!(pkg.get_function(MAIN_ID).unwrap().entry.is_none());
    // Commands are kept (as orphans); the run is a no-op.
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 2);
    let mut sink = VecSink::default();
    let report = pkg.run_main(&mut sink).unwrap();
    assert_eq!(report.steps, 0);
    assert!(sink.lines.is_empty());
}

#[test]
fn entry_next_chain_runs_with_existing_path() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("41")).unwrap();
    pkg.assign(MAIN_ID, "n", "{n} + 1").unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    let func = pkg.function(MAIN_ID).unwrap().clone();
    let mut sink = VecSink::default();
    let report = run_function(&func, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["42".to_string()]);
    assert_eq!(report.prints, 1);
}

#[test]
fn declare_assign_validation() {
    let mut pkg = Package::new();
    // assign before declare fails
    assert!(pkg.assign(MAIN_ID, "x", "1").is_err());
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    // duplicate declare fails
    assert!(pkg.declare(MAIN_ID, "x", "int32", Some("2")).is_err());
    // bad type + void rejected
    assert!(pkg.declare(MAIN_ID, "y", "nope", Some("1")).is_err());
    assert!(pkg.declare(MAIN_ID, "v", "void", None).is_err());
}

#[test]
fn set_entry_set_next_delete_command() {
    let mut pkg = Package::new();
    let a = pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    let b = pkg.print(MAIN_ID, "\"{n}\"").unwrap();
    let c = pkg.print(MAIN_ID, "\"done\"").unwrap();
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 3);

    // Rewire a -> c (skip b)
    pkg.set_next(MAIN_ID, a, Some(c)).unwrap();
    let func = pkg.function(MAIN_ID).unwrap().clone();
    let mut sink = VecSink::default();
    run_function(&func, &mut sink).unwrap();
    // declare has no print; b skipped so only "done" prints
    assert_eq!(sink.lines, vec!["done".to_string()]);

    // Delete b (orphaned by the rewire), chain stays a -> c
    pkg.delete_command(MAIN_ID, b).unwrap();
    assert_eq!(pkg.list_commands(MAIN_ID).unwrap().len(), 2);

    // Entry to c alone prints "done" (no variables needed)
    pkg.set_entry(MAIN_ID, Some(c)).unwrap();
    let func = pkg.function(MAIN_ID).unwrap().clone();
    assert_eq!(func.entry, Some(c));
    let mut sink = VecSink::default();
    run_function(&func, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["done".to_string()]);
}

#[test]
fn return_builder_lists_and_stops() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    let r = pkg.return_(MAIN_ID, "{n}").unwrap();
    let after = pkg.print(MAIN_ID, "\"unreached\"").unwrap();
    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(cmds.len(), 3);
    assert_eq!(cmds[1].kind, CommandKind::Return);
    assert_eq!(cmds[1].id, r);

    // Return stops before `after`
    let func = pkg.function(MAIN_ID).unwrap().clone();
    let mut sink = VecSink::default();
    let (report, returned) = optilotus::run_function_returning(&func, &mut sink).unwrap();
    assert_eq!(report.prints, 0);
    assert_eq!(returned, Some(optilotus::Value::Int32(1)));
    let _ = after;
}
