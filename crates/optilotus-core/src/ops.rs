use serde::{Deserialize, Serialize};

use crate::ir::{CommandId, ValueId};
use crate::types::Type;
use crate::value::Value;

/// Phase 1 primitive operations.
///
/// Maths is written as strings via `Compute`, not as dedicated arithmetic
/// commands: there are deliberately no `Add`/`Sub`/`Mul`/`Div`/`Mod` ops.
/// The checked same-type arithmetic below is `Compute`'s engine, kept as
/// pure helpers so expressions stay total and explicit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Op {
    /// Constant. 0 inputs, 0..1 outputs.
    Lit(Value),
    /// Effect: prints one value. 1 input, 0 outputs.
    /// `String` inputs are templates (see `crate::expr::render_template`).
    Print,
    /// Effect: read one line and parse it as `ty`. 0 inputs, 1 output.
    Input { ty: Type },
    /// Convert a value to `to`. 1 input, 1 output.
    Cast { to: Type },
    /// Declare/assign a function-scoped variable. 1 input, 0 outputs.
    /// The input value must match `ty`, and a re-declared variable keeps
    /// its original type.
    Set { var: String, ty: Type },
    /// Inline read of a function-scoped variable. 0 inputs, 1 output.
    Get { var: String },
    /// Evaluate an arithmetic expression (see `crate::expr::eval_expr`).
    /// 0 inputs, 1 output.
    Compute { expr: String },
    /// Evaluate an expression, store it as the function return value and
    /// stop the function. 0 inputs, 0 outputs. The value is used when
    /// another function calls this one in expression text (`name()`).
    Return { expr: String },
    /// Branch on a Bool condition. 1 input (condition), 0 outputs.
    /// `then_body` and `else_body` are ordered lists of child command IDs.
    If {
        condition: ValueId,
        then_body: Vec<CommandId>,
        else_body: Option<Vec<CommandId>>,
    },
}

/// Pure arithmetic failure, without command identity.
/// The executor attaches the `CommandId`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpError {
    TypeMismatch(String),
    Overflow,
    DivByZero,
}

/// Which arithmetic operation to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArithKind {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
}

/// Pure helper: apply same-type checked arithmetic.
///
/// Ints use checked ops (`None` -> `Overflow`, zero divisor ->
/// `DivByZero`). Floats use IEEE semantics. Anything else is a
/// `TypeMismatch`. Mixed types are always a `TypeMismatch`.
pub fn apply_arith(kind: ArithKind, left: &Value, right: &Value) -> Result<Value, OpError> {
    if left.ty() != right.ty() {
        return Err(OpError::TypeMismatch(format!(
            "cannot combine {:?} with {:?}",
            left.ty(),
            right.ty()
        )));
    }
    match (kind, left, right) {
        (k, Value::Int8(a), Value::Int8(b)) => int_arith(*a, *b, k, Value::Int8),
        (k, Value::Int16(a), Value::Int16(b)) => int_arith(*a, *b, k, Value::Int16),
        (k, Value::Int32(a), Value::Int32(b)) => int_arith(*a, *b, k, Value::Int32),
        (k, Value::Int64(a), Value::Int64(b)) => int_arith(*a, *b, k, Value::Int64),
        (k, Value::Int128(a), Value::Int128(b)) => int_arith(*a, *b, k, Value::Int128),
        (k, Value::Uint8(a), Value::Uint8(b)) => uint_arith(*a, *b, k, Value::Uint8),
        (k, Value::Uint16(a), Value::Uint16(b)) => uint_arith(*a, *b, k, Value::Uint16),
        (k, Value::Uint32(a), Value::Uint32(b)) => uint_arith(*a, *b, k, Value::Uint32),
        (k, Value::Uint64(a), Value::Uint64(b)) => uint_arith(*a, *b, k, Value::Uint64),
        (k, Value::Uint128(a), Value::Uint128(b)) => uint_arith(*a, *b, k, Value::Uint128),
        (ArithKind::Add, Value::Float32(a), Value::Float32(b)) => Ok(Value::Float32(a + b)),
        (ArithKind::Sub, Value::Float32(a), Value::Float32(b)) => Ok(Value::Float32(a - b)),
        (ArithKind::Mul, Value::Float32(a), Value::Float32(b)) => Ok(Value::Float32(a * b)),
        (ArithKind::Div, Value::Float32(a), Value::Float32(b)) => Ok(Value::Float32(a / b)),
        (ArithKind::Mod, Value::Float32(a), Value::Float32(b)) => Ok(Value::Float32(a % b)),
        (ArithKind::Add, Value::Float64(a), Value::Float64(b)) => Ok(Value::Float64(a + b)),
        (ArithKind::Sub, Value::Float64(a), Value::Float64(b)) => Ok(Value::Float64(a - b)),
        (ArithKind::Mul, Value::Float64(a), Value::Float64(b)) => Ok(Value::Float64(a * b)),
        (ArithKind::Div, Value::Float64(a), Value::Float64(b)) => Ok(Value::Float64(a / b)),
        (ArithKind::Mod, Value::Float64(a), Value::Float64(b)) => Ok(Value::Float64(a % b)),
        (_, v, _) => Err(OpError::TypeMismatch(format!(
            "arithmetic not defined for {:?}",
            v.ty()
        ))),
    }
}

