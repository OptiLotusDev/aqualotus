use optilotus::{Type, Value};

#[test]
fn ty_round_trips_for_every_variant() {
    let cases: Vec<(Value, Type)> = vec![
        (Value::Int8(0), Type::Int8),
        (Value::Int16(0), Type::Int16),
        (Value::Int32(0), Type::Int32),
        (Value::Int64(0), Type::Int64),
        (Value::Int128(0), Type::Int128),
        (Value::Uint8(0), Type::Uint8),
        (Value::Uint16(0), Type::Uint16),
        (Value::Uint32(0), Type::Uint32),
        (Value::Uint64(0), Type::Uint64),
        (Value::Uint128(0), Type::Uint128),
        (Value::Float32(0.0), Type::Float32),
        (Value::Float64(0.0), Type::Float64),
        (Value::Bool(false), Type::Bool),
        (Value::Char('a'), Type::Char),
        (Value::String("hi".to_string()), Type::String),
        (Value::Void, Type::Void),
    ];
    for (value, ty) in cases {
        assert_eq!(value.ty(), ty);
    }
}

#[test]
fn string_content_is_kept_verbatim() {
    let v = Value::String("a\nb".to_string());
    assert_eq!(v.to_string(), "a\nb");
}
