use std::collections::HashMap;

use optilotus::{check_var_name, eval_expr, render_template, ExprFail, Value};

fn vars(pairs: Vec<(String, Value)>) -> HashMap<String, Value> {
    pairs.into_iter().collect()
}

fn eval(expr: &str) -> Result<Value, ExprFail> {
    eval_expr(expr, &vars(vec![]))
}

#[test]
fn precedence_and_parentheses() {
    assert_eq!(eval("2 + 3 * 4").unwrap(), Value::Int32(14));
    assert_eq!(eval("(2 + 3) * 4").unwrap(), Value::Int32(20));
    assert_eq!(eval("(3 + 4) % 2").unwrap(), Value::Int32(1));
    assert_eq!(eval("10 - 2 - 3").unwrap(), Value::Int32(5));
    assert_eq!(eval("7 / 2").unwrap(), Value::Int32(3));
    assert_eq!(eval("-5 + 2").unwrap(), Value::Int32(-3));
    assert_eq!(eval("-(3 + 4)").unwrap(), Value::Int32(-7));
    assert_eq!(eval("  2   +   2  ").unwrap(), Value::Int32(4));
}

#[test]
fn float_literals() {
    assert_eq!(eval("2.5 * 2").unwrap(), Value::Float64(5.0));
    assert_eq!(eval("1.5 + 2.5").unwrap(), Value::Float64(4.0));
}

#[test]
fn big_literal_only_results_widen() {
    assert_eq!(
        eval("9999999999 + 1").unwrap(),
        Value::Int64(10_000_000_000)
    );
}

#[test]
fn variables_read_and_adopt_literal_types() {
    let v = vars(vec![("x".to_string(), Value::Int32(21))]);
    assert_eq!(eval_expr("{x} * 2", &v).unwrap(), Value::Int32(42));

    // int8 variable adopts the literal: no manual suffix needed.
    let v = vars(vec![("c".to_string(), Value::Int8(40))]);
    assert_eq!(eval_expr("{c} + 2", &v).unwrap(), Value::Int8(42));

    // Integer literal adopts a float variable's type.
    let v = vars(vec![("f".to_string(), Value::Float64(1.5))]);
    assert_eq!(eval_expr("{f} + 2", &v).unwrap(), Value::Float64(3.5));

    // Hyphenated names work.
    let v = vars(vec![("var-name".to_string(), Value::Int32(7))]);
    assert_eq!(eval_expr("{var-name} + 1", &v).unwrap(), Value::Int32(8));
}

#[test]
fn variable_type_errors() {
    // Float literal cannot feed an int variable.
    let v = vars(vec![("n".to_string(), Value::Int32(1))]);
    assert!(matches!(
        eval_expr("{n} + 2.5", &v).unwrap_err(),
        ExprFail::TypeMismatch(_)
    ));
    // Mixed variable types stay strict.
    let v = vars(vec![
        ("a".to_string(), Value::Int8(1)),
        ("b".to_string(), Value::Int32(2)),
    ]);
    assert!(matches!(
        eval_expr("{a} + {b}", &v).unwrap_err(),
        ExprFail::TypeMismatch(_)
    ));
    // Strings are not computable.
    let v = vars(vec![("s".to_string(), Value::String("x".to_string()))]);
    assert!(matches!(
        eval_expr("{s} + 1", &v).unwrap_err(),
        ExprFail::TypeMismatch(_)
    ));
}

#[test]
fn expression_failures() {
    assert!(matches!(eval("(3 +"), Err(ExprFail::Parse(_))));
    assert!(matches!(eval(""), Err(ExprFail::Parse(_))));
    assert!(matches!(eval("{}"), Err(ExprFail::Parse(_))));
    assert!(matches!(eval("3 + \"s\""), Err(ExprFail::TypeMismatch(_))));
    assert!(matches!(eval("2 (3)"), Err(ExprFail::Parse(_))));
    assert_eq!(eval("1 / 0").unwrap_err(), ExprFail::DivByZero);
    assert_eq!(eval("1 % 0").unwrap_err(), ExprFail::DivByZero);
    assert_eq!(
        eval("{ghost} + 1").unwrap_err(),
        ExprFail::UnknownVariable("ghost".to_string())
    );
    // Out-of-range literal for the adopted type.
    let v = vars(vec![("c".to_string(), Value::Int8(1))]);
    assert_eq!(eval_expr("{c} + 300", &v).unwrap_err(), ExprFail::Overflow);
    // Deeply nested input is rejected, not a stack overflow.
    let deep = "(".repeat(100) + "1" + &")".repeat(100);
    assert!(matches!(eval(&deep), Err(ExprFail::Parse(_))));
}

#[test]
fn var_names_are_validated() {
    assert_eq!(check_var_name("  x  ").unwrap(), "x");
    assert!(matches!(check_var_name(""), Err(ExprFail::Parse(_))));
    assert!(matches!(check_var_name("   "), Err(ExprFail::Parse(_))));
    assert!(matches!(check_var_name("a{b}"), Err(ExprFail::Parse(_))));
}

