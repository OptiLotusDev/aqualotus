use optilotus::{Package, PackageError, VecSink, MAIN_ID};

#[test]
fn rename_helper_preserves_identity_and_commands() {
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();
    pkg.declare(helper, "n", "int32", Some("7")).unwrap();
    pkg.print(helper, "\"{n}\"").unwrap();

    pkg.try_rename(helper, "renamed").unwrap();

    let info = pkg.get_function(helper).unwrap();
    assert_eq!(info.id, helper);
    assert_eq!(info.name, "renamed");
    assert_eq!(info.command_count, 2);

    // Renamed function still runs identically.
    let before = pkg.function(helper).unwrap().clone();
    assert_eq!(before.id, helper);
    assert_eq!(before.name, "renamed");

    let mut sink = VecSink::default();
    optilotus::run_function(&before, &mut sink).unwrap();
    assert_eq!(sink.lines, vec!["7".to_string()]);
}

#[test]
fn rename_main_to_custom_name_keeps_entry_working() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    pkg.try_rename(MAIN_ID, "start").unwrap();

    let info = pkg.get_function(MAIN_ID).unwrap();
    assert_eq!(info.id, MAIN_ID);
    assert_eq!(info.name, "start");

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
}

#[test]
fn rename_to_same_name_is_ok() {
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();
    pkg.try_rename(helper, "helper").unwrap();
    pkg.try_rename(helper, "  helper  ").unwrap();
    assert_eq!(pkg.get_function(helper).unwrap().name, "helper");
}

#[test]
fn rename_rejects_duplicates() {
    let mut pkg = Package::new();
    let a = pkg.create_function("alpha").unwrap();
    pkg.create_function("beta").unwrap();
    let err = pkg.try_rename(a, "beta").unwrap_err();
    assert_eq!(err, PackageError::DuplicateName("beta".to_string()));
    // Failed rename leaves the original name untouched.
    assert_eq!(pkg.get_function(a).unwrap().name, "alpha");
}

#[test]
fn rename_rejects_reserved_and_invalid_names() {
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();
    assert_eq!(
        pkg.try_rename(helper, "main").unwrap_err(),
        PackageError::ReservedName("main".to_string())
    );
    assert!(matches!(
        pkg.try_rename(helper, "   ").unwrap_err(),
        PackageError::InvalidName(_)
    ));
    assert!(matches!(
        pkg.try_rename(helper, "bad{name}").unwrap_err(),
        PackageError::InvalidName(_)
    ));
    assert_eq!(pkg.get_function(helper).unwrap().name, "helper");
}

#[test]
fn rename_unknown_function_is_typed() {
    let mut pkg = Package::new();
    let err = pkg
        .try_rename(optilotus::FunctionId(999), "ghost")
        .unwrap_err();
    assert_eq!(
        err,
        PackageError::UnknownFunction(optilotus::FunctionId(999))
    );
}
