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
            Value::Float32(v) => write!(f, "{v}"),
            Value::Float64(v) => write!(f, "{v}"),
            Value::Bool(v) => write!(f, "{v}"),
            Value::Char(v) => write!(f, "{v}"),
            Value::String(v) => write!(f, "{v}"),
            Value::Void => write!(f, "void"),
        }
    }
}
