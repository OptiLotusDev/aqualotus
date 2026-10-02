use optilotus::{apply_arith, ArithKind, OpError, Value};

#[test]
fn same_type_add_works() {
    let out = apply_arith(ArithKind::Add, &Value::Int32(2), &Value::Int32(3)).unwrap();
    assert_eq!(out, Value::Int32(5));
}

#[test]
fn mixed_types_rejected() {
    let err = apply_arith(ArithKind::Add, &Value::Int8(1), &Value::Uint8(1)).unwrap_err();
    assert!(matches!(err, OpError::TypeMismatch(_)));
}

#[test]
fn int_overflow_detected() {
    let err = apply_arith(ArithKind::Add, &Value::Int8(i8::MAX), &Value::Int8(1)).unwrap_err();
    assert_eq!(err, OpError::Overflow);
}

#[test]
fn div_by_zero_detected() {
    let err = apply_arith(ArithKind::Div, &Value::Int32(1), &Value::Int32(0)).unwrap_err();
    assert_eq!(err, OpError::DivByZero);
    let err = apply_arith(ArithKind::Mod, &Value::Uint32(1), &Value::Uint32(0)).unwrap_err();
    assert_eq!(err, OpError::DivByZero);
}

#[test]
fn non_numeric_rejected() {
    let err = apply_arith(ArithKind::Add, &Value::Bool(true), &Value::Bool(false)).unwrap_err();
    assert!(matches!(err, OpError::TypeMismatch(_)));
}
