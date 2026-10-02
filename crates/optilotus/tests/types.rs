use optilotus::Type;

#[test]
fn tags_cover_all_int_widths() {
    let signed = [
        Type::Int8,
        Type::Int16,
        Type::Int32,
        Type::Int64,
        Type::Int128,
    ];
    for t in signed {
        assert!(t.is_signed());
        assert!(t.is_numeric());
        assert!(!t.is_unsigned());
        assert!(!t.is_float());
    }
    let unsigned = [
        Type::Uint8,
        Type::Uint16,
        Type::Uint32,
        Type::Uint64,
        Type::Uint128,
    ];
    for t in unsigned {
        assert!(t.is_unsigned());
        assert!(t.is_numeric());
        assert!(!t.is_signed());
    }
}

#[test]
fn floats_and_non_numerics() {
    assert!(Type::Float32.is_float());
    assert!(Type::Float64.is_float());
    assert!(Type::Float32.is_numeric());
    for t in [Type::Bool, Type::Char, Type::String, Type::Void] {
        assert!(!t.is_numeric());
        assert!(!t.is_float());
    }
}

#[test]
fn tags_match_wire_format() {
    assert_eq!(Type::Int32.tag(), "int32");
    assert_eq!(Type::Uint8.tag(), "uint8");
    assert_eq!(Type::Float64.tag(), "float64");
    assert_eq!(Type::String.tag(), "string");
    assert_eq!(Type::Void.tag(), "void");
}

#[test]
fn tags_parse_back() {
    assert_eq!(Type::parse_tag("int32"), Some(Type::Int32));
    assert_eq!(Type::parse_tag(" string "), Some(Type::String));
    assert_eq!(Type::parse_tag("Int32"), None);
    assert_eq!(Type::parse_tag("nope"), None);
    for ty in [
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
    ] {
        assert_eq!(Type::parse_tag(ty.tag()), Some(ty));
    }
}
