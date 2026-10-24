use optilotus_data::{Type, Value};

#[test]
fn every_value_reports_its_own_type() {
    let cases = [
        (Value::Int8(1), Type::Int8),
        (Value::Int16(1), Type::Int16),
        (Value::Int32(1), Type::Int32),
        (Value::Int64(1), Type::Int64),
        (Value::Int128(1), Type::Int128),
        (Value::Uint8(1), Type::Uint8),
        (Value::Uint16(1), Type::Uint16),
        (Value::Uint32(1), Type::Uint32),
        (Value::Uint64(1), Type::Uint64),
        (Value::Uint128(1), Type::Uint128),
        (Value::Float32(1.0), Type::Float32),
        (Value::Float64(1.0), Type::Float64),
        (Value::Bool(true), Type::Bool),
        (Value::Char('a'), Type::Char),
        (Value::String("s".into()), Type::String),
        (Value::Void, Type::Void),
    ];
    for (value, expected) in cases {
        assert_eq!(value.ty(), expected);
    }
}

#[test]
fn tags_round_trip_through_parse() {
    let all = [
        Type::Int8,
        Type::Int16,
        Type::Int32,
        Type::Int64,
        Type::Int128,
        Type::Uint8,
        Type::Uint16,
        Type::Uint32,
        Type::Uint64,
        Type::Uint128,
        Type::Float32,
        Type::Float64,
        Type::Bool,
        Type::Char,
        Type::String,
        Type::Void,
    ];
    for ty in all {
        assert_eq!(Type::parse_tag(ty.tag()), Some(ty));
    }
}

#[test]
fn unknown_and_empty_tags_are_rejected() {
    assert_eq!(Type::parse_tag("nope"), None);
    assert_eq!(Type::parse_tag(""), None);
    assert_eq!(Type::parse_tag("INT32"), None);
}

#[test]
fn numeric_predicates_partition_the_types() {
    assert!(Type::Int32.is_numeric());
    assert!(Type::Uint32.is_numeric());
    assert!(Type::Float32.is_numeric());
    assert!(!Type::Bool.is_numeric());
    assert!(!Type::String.is_numeric());
    assert!(!Type::Void.is_numeric());
    assert!(Type::Int32.is_signed());
    assert!(!Type::Int32.is_unsigned());
    assert!(Type::Uint32.is_unsigned());
    assert!(Type::Float32.is_float());
}

#[test]
fn whole_floats_keep_their_decimal_point() {
    assert_eq!(Value::Float32(2.0).to_string(), "2.0");
    assert_eq!(Value::Float64(2.0).to_string(), "2.0");
    assert_eq!(Value::Float32(2.5).to_string(), "2.5");
    assert_eq!(Value::Float64(-0.0).to_string(), "-0.0");
}

#[test]
fn f32_and_f64_keep_separate_display_precision() {
    // A non-PI constant, so clippy's approx-constant lint does not fire
    // and the point stands: each width prints its own shortest form
    // rather than widening f32 into f64's binary expansion.
    let third = Value::Float32(1.0 / 3.0);
    assert_eq!(third.to_string(), "0.33333334");
    let third64 = Value::Float64(1.0 / 3.0);
    assert_eq!(third64.to_string(), "0.3333333333333333");
    assert_ne!(third.to_string(), third64.to_string());
}

#[test]
fn void_displays_as_a_word() {
    assert_eq!(Value::Void.to_string(), "void");
}

#[test]
fn ids_start_at_one_and_increment() {
    assert_eq!(optilotus_data::NodeId::FIRST.0, 1);
    assert_eq!(optilotus_data::NodeId(7).next_id().0, 8);
    assert_eq!(optilotus_data::NodeId(7).get(), 7);
}
