//! Variable access modifiers.
//!
//! `declare` accepts `public`, `protected` or `private`. The modifier is
//! recorded and surfaced through `list_commands`, but it is **not yet
//! enforced**: there is exactly one package and no classes, so `public`
//! and `protected` both mean "usable by every function in the package",
//! and `private` matches the runtime's existing per-call variable scope.
//!
//! These tests pin the parts that are real today — parsing, storage,
//! round-tripping, the default, and rejection of bad input — so the
//! enforcement work has a fixed contract to build on.

use optilotus::{Access, CommandSpec, Package, MAIN_ID};

#[test]
fn access_tags_round_trip() {
    for tag in ["public", "protected", "private"] {
        let access = Access::parse_tag(tag).expect("known tag");
        assert_eq!(access.tag(), tag);
    }
}

#[test]
fn unknown_access_tag_is_rejected() {
    assert!(Access::parse_tag("internal").is_none());
    assert!(Access::parse_tag("").is_none());
    assert!(Access::parse_tag("Public").is_none());
}

#[test]
fn default_access_is_private() {
    // The default must match the runtime's existing behaviour: a variable
    // is visible only inside the function that declares it.
    assert_eq!(Access::default(), Access::Private);
}

#[test]
fn declare_defaults_to_private_and_records_it() {
    let mut pkg = Package::new();
    let id = pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();

    let commands = pkg.list_commands(MAIN_ID).unwrap();
    let declared = commands
        .iter()
        .find(|c| c.id == id)
        .expect("declared command present");
    assert_eq!(declared.access, Some(Access::Private));
}

#[test]
fn declare_with_each_access_records_that_access() {
    for access in [Access::Public, Access::Protected, Access::Private] {
        let mut pkg = Package::new();
        let id = pkg
            .declare_with_access(MAIN_ID, "x", "int32", Some("1"), access)
            .unwrap();

        let commands = pkg.list_commands(MAIN_ID).unwrap();
        let declared = commands.iter().find(|c| c.id == id).expect("present");
        assert_eq!(declared.access, Some(access), "for {access:?}");
    }
}

#[test]
fn non_declare_kinds_carry_no_access() {
    // Access is a declare-only property; other summaries must omit it so
    // the wire stays tight.
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    let assign_id = pkg.assign(MAIN_ID, "x", "{x} + 1").unwrap();
    let print_id = pkg.print(MAIN_ID, "\"{x}\"").unwrap();

    let commands = pkg.list_commands(MAIN_ID).unwrap();
    for id in [assign_id, print_id] {
        let cmd = commands.iter().find(|c| c.id == id).expect("present");
        assert_eq!(cmd.access, None, "kind {:?} should omit access", cmd.kind);
    }
}

#[test]
fn access_does_not_change_execution() {
    // Not enforced yet: the same program must produce the same output
    // regardless of the modifier. When enforcement lands, this test is
    // the one to revisit deliberately.
    let run_with = |access: Access| {
        let mut pkg = Package::new();
        pkg.declare_with_access(MAIN_ID, "x", "int32", Some("41"), access)
            .unwrap();
        pkg.print(MAIN_ID, "\"{x}\"").unwrap();
        let mut sink = optilotus::VecSink::default();
        pkg.run_main(&mut sink).unwrap();
        sink.lines
    };

    let public = run_with(Access::Public);
    let protected = run_with(Access::Protected);
    let private = run_with(Access::Private);
    assert_eq!(public, vec!["41".to_string()]);
    assert_eq!(public, protected);
    assert_eq!(public, private);
}

#[test]
fn if_body_declare_rejects_non_default_access() {
    // A body variable is branch-scoped and never appears in
    // list_commands, so a wider visibility has nothing to mean. Reject it
    // rather than silently dropping it.
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();

    let mut spec = CommandSpec::declare("y", optilotus::Type::Int32, None);
    spec.access = Some(Access::Public);
    let err = pkg
        .if_with_expr(MAIN_ID, "{x} > 5", &[spec], None)
        .unwrap_err();
    let message = err.to_string();
    assert!(
        message.contains("not supported on an if-body declare"),
        "unexpected error: {message}"
    );
}

#[test]
fn if_body_declare_accepts_default_access() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();

    let mut spec = CommandSpec::declare("y", optilotus::Type::Int32, None);
    spec.access = Some(Access::Private);
    pkg.if_with_expr(MAIN_ID, "{x} > 5", &[spec], None)
        .expect("private is the default and must be accepted");
}