fn is_zero_divisor(kind: ArithKind, is_zero: bool) -> bool {
    matches!(kind, ArithKind::Div | ArithKind::Mod) && is_zero
}

fn int_arith<T>(a: T, b: T, kind: ArithKind, wrap: fn(T) -> Value) -> Result<Value, OpError>
where
    T: Copy + PartialEq + Default + CheckedArith,
{
    if is_zero_divisor(kind, b == T::default()) {
        return Err(OpError::DivByZero);
    }
    let out = match kind {
        ArithKind::Add => a.checked_add(&b),
        ArithKind::Sub => a.checked_sub(&b),
        ArithKind::Mul => a.checked_mul(&b),
        ArithKind::Div => a.checked_div(&b),
        ArithKind::Mod => a.checked_rem(&b),
    };
    match out {
        Some(v) => Ok(wrap(v)),
        None => Err(OpError::Overflow),
    }
}

fn uint_arith<T>(a: T, b: T, kind: ArithKind, wrap: fn(T) -> Value) -> Result<Value, OpError>
where
    T: Copy + PartialEq + Default + CheckedArith,
{
    int_arith(a, b, kind, wrap)
}

/// Minimal checked-arithmetic interface over the int/uint widths.
pub trait CheckedArith: Sized {
    fn checked_add(&self, other: &Self) -> Option<Self>;
    fn checked_sub(&self, other: &Self) -> Option<Self>;
    fn checked_mul(&self, other: &Self) -> Option<Self>;
    fn checked_div(&self, other: &Self) -> Option<Self>;
    fn checked_rem(&self, other: &Self) -> Option<Self>;
}

macro_rules! impl_checked_arith {
    ($($t:ty),*) => {
        $(
            impl CheckedArith for $t {
                fn checked_add(&self, other: &Self) -> Option<Self> {
                    <$t>::checked_add(*self, *other)
                }
                fn checked_sub(&self, other: &Self) -> Option<Self> {
                    <$t>::checked_sub(*self, *other)
                }
                fn checked_mul(&self, other: &Self) -> Option<Self> {
                    <$t>::checked_mul(*self, *other)
                }
                fn checked_div(&self, other: &Self) -> Option<Self> {
                    <$t>::checked_div(*self, *other)
                }
                fn checked_rem(&self, other: &Self) -> Option<Self> {
                    <$t>::checked_rem(*self, *other)
                }
            }
        )*
    };
}

impl_checked_arith!(i8, i16, i32, i64, i128, u8, u16, u32, u64, u128);

/// Render a value for the `Print` sink.
///
/// `String` content passes through verbatim (including `\n`);
/// every other value uses its `Display` form.
pub fn print_text(value: &Value) -> String {
    value.to_string()
}

