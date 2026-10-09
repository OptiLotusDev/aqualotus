mod common;

use common::{eval, vars};
use optilotus::{eval_expr, ExprFail, Value};

#[test]
fn integer_comparisons_cover_all_operators() {
    assert_eq!(eval("3 == 3").unwrap(), Value::Bool(true));
    assert_eq!(eval("3 == 4").unwrap(), Value::Bool(false));
    assert_eq!(eval("3 != 4").unwrap(), Value::Bool(true));
    assert_eq!(eval("3 != 3").unwrap(), Value::Bool(false));
    assert_eq!(eval("3 < 4").unwrap(), Value::Bool(true));
    assert_eq!(eval("4 < 3").unwrap(), Value::Bool(false));
    assert_eq!(eval("3 <= 3").unwrap(), Value::Bool(true));
    assert_eq!(eval("4 <= 3").unwrap(), Value::Bool(false));
    assert_eq!(eval("4 > 3").unwrap(), Value::Bool(true));
    assert_eq!(eval("3 > 4").unwrap(), Value::Bool(false));
    assert_eq!(eval("3 >= 3").unwrap(), Value::Bool(true));
    assert_eq!(eval("3 >= 4").unwrap(), Value::Bool(false));
}

#[test]
fn comparison_respects_arithmetic_precedence() {
    // `2 + 3 > 4` parses as `(2 + 3) > 4`.
    assert_eq!(eval("2 + 3 > 4").unwrap(), Value::Bool(true));
    assert!(eval("{x} * 2 <= 10").is_err()); // unknown var, sanity
    let v = vars(vec![("x".to_string(), Value::Int32(6))]);
    assert_eq!(eval_expr("{x} * 2 <= 10", &v).unwrap(), Value::Bool(false));
    assert_eq!(eval_expr("({x} - 1) >= 5", &v).unwrap(), Value::Bool(true));
}

#[test]
fn bool_literals_and_equality() {
    assert_eq!(eval("true").unwrap(), Value::Bool(true));
    assert_eq!(eval("false").unwrap(), Value::Bool(false));
    assert_eq!(eval("true == true").unwrap(), Value::Bool(true));
    assert_eq!(eval("true != false").unwrap(), Value::Bool(true));
    assert_eq!(eval("true == false").unwrap(), Value::Bool(false));
}

#[test]
fn string_and_char_comparisons() {
    assert_eq!(eval("\"a\" < \"b\"").unwrap(), Value::Bool(true));
    assert_eq!(eval("\"b\" == \"b\"").unwrap(), Value::Bool(true));
    let v = vars(vec![("s".to_string(), Value::String("hi".to_string()))]);
    assert_eq!(eval_expr("{s} == \"hi\"", &v).unwrap(), Value::Bool(true));
}

#[test]
fn mismatched_types_are_type_errors() {
    let err = eval("3 > \"hello\"").unwrap_err();
    assert!(matches!(err, ExprFail::TypeMismatch(_)), "got {err:?}");
    let v = vars(vec![
        ("n".to_string(), Value::Int32(3)),
        ("s".to_string(), Value::String("x".to_string())),
    ]);
    let err = eval_expr("{n} == {s}", &v).unwrap_err();
    assert!(matches!(err, ExprFail::TypeMismatch(_)), "got {err:?}");
}

#[test]
fn lone_comparison_char_is_parse_error() {
    assert!(matches!(eval("3 =="), Err(ExprFail::Parse(_))));
    assert!(matches!(eval("3 !"), Err(ExprFail::Parse(_))));
    assert!(matches!(eval("3 >"), Err(ExprFail::Parse(_))));
}
