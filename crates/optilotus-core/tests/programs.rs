//! End-to-end integration programs.
//!
//! Each test builds one realistic program out of many chained commands
//! spread across several functions, then runs it and asserts the whole
//! output. The point is coverage of *interactions*: features that pass
//! their own unit tests can still break when combined, and a single
//! program that exercises most of the language at once catches that.
//!
//! These are deliberately written as programs a user might actually
//! build, not as minimal repros. When one fails, the printed output shows
//! exactly which step diverged.

use optilotus_core::{Access, CommandSpec, Package, VecSink, VecSource, MAIN_ID};

/// Run `main` and return its printed lines.
fn run_main(pkg: &Package) -> Vec<String> {
    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).expect("main should run");
    sink.lines
}

/// Run `main` feeding `inputs` to any `input` commands, in order.
fn run_main_with(pkg: &Package, inputs: &[&str]) -> Vec<String> {
    let mut sink = VecSink::default();
    let mut source = VecSource {
        lines: inputs.iter().map(|s| s.to_string()).collect(),
        index: 0,
    };
    pkg.run_main_with_input(&mut sink, &mut source)
        .expect("main should run");
    sink.lines
}

/// Run `main` expecting failure, returning the error.
fn run_main_err(pkg: &Package) -> optilotus_core::ExecError {
    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).expect_err("main should fail")
}

/// Every scalar type, declared with every access level, printed once.
///
/// Exercises: all 15 non-void types, all 3 access levels, literal
/// parsing and display for each type, and the float decimal-point rule.
#[test]
fn program_declares_every_type_and_prints_it() {
    let mut pkg = Package::new();

    let decls: &[(&str, &str, &str, Access)] = &[
        ("i8", "int8", "-128", Access::Private),
        ("i16", "int16", "-32768", Access::Protected),
        ("i32", "int32", "2147483647", Access::Public),
        ("i64", "int64", "9223372036854775807", Access::Private),
        ("u8", "uint8", "255", Access::Protected),
        ("u16", "uint16", "65535", Access::Public),
        ("u32", "uint32", "4294967295", Access::Private),
        ("f32", "float32", "2.5", Access::Protected),
        ("f64", "float64", "2", Access::Public),
        ("b", "bool", "true", Access::Private),
        ("c", "char", "z", Access::Protected),
        ("s", "string", "\"hi\"", Access::Public),
    ];

    for (name, ty, init, access) in decls {
        pkg.declare_with_access(MAIN_ID, name, ty, Some(init), *access)
            .unwrap_or_else(|e| panic!("declare {name}: {e}"));
    }
    // A single print with every variable interpolated, so ordering and
    // interpolation are covered in one command.
    let template = format!(
        "\"{}={{{}}} {}={{{}}} {}={{{}}} {}={{{}}} {}={{{}}} {}={{{}}} {}={{{}}} {}={{{}}} {}={{{}}} {}={{{}}} {}={{{}}} {}={{{}}}\"",
        decls[0].0, decls[0].0,
        decls[1].0, decls[1].0,
        decls[2].0, decls[2].0,
        decls[3].0, decls[3].0,
        decls[4].0, decls[4].0,
        decls[5].0, decls[5].0,
        decls[6].0, decls[6].0,
        decls[7].0, decls[7].0,
        decls[8].0, decls[8].0,
        decls[9].0, decls[9].0,
        decls[10].0, decls[10].0,
        decls[11].0, decls[11].0,
    );
    pkg.print(MAIN_ID, &template).unwrap();

    let lines = run_main(&pkg);
    let last = lines.last().expect("at least one print");
    // `string` is raw text: the quotes typed in the literal are part of
    // the value, so `s` prints as `"hi"`. Floats keep their decimal
    // point (`f64=2.0`), and `char` prints bare (`c=z`).
    assert_eq!(
        last,
        "i8=-128 i16=-32768 i32=2147483647 i64=9223372036854775807 \
u8=255 u16=65535 u32=4294967295 f32=2.5 f64=2.0 b=true c=z s=\"hi\""
    );
}

