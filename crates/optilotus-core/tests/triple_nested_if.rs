use optilotus_core::{CommandSpec, Package, VecSink, MAIN_ID};
use optilotus_core::package::IfSide;

fn build_with(x: i32) -> Package {
    // Rebuild by calling build then patching declare? Easier: declare with x value.
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some(&x.to_string())).unwrap();

    let zero_if = pkg
        .if_with_expr(
            MAIN_ID,
            "{x} == 0",
            &[CommandSpec::print("\"zero\"")],
            Some(&[CommandSpec::print("\"not-zero-low\"")]),
        )
        .unwrap();
    let two_if = pkg
        .if_with_expr(
            MAIN_ID,
            "{x} == 2",
            &[CommandSpec::print("\"two\"")],
            Some(&[CommandSpec::print("\"three\"")]),
        )
        .unwrap();
    let four_if = pkg
        .if_with_expr(
            MAIN_ID,
            "{x} == 4",
            &[CommandSpec::print("\"four\"")],
            Some(&[CommandSpec::print("\"five\"")]),
        )
        .unwrap();
    let six_if = pkg
        .if_with_expr(
            MAIN_ID,
            "{x} == 6",
            &[CommandSpec::print("\"six\"")],
            Some(&[CommandSpec::print("\"seven-plus\"")]),
        )
        .unwrap();

    let left_if = pkg.if_with_expr(MAIN_ID, "{x} < 2", &[], None).unwrap();
    pkg.if_append(MAIN_ID, left_if, IfSide::Then, zero_if)
        .unwrap();
    pkg.if_append(MAIN_ID, left_if, IfSide::Else, two_if)
        .unwrap();

    let right_if = pkg.if_with_expr(MAIN_ID, "{x} < 6", &[], None).unwrap();
    pkg.if_append(MAIN_ID, right_if, IfSide::Then, four_if)
        .unwrap();
    pkg.if_append(MAIN_ID, right_if, IfSide::Else, six_if)
        .unwrap();

    let outer = pkg.if_with_expr(MAIN_ID, "{x} < 4", &[], None).unwrap();
    pkg.if_append(MAIN_ID, outer, IfSide::Then, left_if)
        .unwrap();
    pkg.if_append(MAIN_ID, outer, IfSide::Else, right_if)
        .unwrap();

    pkg
}

#[test]
fn triple_nested_if_all_paths() {
    let cases = [
        (-1, "not-zero-low"),
        (0, "zero"),
        (1, "not-zero-low"),
        (2, "two"),
        (3, "three"),
        (4, "four"),
        (5, "five"),
        (6, "six"),
        (7, "seven-plus"),
        (8, "seven-plus"),
    ];
    for (x, expected) in cases {
        let pkg = build_with(x);
        let mut sink = VecSink::default();
        pkg.run_main(&mut sink).unwrap_or_else(|e| panic!("x={x}: {e:?}"));
        assert_eq!(
            sink.lines,
            vec![expected.to_string()],
            "x={x}"
        );
    }
}
