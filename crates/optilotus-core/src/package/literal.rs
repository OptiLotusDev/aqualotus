use crate::expr::ExprFail;
use crate::types::Type;
use crate::value::Value;

pub fn default_value(ty: Type) -> Value {
    match ty {
        Type::Int8 => Value::Int8(0),
        Type::Int16 => Value::Int16(0),
        Type::Int32 => Value::Int32(0),
        Type::Int64 => Value::Int64(0),
        Type::Int128 => Value::Int128(0),
        Type::Uint8 => Value::Uint8(0),
        Type::Uint16 => Value::Uint16(0),
        Type::Uint32 => Value::Uint32(0),
        Type::Uint64 => Value::Uint64(0),
        Type::Uint128 => Value::Uint128(0),
        Type::Float32 => Value::Float32(0.0),
        Type::Float64 => Value::Float64(0.0),
        Type::Bool => Value::Bool(false),
        Type::Char => Value::Char('\0'),
        Type::String => Value::String(String::new()),
        Type::Void => Value::Void,
    }
}

/// Parse user text into a value of the declared type.
///
/// `string` is kept verbatim (no trimming); every other type trims
/// surrounding whitespace. Out-of-range integers are `Overflow`,
/// malformed text is `Parse`, `void` is rejected.
pub fn parse_value(ty: Type, text: &str) -> Result<Value, ExprFail> {
    match ty {
        Type::String => Ok(Value::String(text.to_string())),
        Type::Void => Err(ExprFail::TypeMismatch(
            "cannot declare a variable of type void".to_string(),
        )),
        Type::Bool => match text.trim() {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            _ => Err(ExprFail::Parse(format!(
                "invalid bool literal {text:?}: expected \"true\" or \"false\""
            ))),
        },
        Type::Char => {
            let mut chars = text.trim().chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Ok(Value::Char(c)),
                _ => Err(ExprFail::Parse(format!(
                    "invalid char literal {text:?}: expected a single character"
                ))),
            }
        }
        Type::Float32 | Type::Float64 => {
            let number: f64 = text
                .trim()
                .parse()
                .map_err(|_| ExprFail::Parse(format!("invalid {} literal {text:?}", ty.tag())))?;
            if ty == Type::Float32 {
                Ok(Value::Float32(number as f32))
            } else {
                Ok(Value::Float64(number))
            }
        }
        _ => {
            let raw = text
                .trim()
                .parse::<i128>()
                .map_err(|_| ExprFail::Parse(format!("invalid {} literal {text:?}", ty.tag())))?;
            narrow_int(raw, ty)
        }
    }
}

pub fn narrow_int(raw: i128, ty: Type) -> Result<Value, ExprFail> {
    match ty {
        Type::Int8 => i8::try_from(raw)
            .map(Value::Int8)
            .map_err(|_| ExprFail::Overflow),
        Type::Int16 => i16::try_from(raw)
            .map(Value::Int16)
            .map_err(|_| ExprFail::Overflow),
        Type::Int32 => i32::try_from(raw)
            .map(Value::Int32)
            .map_err(|_| ExprFail::Overflow),
        Type::Int64 => i64::try_from(raw)
            .map(Value::Int64)
            .map_err(|_| ExprFail::Overflow),
        Type::Int128 => Ok(Value::Int128(raw)),
        Type::Uint8 => u8::try_from(raw)
            .map(Value::Uint8)
            .map_err(|_| ExprFail::Overflow),
        Type::Uint16 => u16::try_from(raw)
            .map(Value::Uint16)
            .map_err(|_| ExprFail::Overflow),
        Type::Uint32 => u32::try_from(raw)
            .map(Value::Uint32)
            .map_err(|_| ExprFail::Overflow),
        Type::Uint64 => u64::try_from(raw)
            .map(Value::Uint64)
            .map_err(|_| ExprFail::Overflow),
        Type::Uint128 => u128::try_from(raw)
            .map(Value::Uint128)
            .map_err(|_| ExprFail::Overflow),
        _ => Err(ExprFail::TypeMismatch(format!(
            "cannot parse {} value from text",
            ty.tag()
        ))),
    }
}
