use optilotus::{ExprFail, Session, Type, Value};

#[test]
fn set_and_get_round_trip() {
    let mut session = Session::new();
    session.set("n", Type::Int32, Value::Int32(41)).unwrap();
    assert_eq!(session.get("n").unwrap(), Value::Int32(41));
}

#[test]
fn set_rejects_type_mismatch_and_type_change() {
    let mut session = Session::new();
    let err = session
        .set("n", Type::Int32, Value::String("x".to_string()))
        .unwrap_err();
    assert!(matches!(err, ExprFail::TypeMismatch(_)));

    session.set("n", Type::Int32, Value::Int32(1)).unwrap();
    let err = session
        .set("n", Type::String, Value::String("x".to_string()))
        .unwrap_err();
    assert!(matches!(err, ExprFail::TypeMismatch(_)));

    // Same type re-assigns fine.
    session.set("n", Type::Int32, Value::Int32(2)).unwrap();
    assert_eq!(session.get("n").unwrap(), Value::Int32(2));
}

#[test]
fn set_rejects_void_and_bad_names() {
    let mut session = Session::new();
    assert!(matches!(
        session.set("v", Type::Void, Value::Void).unwrap_err(),
        ExprFail::TypeMismatch(_)
    ));
    assert!(matches!(
        session.set("", Type::Int32, Value::Int32(1)).unwrap_err(),
        ExprFail::Parse(_)
    ));
}

#[test]
fn get_unknown_is_an_error() {
    let session = Session::new();
    assert_eq!(
        session.get("ghost").unwrap_err(),
        ExprFail::UnknownVariable("ghost".to_string())
    );
}

#[test]
fn exec_math_uses_session_variables() {
    let mut session = Session::new();
    session.set("n", Type::Int32, Value::Int32(3)).unwrap();
    assert_eq!(session.exec_math("({n} + 4) % 2").unwrap(), Value::Int32(1));
    assert!(matches!(
        session.exec_math("{ghost} + 1").unwrap_err(),
        ExprFail::UnknownVariable(_)
    ));
}

#[test]
fn render_uses_session_variables() {
    let mut session = Session::new();
    session
        .set("name", Type::String, Value::String("Bob".to_string()))
        .unwrap();
    assert_eq!(
        session.render("\"Hello {name}\" + \" AAA\"").unwrap(),
        "Hello Bob AAA"
    );
}

#[test]
fn clear_drops_everything() {
    let mut session = Session::new();
    session.set("a", Type::Int32, Value::Int32(1)).unwrap();
    session
        .set("b", Type::String, Value::String("x".to_string()))
        .unwrap();
    assert_eq!(session.clear(), 2);
    assert_eq!(session.clear(), 0);
    assert!(matches!(
        session.get("a").unwrap_err(),
        ExprFail::UnknownVariable(_)
    ));
}

#[test]
fn parse_value_covers_the_types() {
    assert_eq!(
        Session::parse_value(Type::Int32, " 41 ").unwrap(),
        Value::Int32(41)
    );
    assert_eq!(
        Session::parse_value(Type::String, "  hi  ").unwrap(),
        Value::String("  hi  ".to_string())
    );
    assert_eq!(
        Session::parse_value(Type::Bool, "true").unwrap(),
        Value::Bool(true)
    );
    assert_eq!(
        Session::parse_value(Type::Char, "z").unwrap(),
        Value::Char('z')
    );
    assert_eq!(
        Session::parse_value(Type::Float64, "2.5").unwrap(),
        Value::Float64(2.5)
    );
    assert!(matches!(
        Session::parse_value(Type::Bool, "yes").unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert!(matches!(
        Session::parse_value(Type::Char, "ab").unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert_eq!(
        Session::parse_value(Type::Int8, "300").unwrap_err(),
        ExprFail::Overflow
    );
    assert!(matches!(
        Session::parse_value(Type::Int32, "abc").unwrap_err(),
        ExprFail::Parse(_)
    ));
    assert!(matches!(
        Session::parse_value(Type::Void, "").unwrap_err(),
        ExprFail::TypeMismatch(_)
    ));
}
