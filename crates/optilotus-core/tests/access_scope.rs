//! Scope tests for variable access modifiers.
//!
//! These probe what `private` actually does today. The answer, recorded
//! honestly: **nothing yet**. Variables are already function-local — each
//! call gets a fresh scope — so `private` describes existing behaviour
//! rather than changing it. `public` and `protected` are likewise
//! indistinguishable with one package.
//!
//! The tests below therefore do two jobs:
//!   1. Pin the scope behaviour that *is* real (variables do not leak
//!      between functions, and a helper cannot see its caller's locals).
//!   2. Pin that the modifier itself is inert, so the day enforcement
//!      lands these tests fail loudly and get revisited deliberately.
//!
//! Note on *when* scope is enforced: `print` does not validate variable
//! names at build time (it only checks the function exists), so a
//! reference to an undeclared variable builds successfully and fails at
//! run time with `UnknownVariable`. That is pre-existing behaviour, not a
//! consequence of access modifiers, so these tests assert the run-time
//! outcome rather than a build-time rejection.

use optilotus_core::{Access, Package, VecSink, VecSource, MAIN_ID};

/// Declare `name` in `fid` with `access`, then print it.
fn declare_and_print(
    pkg: &mut Package,
    fid: optilotus_core::FunctionId,
    name: &str,
    access: Access,
) {
    pkg.declare_with_access(fid, name, "int32", Some("7"), access)
        .expect("declare");
    pkg.print(fid, &format!("\"{name} = {{{name}}}\""))
        .expect("print");
}

/// Run one function on its own and return its printed lines.
///
/// `Package` only exposes `run_main`, so a helper is run through the
/// `Program` snapshot: the headless path the crate documents for native
/// consumers, which keeps each function's scope isolated.
fn run(pkg: &Package, fid: optilotus_core::FunctionId) -> Vec<String> {
    run_result(pkg, fid).expect("run should succeed")
}

/// Run one function, returning the error if it fails.
fn run_result(
    pkg: &Package,
    fid: optilotus_core::FunctionId,
) -> Result<Vec<String>, optilotus_core::ExecError> {
    let program = pkg.as_program();
    let function = program
        .functions
        .iter()
        .find(|f| f.id == fid)
        .expect("function present");
    let mut sink = VecSink::default();
    let mut source = VecSource::default();
    optilotus_core::run_function(function, &mut sink, &mut source)?;
    Ok(sink.lines)
}

#[test]
fn two_functions_each_own_a_private_variable_of_the_same_name() {
    // `alpha` and `beta` both declare a *private* `x`. Because variables
    // are per-function, the two never collide: the engine's duplicate
    // check is scoped to one function.
    let mut pkg = Package::new();
    let alpha = pkg.create_function("alpha").unwrap();
    let beta = pkg.create_function("beta").unwrap();

    declare_and_print(&mut pkg, alpha, "x", Access::Private);
    declare_and_print(&mut pkg, beta, "x", Access::Private);

    assert_eq!(run(&pkg, alpha), vec!["x = 7".to_string()]);
    assert_eq!(run(&pkg, beta), vec!["x = 7".to_string()]);
}

#[test]
fn a_private_variable_is_not_visible_to_a_sibling_function() {
    // `alpha` declares private `x`; `beta` prints `x` without declaring
    // it. The reference builds (print does not validate names) but fails
    // at run time: a private variable does not cross into another
    // function.
    let mut pkg = Package::new();
    let alpha = pkg.create_function("alpha").unwrap();
    let beta = pkg.create_function("beta").unwrap();

    pkg.declare_with_access(alpha, "x", "int32", Some("7"), Access::Private)
        .unwrap();
    pkg.print(alpha, "\"{x}\"").unwrap();
    pkg.print(beta, "\"{x}\"").unwrap();

    assert_eq!(run(&pkg, alpha), vec!["7".to_string()]);

    let err = run_result(&pkg, beta).expect_err("beta must not see alpha's private x");
    assert!(
        matches!(err, optilotus_core::ExecError::UnknownVariable { .. }),
        "expected UnknownVariable, got {err:?}"
    );
}