/// Parse one input line into a value of the declared type.
pub fn parse_input_line(line: &str, ty: Type) -> Result<Value, String> {
    match ty {
        Type::String => Ok(Value::String(line.to_string())),
        Type::Void => Err("cannot read a value of type void".to_string()),
        Type::Bool => match line.trim().to_ascii_lowercase().as_str() {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            _ => Err(format!(
                "invalid bool input {line:?}: expected \"true\" or \"false\""
            )),
        },
        Type::Char => {
            let trimmed = line.trim();
            let mut chars = trimmed.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Ok(Value::Char(c)),
                _ => Err(format!(
                    "invalid char input {line:?}: expected a single character"
                )),
            }
        }
        Type::Float32 | Type::Float64 => {
            let number: f64 = line
                .trim()
                .parse()
                .map_err(|_| format!("invalid {} input {line:?}", ty.tag()))?;
            if ty == Type::Float32 {
                Ok(Value::Float32(number as f32))
            } else {
                Ok(Value::Float64(number))
            }
        }
        _ => {
            let raw = line
                .trim()
                .parse::<i128>()
                .map_err(|_| format!("invalid {} input {line:?}", ty.tag()))?;
            narrow_input_int(raw, ty).map_err(|e| e.to_string())
        }
    }
}

pub(crate) fn narrow_input_int(raw: i128, ty: Type) -> Result<Value, crate::expr::ExprFail> {
    // reuse package narrow logic via direct matching
    match ty {
        Type::Int8 => i8::try_from(raw)
            .map(Value::Int8)
            .map_err(|_| crate::expr::ExprFail::Overflow),
        Type::Int16 => i16::try_from(raw)
            .map(Value::Int16)
            .map_err(|_| crate::expr::ExprFail::Overflow),
        Type::Int32 => i32::try_from(raw)
            .map(Value::Int32)
            .map_err(|_| crate::expr::ExprFail::Overflow),
        Type::Int64 => i64::try_from(raw)
            .map(Value::Int64)
            .map_err(|_| crate::expr::ExprFail::Overflow),
        Type::Int128 => Ok(Value::Int128(raw)),
        Type::Uint8 => u8::try_from(raw)
            .map(Value::Uint8)
            .map_err(|_| crate::expr::ExprFail::Overflow),
        Type::Uint16 => u16::try_from(raw)
            .map(Value::Uint16)
            .map_err(|_| crate::expr::ExprFail::Overflow),
        Type::Uint32 => u32::try_from(raw)
            .map(Value::Uint32)
            .map_err(|_| crate::expr::ExprFail::Overflow),
        Type::Uint64 => u64::try_from(raw)
            .map(Value::Uint64)
            .map_err(|_| crate::expr::ExprFail::Overflow),
        Type::Uint128 => u128::try_from(raw)
            .map(Value::Uint128)
            .map_err(|_| crate::expr::ExprFail::Overflow),
        _ => Err(crate::expr::ExprFail::TypeMismatch(format!(
            "cannot parse {} value from text",
            ty.tag()
        ))),
    }
}

/// Convert a value into the target type.
pub fn cast_value(value: &Value, to: Type) -> Result<Value, String> {
    if value.ty() == to {
        return Ok(value.clone());
    }
    match to {
        Type::String => Ok(Value::String(value.to_string())),
        Type::Bool => match value {
            Value::Bool(b) => Ok(Value::Bool(*b)),
            Value::Char(c) => Ok(Value::Bool(*c != '\0')),
            Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
                "true" => Ok(Value::Bool(true)),
                "false" => Ok(Value::Bool(false)),
                _ => s
                    .trim()
                    .parse::<f64>()
                    .map(|n| Value::Bool(n != 0.0))
                    .map_err(|_| format!("cannot cast {value:?} to bool")),
            },
            v if v.ty().is_numeric() => {
                // numeric -> bool via zero check
                let n = numeric_to_f64(v)?;
                Ok(Value::Bool(n != 0.0))
            }
            _ => Err(format!("cannot cast {:?} to bool", value.ty())),
        },
        Type::Char => match value {
            Value::Char(c) => Ok(Value::Char(*c)),
            Value::String(s) => {
                let mut chars = s.chars();
                match (chars.next(), chars.next()) {
                    (Some(c), None) => Ok(Value::Char(c)),
                    _ => Err(format!("cannot cast string {s:?} to char")),
                }
            }
            v if v.ty().is_numeric() => {
                let n = numeric_to_i128(v)?;
                char::from_u32(n as u32)
                    .map(Value::Char)
                    .ok_or_else(|| format!("cannot cast {value:?} to char"))
            }
            Value::Bool(b) => Ok(Value::Char(if *b { '1' } else { '0' })),
            _ => Err(format!("cannot cast {:?} to char", value.ty())),
        },
        Type::Float32 => {
            let n = to_f64(value)?;
            Ok(Value::Float32(n as f32))
        }
        Type::Float64 => {
            let n = to_f64(value)?;
            Ok(Value::Float64(n))
        }
        Type::Void => Err("cannot cast to void".to_string()),
        _ => {
            let n = to_i128(value)?;
            // range check
            match to {
                Type::Int8 => i8::try_from(n)
                    .map(Value::Int8)
                    .map_err(|_| format!("overflow casting {value:?} to int8")),
                Type::Int16 => i16::try_from(n)
                    .map(Value::Int16)
                    .map_err(|_| format!("overflow casting {value:?} to int16")),
                Type::Int32 => i32::try_from(n)
                    .map(Value::Int32)
                    .map_err(|_| format!("overflow casting {value:?} to int32")),
                Type::Int64 => i64::try_from(n)
                    .map(Value::Int64)
                    .map_err(|_| format!("overflow casting {value:?} to int64")),
                Type::Int128 => Ok(Value::Int128(n)),
                Type::Uint8 => u8::try_from(n)
                    .map(Value::Uint8)
                    .map_err(|_| format!("overflow casting {value:?} to uint8")),
                Type::Uint16 => u16::try_from(n)
                    .map(Value::Uint16)
                    .map_err(|_| format!("overflow casting {value:?} to uint16")),
                Type::Uint32 => u32::try_from(n)
                    .map(Value::Uint32)
                    .map_err(|_| format!("overflow casting {value:?} to uint32")),
                Type::Uint64 => u64::try_from(n)
                    .map(Value::Uint64)
                    .map_err(|_| format!("overflow casting {value:?} to uint64")),
                Type::Uint128 => u128::try_from(n)
                    .map(Value::Uint128)
                    .map_err(|_| format!("overflow casting {value:?} to uint128")),
                _ => unreachable!(),
            }
        }
    }
}