#[test]
fn templates_concat_and_interpolate() {
    let v = vars(vec![("name".to_string(), Value::String("Bob".to_string()))]);
    assert_eq!(
        render_template("\"Hello {name}\" + \" AAA\"", &v).unwrap(),
        "Hello Bob AAA"
    );
    assert_eq!(render_template("\"hi\"", &v).unwrap(), "hi");
    assert_eq!(render_template("{name}", &v).unwrap(), "Bob");
    assert_eq!(render_template("", &v).unwrap(), "");
    // Non-string values render via Display.
    let v = vars(vec![("n".to_string(), Value::Int32(42))]);
    assert_eq!(render_template("\"n={n}\"", &v).unwrap(), "n=42");
    // Escapes.
    assert_eq!(
        render_template("\"a\\\"b\\\\c\\nd\" + \"!\"", &v).unwrap(),
        "a\"b\\c\nd!"
    );
    assert_eq!(
        render_template("\"\\{not a var}\"", &v).unwrap(),
        "{not a var}"
    );
}

#[test]
fn template_failures() {
    let v = vars(vec![]);
    // Unquoted text is rejected: literals must be quoted.
    assert!(matches!(
        render_template("hello", &v).unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert!(matches!(
        render_template("\"a\" + ", &v).unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert!(matches!(
        render_template("\"abc", &v).unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert!(matches!(
        render_template("\"a\" \"b\"", &v).unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert!(matches!(
        render_template("\"\\q\"", &v).unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert_eq!(
        render_template("\"hi {ghost}\"", &v).unwrap_err(),
        ExprFail::UnknownVariable("ghost".to_string())
    );
}

#[test]
fn nesting_boundary() {
    // 64 nested parens evaluate; the 65th trips the depth cap.
    let ok = "(".repeat(64) + "1" + &")".repeat(64);
    assert_eq!(eval(&ok).unwrap(), Value::Int32(1));
    let deep = "(".repeat(65) + "1" + &")".repeat(65);
    assert!(matches!(eval(&deep), Err(ExprFail::Parse(_))));
}

#[test]
fn all_widths_compute() {
    let v = vars(vec![
        ("big".to_string(), Value::Int64(9_000_000_000)),
        ("u".to_string(), Value::Uint64(7)),
        ("f".to_string(), Value::Float32(1.5)),
    ]);
    assert_eq!(
        eval_expr("{big} + 1", &v).unwrap(),
        Value::Int64(9_000_000_001)
    );
    assert_eq!(eval_expr("{u} * 2", &v).unwrap(), Value::Uint64(14));
    assert_eq!(eval_expr("{f} + 1", &v).unwrap(), Value::Float32(2.5));
}

#[test]
fn int_division_truncates_toward_zero() {
    assert_eq!(eval("-7 / 2").unwrap(), Value::Int32(-3));
    assert_eq!(eval("7 / -2").unwrap(), Value::Int32(-3));
}

#[test]
fn float_div_by_zero_is_infinity() {
    // Floats keep IEEE semantics (ints would be DivByZero).
    assert_eq!(eval("1.0 / 0.0").unwrap(), Value::Float64(f64::INFINITY));
}

#[test]
fn whitespace_everywhere() {
    assert_eq!(eval("(\n 2\t+\n 3\n)").unwrap(), Value::Int32(5));
}

#[test]
fn unary_minus_chains() {
    assert_eq!(eval("--5").unwrap(), Value::Int32(5));
    assert_eq!(eval("- -5").unwrap(), Value::Int32(5));
    assert_eq!(eval("-(2 * 3)").unwrap(), Value::Int32(-6));
}

#[test]
fn plus_inside_quotes_is_literal() {
    let v = vars(vec![]);
    assert_eq!(render_template("\"+\"", &v).unwrap(), "+");
    assert_eq!(render_template("\"a+b\"", &v).unwrap(), "a+b");
}

#[test]
fn empty_ref_names_fail() {
    let v = vars(vec![]);
    assert!(matches!(
        render_template("\"{ }\"", &v).unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert!(matches!(
        render_template("\"{{x}}\"", &v).unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert!(matches!(eval("{} + 1"), Err(ExprFail::Parse(_))));
}

#[test]
fn huge_literal_overflows() {
    // 40 digits: too wide even for i128.
    assert_eq!(
        eval("9999999999999999999999999999999999999999 + 1").unwrap_err(),
        ExprFail::Overflow
    );
    // i128::MAX itself parses; adding one overflows.
    let max = i128::MAX.to_string();
    assert_eq!(
        eval(&format!("{max} + 0")).unwrap(),
        Value::Int128(i128::MAX)
    );
    assert_eq!(eval(&format!("{max} + 1")).unwrap_err(), ExprFail::Overflow);
}

#[test]
fn float_var_division() {
    let v = vars(vec![("f".to_string(), Value::Float64(7.5))]);
    assert_eq!(eval_expr("{f} / 2", &v).unwrap(), Value::Float64(3.75));
}