/// Arithmetic across every operator, with mixed int/float results.
///
/// Exercises: `+ - * / %`, parentheses, unary minus, integer vs float
/// results, and the float display rule (`10.0`, not `10`).
#[test]
fn program_computes_every_operator() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "a", "int32", Some("10")).unwrap();
    pkg.declare(MAIN_ID, "b", "int32", Some("3")).unwrap();
    pkg.declare(MAIN_ID, "f", "float64", Some("2.5")).unwrap();
    pkg.declare(MAIN_ID, "out", "int32", None).unwrap();
    pkg.declare(MAIN_ID, "fout", "float64", None).unwrap();

    let steps: &[(&str, &str)] = &[
        ("out", "{a} + {b}"),
        ("out", "{a} - {b}"),
        ("out", "{a} * {b}"),
        ("out", "{a} / {b}"),
        ("out", "{a} % {b}"),
        ("out", "({a} + {b}) * 2"),
        ("out", "-{a}"),
        ("fout", "{f} * 4"),
        ("fout", "{f} + 0.5"),
    ];
    for (target, expr) in steps {
        pkg.assign(MAIN_ID, target, expr)
            .unwrap_or_else(|e| panic!("assign {target} = {expr}: {e}"));
        pkg.print(MAIN_ID, &format!("\"{{{target}}}\"")).unwrap();
    }

    assert_eq!(
        run_main(&pkg),
        vec![
            "13".to_string(),
            "7".to_string(),
            "30".to_string(),
            "3".to_string(),
            "1".to_string(),
            "26".to_string(),
            "-10".to_string(),
            "10.0".to_string(),
            "3.0".to_string(),
        ]
    );
}

/// Comparison operators feeding `if` branches, nested.
///
/// Exercises: all six comparisons, `if`/`else`, nested `if` bodies,
/// `CommandSpec` bodies, and branch-local declares.
#[test]
fn program_branches_on_every_comparison() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("5")).unwrap();

    let cases: &[(&str, &str)] = &[
        ("{x} == 5", "eq"),
        ("{x} != 5", "ne"),
        ("{x} < 6", "lt"),
        ("{x} <= 5", "le"),
        ("{x} > 4", "gt"),
        ("{x} >= 5", "ge"),
    ];

    for (cond, label) in cases {
        let then_specs = vec![CommandSpec::print(&format!("\"{label}\""))];
        pkg.if_with_expr(MAIN_ID, cond, &then_specs, None)
            .unwrap_or_else(|e| panic!("if {cond}: {e}"));
    }

    // Nested: outer true, inner true.
    let inner = vec![CommandSpec::print("\"inner\"")];
    let outer = vec![
        CommandSpec::print("\"outer\""),
        CommandSpec::print("\"still outer\""),
    ];
    pkg.if_with_expr(MAIN_ID, "{x} > 1", &outer, None).unwrap();
    pkg.if_with_expr(MAIN_ID, "{x} < 100", &inner, None)
        .unwrap();

    assert_eq!(
        run_main(&pkg),
        vec![
            "eq",
            "lt",
            "le",
            "gt",
            "ge",
            "outer",
            "still outer",
            "inner",
        ]
    );
}

/// A helper called repeatedly, with its own scope each time.
///
/// Exercises: function calls, `return`, shared step/print budget, and
/// per-call variable scope. `accumulate` returns a value derived from its
/// own local, so a leaking scope would show up as a wrong total.
#[test]
fn program_calls_a_helper_in_a_loop_like_chain() {
    let mut pkg = Package::new();
    let double = pkg.create_function("double").unwrap();

    // A helper has its own scope and takes no arguments, so it computes
    // from its own declared value. Calling it three times must give the
    // same answer each time (no state leaks between calls).
    pkg.declare(double, "n", "int32", Some("6")).unwrap();
    pkg.return_(double, "{n} * 2").unwrap();

    pkg.declare(MAIN_ID, "total", "int32", Some("0")).unwrap();
    for _ in 0..3 {
        pkg.assign(MAIN_ID, "total", "{total} + double()").unwrap();
    }
    pkg.print(MAIN_ID, "\"total = {total}\"").unwrap();

    assert_eq!(run_main(&pkg), vec!["total = 36".to_string()]);
}