#[test]
fn a_public_variable_is_also_not_visible_to_a_sibling_function() {
    // The honest finding: `public` behaves exactly like `private` here,
    // because visibility is not enforced yet. A sibling function still
    // cannot see it. When enforcement lands, this test is the one that
    // must change.
    let mut pkg = Package::new();
    let alpha = pkg.create_function("alpha").unwrap();
    let beta = pkg.create_function("beta").unwrap();

    pkg.declare_with_access(alpha, "shared", "int32", Some("7"), Access::Public)
        .unwrap();
    pkg.print(beta, "\"{shared}\"").unwrap();

    let err = run_result(&pkg, beta).expect_err("public is not enforced yet");
    assert!(
        matches!(err, optilotus_core::ExecError::UnknownVariable { .. }),
        "expected UnknownVariable, got {err:?}"
    );
}

#[test]
fn main_can_hold_a_variable_alongside_helpers() {
    // A "global-ish" variable declared in `main` is still main-local.
    // Helpers cannot read it, and main cannot read a helper's locals.
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();

    pkg.declare_with_access(MAIN_ID, "global", "int32", Some("100"), Access::Public)
        .unwrap();
    pkg.print(MAIN_ID, "\"main sees {global}\"").unwrap();

    pkg.declare_with_access(helper, "local", "int32", Some("5"), Access::Private)
        .unwrap();
    pkg.print(helper, "\"helper sees {local}\"").unwrap();

    assert_eq!(run(&pkg, MAIN_ID), vec!["main sees 100".to_string()]);
    assert_eq!(run(&pkg, helper), vec!["helper sees 5".to_string()]);
}

#[test]
fn neither_function_can_reach_into_the_other() {
    // Same setup, but each function references the other's variable.
    // Both fail at run time, in both directions.
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();

    pkg.declare_with_access(MAIN_ID, "global", "int32", Some("100"), Access::Public)
        .unwrap();
    pkg.declare_with_access(helper, "local", "int32", Some("5"), Access::Private)
        .unwrap();

    // main -> helper's local
    pkg.print(MAIN_ID, "\"{local}\"").unwrap();
    let err = run_result(&pkg, MAIN_ID).expect_err("main must not see helper's local");
    assert!(matches!(
        err,
        optilotus_core::ExecError::UnknownVariable { .. }
    ));

    // helper -> main's global
    pkg.print(helper, "\"{global}\"").unwrap();
    let err = run_result(&pkg, helper).expect_err("helper must not see main's global");
    assert!(matches!(
        err,
        optilotus_core::ExecError::UnknownVariable { .. }
    ));
}

#[test]
fn duplicate_name_within_one_function_is_still_rejected() {
    // Scoping is per function, but a duplicate *inside* one function is
    // still an error regardless of the modifier.
    let mut pkg = Package::new();
    pkg.declare_with_access(MAIN_ID, "x", "int32", Some("1"), Access::Public)
        .unwrap();
    let err = pkg
        .declare_with_access(MAIN_ID, "x", "int32", Some("2"), Access::Private)
        .expect_err("duplicate within one function");
    assert!(err.to_string().contains("already declared"), "{err}");
}

#[test]
fn helper_call_gets_a_fresh_scope() {
    // A helper invoked from main runs with its own variables: main's
    // locals are not visible inside the call, and the helper's locals do
    // not leak back out. Both declare `x`; each keeps its own value.
    //
    // This runs `main` through `run_main` (not `run_function`): calls
    // resolve across the whole program, so the single-function path
    // cannot see `helper`.
    let mut pkg = Package::new();
    let helper = pkg.create_function("helper").unwrap();

    pkg.declare_with_access(MAIN_ID, "x", "int32", Some("1"), Access::Public)
        .unwrap();
    pkg.declare_with_access(helper, "x", "int32", Some("2"), Access::Public)
        .unwrap();
    pkg.print(helper, "\"helper x = {x}\"").unwrap();
    // `helper()` is used as a value in main, so it must return one.
    pkg.return_(helper, "{x}").unwrap();

    // Call the helper from main, then print main's own x.
    pkg.print(MAIN_ID, "\"main x = {x}\"").unwrap();
    pkg.assign(MAIN_ID, "x", "helper()").unwrap();
    pkg.print(MAIN_ID, "\"after call, main x = {x}\"").unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).expect("run main");
    assert_eq!(
        sink.lines,
        vec![
            "main x = 1".to_string(),
            "helper x = 2".to_string(),
            "after call, main x = 2".to_string(),
        ],
        "helper must see its own x, and main must keep its own"
    );
}
