use std::fmt;

use serde::{Deserialize, Serialize};

use crate::types::Type;

/// Runtime value. One variant per [`Type`]; no silent coercion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Value {
    Int8(i8),
    Int16(i16),
    Int32(i32),
    Int64(i64),
    Int128(i128),
    Uint8(u8),
    Uint16(u16),
    Uint32(u32),
    Uint64(u64),
    Uint128(u128),
    Float32(f32),
    Float64(f64),
    Bool(bool),
    Char(char),
    String(String),
    Void,
}

impl Value {
    /// Tag of this value.
    pub fn ty(&self) -> Type {
        match self {
            Value::Int8(_) => Type::Int8,
            Value::Int16(_) => Type::Int16,
            Value::Int32(_) => Type::Int32,
            Value::Int64(_) => Type::Int64,
            Value::Int128(_) => Type::Int128,
            Value::Uint8(_) => Type::Uint8,
            Value::Uint16(_) => Type::Uint16,
            Value::Uint32(_) => Type::Uint32,
            Value::Uint64(_) => Type::Uint64,
            Value::Uint128(_) => Type::Uint128,
            Value::Float32(_) => Type::Float32,
            Value::Float64(_) => Type::Float64,
            Value::Bool(_) => Type::Bool,
            Value::Char(_) => Type::Char,
            Value::String(_) => Type::String,
            Value::Void => Type::Void,
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Int8(v) => write!(f, "{v}"),
            Value::Int16(v) => write!(f, "{v}"),
            Value::Int32(v) => write!(f, "{v}"),
            Value::Int64(v) => write!(f, "{v}"),
            Value::Int128(v) => write!(f, "{v}"),
            Value::Uint8(v) => write!(f, "{v}"),
            Value::Uint16(v) => write!(f, "{v}"),
            Value::Uint32(v) => write!(f, "{v}"),
            Value::Uint64(v) => write!(f, "{v}"),
            Value::Uint128(v) => write!(f, "{v}"),
            Value::Float32(v) => write_float32(f, *v),
            Value::Float64(v) => write_float64(f, *v),
            Value::Bool(v) => write!(f, "{v}"),
            Value::Char(v) => write!(f, "{v}"),
            Value::String(v) => write!(f, "{v}"),
            Value::Void => write!(f, "void"),
        }
    }
}

/// Format a float for display, keeping the decimal point on whole values.
///
/// Rust's `Display` for floats prints `2.0` as `2`. Optilotus has distinct
/// `float32`/`float64` and integer types, so a whole float must stay
/// visually distinguishable from an integer — otherwise `print` output
/// hides the value's type. `2.0` prints as `2.0`, `2.5` as `2.5`.
///
/// Non-finite values keep their conventional spelling (`inf`, `-inf`,
/// `NaN`) rather than gaining a `.0`.
///
/// `f32` and `f64` are formatted separately: widening an `f32` to `f64`
/// would expose its binary expansion (`3.14159` -> `3.141590118408203`),
/// so each keeps its own shortest round-trip form.
fn write_float32(f: &mut fmt::Formatter<'_>, value: f32) -> fmt::Result {
    if value.is_finite() && value.fract() == 0.0 {
        write!(f, "{value}.0")
    } else {
        write!(f, "{value}")
    }
}

/// `f64` counterpart of [`write_float32`].
fn write_float64(f: &mut fmt::Formatter<'_>, value: f64) -> fmt::Result {
    if value.is_finite() && value.fract() == 0.0 {
        write!(f, "{value}.0")
    } else {
        write!(f, "{value}")
    }
}