/// Interactive input: several reads of different types in one chain.
///
/// Exercises: `input` for int/float/string/bool/char and the input
/// source path. `input` yields its value on an output edge rather than
/// binding a named variable, so this asserts the reads happen in order
/// and the program completes.
#[test]
fn program_reads_input_of_several_types() {
    let mut pkg = Package::new();
    pkg.input(MAIN_ID, "int32").unwrap();
    pkg.input(MAIN_ID, "float64").unwrap();
    pkg.input(MAIN_ID, "string").unwrap();
    pkg.input(MAIN_ID, "bool").unwrap();
    pkg.input(MAIN_ID, "char").unwrap();
    pkg.print(MAIN_ID, "\"read 5 values\"").unwrap();

    let lines = run_main_with(&pkg, &["42", "2.5", "hi", "true", "z"]);
    assert_eq!(lines, vec!["read 5 values".to_string()]);

    // Too few inputs must fail explicitly rather than silently stopping.
    let mut sink = VecSink::default();
    let mut short = VecSource {
        lines: vec!["1".to_string()],
        index: 0,
    };
    let err = pkg
        .run_main_with_input(&mut sink, &mut short)
        .expect_err("input exhaustion must be reported");
    assert!(
        matches!(err, optilotus_core::ExecError::InputEof { .. }),
        "expected InputEof, got {err:?}"
    );
}

/// A program mixing every command kind in one function.
///
/// Exercises: declare, assign, print, input, cast, if, return, and the
/// access modifier — all in a single chain, so ordering and linkage are
/// covered together.
#[test]
fn program_uses_every_command_kind_in_one_chain() {
    let mut pkg = Package::new();

    pkg.declare_with_access(MAIN_ID, "x", "int32", Some("10"), Access::Public)
        .unwrap();
    pkg.declare_with_access(MAIN_ID, "y", "int32", Some("3"), Access::Private)
        .unwrap();
    // `cast` introduces a new variable, so it needs its own name.
    pkg.cast(MAIN_ID, "f", "float64", "{x}").unwrap();
    pkg.assign(MAIN_ID, "x", "{x} + {y}").unwrap();
    pkg.print(MAIN_ID, "\"x={x} y={y} f={f}\"").unwrap();

    let then_specs = vec![CommandSpec::print("\"x is big\"")];
    let else_specs = vec![CommandSpec::print("\"x is small\"")];
    pkg.if_with_expr(MAIN_ID, "{x} > 100", &then_specs, Some(&else_specs))
        .unwrap();

    pkg.print(MAIN_ID, "\"end\"").unwrap();

    assert_eq!(
        run_main(&pkg),
        vec![
            "x=13 y=3 f=10.0".to_string(),
            "x is small".to_string(),
            "end".to_string(),
        ]
    );
}