fn to_f64(value: &Value) -> Result<f64, String> {
    match value {
        Value::Int8(v) => Ok(*v as f64),
        Value::Int16(v) => Ok(*v as f64),
        Value::Int32(v) => Ok(*v as f64),
        Value::Int64(v) => Ok(*v as f64),
        Value::Int128(v) => Ok(*v as f64),
        Value::Uint8(v) => Ok(*v as f64),
        Value::Uint16(v) => Ok(*v as f64),
        Value::Uint32(v) => Ok(*v as f64),
        Value::Uint64(v) => Ok(*v as f64),
        Value::Uint128(v) => Ok(*v as f64),
        Value::Float32(v) => Ok(*v as f64),
        Value::Float64(v) => Ok(*v),
        Value::Bool(v) => Ok(if *v { 1.0 } else { 0.0 }),
        Value::Char(v) => Ok(*v as u32 as f64),
        Value::String(s) => s
            .trim()
            .parse::<f64>()
            .map_err(|_| format!("cannot cast string {s:?} to number")),
        Value::Void => Err("cannot cast void to number".to_string()),
    }
}

fn to_i128(value: &Value) -> Result<i128, String> {
    match value {
        Value::Int8(v) => Ok(*v as i128),
        Value::Int16(v) => Ok(*v as i128),
        Value::Int32(v) => Ok(*v as i128),
        Value::Int64(v) => Ok(*v as i128),
        Value::Int128(v) => Ok(*v),
        Value::Uint8(v) => Ok(*v as i128),
        Value::Uint16(v) => Ok(*v as i128),
        Value::Uint32(v) => Ok(*v as i128),
        Value::Uint64(v) => Ok(*v as i128),
        Value::Uint128(v) => {
            i128::try_from(*v).map_err(|_| format!("cannot cast uint128 {v} to int"))
        }
        Value::Float32(v) => Ok(*v as i128),
        Value::Float64(v) => Ok(*v as i128),
        Value::Bool(v) => Ok(if *v { 1 } else { 0 }),
        Value::Char(v) => Ok(*v as i128),
        Value::String(s) => s
            .trim()
            .parse::<i128>()
            .map_err(|_| format!("cannot cast string {s:?} to integer")),
        Value::Void => Err("cannot cast void to integer".to_string()),
    }
}

fn numeric_to_f64(value: &Value) -> Result<f64, String> {
    to_f64(value)
}

fn numeric_to_i128(value: &Value) -> Result<i128, String> {
    to_i128(value)
}
