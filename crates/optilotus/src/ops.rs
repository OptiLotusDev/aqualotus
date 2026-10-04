use serde::{Deserialize, Serialize};

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
