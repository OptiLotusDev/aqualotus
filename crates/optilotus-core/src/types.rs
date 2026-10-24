use serde::{Deserialize, Serialize};

/// Optilotus scalar type tags (lowercase on the wire).
///
/// 1:1 with the runtime [`crate::value::Value`] variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Type {
    Int8,
    Int16,
    Int32,
    Int64,
    Int128,
    Uint8,
    Uint16,
    Uint32,
    Uint64,
    Uint128,
    Float32,
    Float64,
    Bool,
    Char,
    String,
    Void,
}

impl Type {
    /// Signed integers: int8..int128.
    pub fn is_signed(self) -> bool {
        matches!(
            self,
            Type::Int8 | Type::Int16 | Type::Int32 | Type::Int64 | Type::Int128
        )
    }

    /// Unsigned integers: uint8..uint128.
    pub fn is_unsigned(self) -> bool {
        matches!(
            self,
            Type::Uint8 | Type::Uint16 | Type::Uint32 | Type::Uint64 | Type::Uint128
        )
    }

    /// Floating point: float32, float64.
    pub fn is_float(self) -> bool {
        matches!(self, Type::Float32 | Type::Float64)
    }

    /// Any numeric type (signed, unsigned, or float).
    pub fn is_numeric(self) -> bool {
        self.is_signed() || self.is_unsigned() || self.is_float()
    }

    /// Lowercase wire tag, matching the serialized form.
    pub fn tag(self) -> &'static str {
        match self {
            Type::Int8 => "int8",
            Type::Int16 => "int16",
            Type::Int32 => "int32",
            Type::Int64 => "int64",
            Type::Int128 => "int128",
            Type::Uint8 => "uint8",
            Type::Uint16 => "uint16",
            Type::Uint32 => "uint32",
            Type::Uint64 => "uint64",
            Type::Uint128 => "uint128",
            Type::Float32 => "float32",
            Type::Float64 => "float64",
            Type::Bool => "bool",
            Type::Char => "char",
            Type::String => "string",
            Type::Void => "void",
        }
    }

    /// Parse a lowercase wire tag back into a `Type`.
    /// Returns `None` for anything else (see `tag` for the valid set).
    pub fn parse_tag(text: &str) -> Option<Type> {
        match text.trim() {
            "int8" => Some(Type::Int8),
            "int16" => Some(Type::Int16),
            "int32" => Some(Type::Int32),
            "int64" => Some(Type::Int64),
            "int128" => Some(Type::Int128),
            "uint8" => Some(Type::Uint8),
            "uint16" => Some(Type::Uint16),
            "uint32" => Some(Type::Uint32),
            "uint64" => Some(Type::Uint64),
            "uint128" => Some(Type::Uint128),
            "float32" => Some(Type::Float32),
            "float64" => Some(Type::Float64),
            "bool" => Some(Type::Bool),
            "char" => Some(Type::Char),
            "string" => Some(Type::String),
            "void" => Some(Type::Void),
            _ => None,
        }
    }
}