/// A multi-function program where each function owns private state.
///
/// Exercises: several helpers, private variables in each, calls between
/// them, and the guarantee that no function can see another's locals.
#[test]
fn program_keeps_private_state_per_function() {
    let mut pkg = Package::new();
    let area = pkg.create_function("area").unwrap();
    let perimeter = pkg.create_function("perimeter").unwrap();

    // area: w=3, h=4 -> 12
    pkg.declare_with_access(area, "w", "int32", Some("3"), Access::Private)
        .unwrap();
    pkg.declare_with_access(area, "h", "int32", Some("4"), Access::Private)
        .unwrap();
    pkg.return_(area, "{w} * {h}").unwrap();

    // perimeter: w=3, h=4 -> 14
    pkg.declare_with_access(perimeter, "w", "int32", Some("3"), Access::Private)
        .unwrap();
    pkg.declare_with_access(perimeter, "h", "int32", Some("4"), Access::Private)
        .unwrap();
    pkg.return_(perimeter, "2 * ({w} + {h})").unwrap();

    // main uses both; it has its own `w`, which must not be touched.
    pkg.declare_with_access(MAIN_ID, "w", "int32", Some("99"), Access::Private)
        .unwrap();
    pkg.declare(MAIN_ID, "a", "int32", None).unwrap();
    pkg.declare(MAIN_ID, "p", "int32", None).unwrap();
    pkg.assign(MAIN_ID, "a", "area()").unwrap();
    pkg.assign(MAIN_ID, "p", "perimeter()").unwrap();
    pkg.print(MAIN_ID, "\"area={a} perimeter={p} main_w={w}\"")
        .unwrap();

    assert_eq!(
        run_main(&pkg),
        vec!["area=12 perimeter=14 main_w=99".to_string()],
        "helpers must not disturb main's own w"
    );
}

/// Failure paths: a program that divides by zero, and one that reads a
/// missing variable. Both must fail with a typed error naming the cause.
#[test]
fn program_reports_typed_errors() {
    // Division by zero.
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "z", "int32", Some("0")).unwrap();
    pkg.declare(MAIN_ID, "out", "int32", None).unwrap();
    pkg.assign(MAIN_ID, "out", "10 / {z}").unwrap();
    let err = run_main_err(&pkg);
    assert!(
        matches!(err, optilotus_core::ExecError::DivByZero { .. }),
        "expected DivByZero, got {err:?}"
    );

    // Unknown variable at run time.
    let mut pkg2 = Package::new();
    pkg2.print(MAIN_ID, "\"{missing}\"").unwrap();
    let err2 = run_main_err(&pkg2);
    assert!(
        matches!(err2, optilotus_core::ExecError::UnknownVariable { .. }),
        "expected UnknownVariable, got {err2:?}"
    );
}

/// A larger program: build a small table with a helper, then format it.
///
/// Exercises many features together — helper with return, repeated
/// assignment, string interpolation with arithmetic, and a branch — to
/// approximate a real user program rather than a feature checklist.
#[test]
fn program_builds_a_formatted_report() {
    let mut pkg = Package::new();
    let square = pkg.create_function("square").unwrap();

    // The helper squares its own constant; main accumulates it and also
    // does its own arithmetic, so both scopes are exercised together.
    pkg.declare(square, "n", "int32", Some("5")).unwrap();
    pkg.return_(square, "{n} * {n}").unwrap();

    pkg.declare(MAIN_ID, "sum", "int32", Some("0")).unwrap();
    pkg.declare(MAIN_ID, "label", "string", Some("\"squares\""))
        .unwrap();
    pkg.declare(MAIN_ID, "i", "int32", Some("1")).unwrap();

    // sum = 25 + 25 + 25, and main tracks its own counter separately.
    for _ in 0..3 {
        pkg.assign(MAIN_ID, "sum", "{sum} + square()").unwrap();
        pkg.assign(MAIN_ID, "i", "{i} + 1").unwrap();
    }
    pkg.print(MAIN_ID, "\"sum of squares = {sum}\"").unwrap();
    pkg.print(MAIN_ID, "\"iterations = {i}\"").unwrap();

    let then_specs = vec![CommandSpec::print("\"sum is large\"")];
    pkg.if_with_expr(MAIN_ID, "{sum} > 10", &then_specs, None)
        .unwrap();

    let lines = run_main(&pkg);
    assert_eq!(
        lines,
        vec![
            "sum of squares = 75".to_string(),
            "iterations = 4".to_string(),
            "sum is large".to_string(),
        ]
    );
}
