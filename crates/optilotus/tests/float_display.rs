//! Float display formatting.
//!
//! Optilotus has distinct `float32`/`float64` and integer types, so a
//! whole float must stay visually distinguishable from an integer in
//! `print` output. Rust's `Display` for floats prints `2.0` as `2`, which
//! would hide the value's type, so `Value` formats floats itself.
//!
//! These tests pin that contract. They also guard the `f32` path: widening
//! an `f32` to `f64` before formatting exposes its binary expansion
//! (`3.14159` -> `3.141590118408203`), so each width keeps its own
//! shortest round-trip form.

use optilotus::Value;

#[test]
fn whole_floats_keep_a_decimal_point() {
    assert_eq!(Value::Float64(2.0).to_string(), "2.0");
    assert_eq!(Value::Float64(100.0).to_string(), "100.0");
    assert_eq!(Value::Float64(0.0).to_string(), "0.0");
    assert_eq!(Value::Float64(-2.0).to_string(), "-2.0");
    assert_eq!(Value::Float32(2.0).to_string(), "2.0");
    assert_eq!(Value::Float32(1000.0).to_string(), "1000.0");
}

#[test]
fn integers_do_not_gain_a_decimal_point() {
    // The whole point: `2` (int) and `2.0` (float) must differ.
    assert_eq!(Value::Int32(2).to_string(), "2");
    assert_eq!(Value::Int64(2).to_string(), "2");
    assert_eq!(Value::Uint8(2).to_string(), "2");
    assert_eq!(Value::Int128(2).to_string(), "2");
    assert_ne!(Value::Int32(2).to_string(), Value::Float64(2.0).to_string());
}

#[test]
fn fractional_floats_are_unchanged() {
    assert_eq!(Value::Float64(2.5).to_string(), "2.5");
    assert_eq!(Value::Float64(-2.5).to_string(), "-2.5");
    assert_eq!(Value::Float64(0.5).to_string(), "0.5");
    assert_eq!(Value::Float64(3.75).to_string(), "3.75");
}

#[test]
fn float32_keeps_its_shortest_round_trip_form() {
    // Regression: formatting an f32 via `as f64` produced
    // "3.141590118408203" instead of "3.14159".
    assert_eq!(Value::Float32(3.14159).to_string(), "3.14159");
    assert_eq!(Value::Float32(0.1).to_string(), "0.1");
    assert_eq!(Value::Float32(1.5).to_string(), "1.5");
}

#[test]
fn non_finite_floats_keep_conventional_spelling() {
    // These must not gain a ".0" suffix.
    assert_eq!(Value::Float64(f64::INFINITY).to_string(), "inf");
    assert_eq!(Value::Float64(f64::NEG_INFINITY).to_string(), "-inf");
    assert_eq!(Value::Float64(f64::NAN).to_string(), "NaN");
    assert_eq!(Value::Float32(f32::INFINITY).to_string(), "inf");
    assert_eq!(Value::Float32(f32::NAN).to_string(), "NaN");
}

#[test]
fn large_whole_floats_are_not_rounded() {
    // `{:.1}` would have rounded these; the suffix approach must not.
    assert_eq!(
        Value::Float64(1e30).to_string(),
        "1000000000000000000000000000000.0"
    );
    assert_eq!(Value::Float64(1e15).to_string(), "1000000000000000.0");
}

#[test]
fn other_value_kinds_are_unaffected() {
    assert_eq!(Value::Bool(true).to_string(), "true");
    assert_eq!(Value::Char('a').to_string(), "a");
    assert_eq!(Value::String("hi".to_string()).to_string(), "hi");
    assert_eq!(Value::Void.to_string(), "void");
}
