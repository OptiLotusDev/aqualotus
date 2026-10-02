use std::collections::HashMap;

use crate::expr::{check_var_name, eval_expr, render_template, ExprFail};
use crate::types::Type;
use crate::value::Value;

/// Owned variable session: the easy path for single operations.
///
/// `Session` holds function-style variable scope without any IR: `set`
/// declares/assigns, `get` reads inline, `exec_math` evaluates an
/// expression string, `render` renders a print template. All errors are
/// pure `ExprFail` values. The WASM bridge keeps one session for the JS
/// world (see `crate::bridge`); Rust callers own theirs directly.
#[derive(Debug, Clone, Default)]
pub struct Session {
    vars: HashMap<String, Value>,
}

impl Session {
    /// Empty session.
    pub fn new() -> Self {
        Self::default()
    }

    /// Declare/assign a variable. The value must match `ty`, and an
    /// existing variable keeps its original type. `void` is rejected.
    pub fn set(&mut self, name: &str, ty: Type, value: Value) -> Result<(), ExprFail> {
        if ty == Type::Void {
            return Err(ExprFail::TypeMismatch(
                "cannot declare a variable of type void".to_string(),
            ));
        }
        let name = check_var_name(name)?;
        if value.ty() != ty {
            return Err(ExprFail::TypeMismatch(format!(
                "variable '{name}' declared as {} but got {} value",
                ty.tag(),
                value.ty().tag()
            )));
        }
        if let Some(current) = self.vars.get(&name) {
            if current.ty() != ty {
                return Err(ExprFail::TypeMismatch(format!(
                    "cannot change type of variable '{name}' from {} to {}",
                    current.ty().tag(),
                    ty.tag()
                )));
            }
        }
        self.vars.insert(name, value);
        Ok(())
    }

    /// Inline read of a variable. Unknown names are `UnknownVariable`.
    pub fn get(&self, name: &str) -> Result<Value, ExprFail> {
        let name = check_var_name(name)?;
        self.vars
            .get(&name)
            .cloned()
            .ok_or(ExprFail::UnknownVariable(name))
    }

    /// Evaluate an arithmetic expression against session variables.
    /// See `eval_expr` for the language.
    pub fn exec_math(&self, expr: &str) -> Result<Value, ExprFail> {
        eval_expr(expr, &self.vars)
    }

    /// Render a print template against session variables.
    /// See `render_template` for the language.
    pub fn render(&self, template: &str) -> Result<String, ExprFail> {
        render_template(template, &self.vars)
    }

    /// Drop all variables. Returns how many were held.
    pub fn clear(&mut self) -> usize {
        let held = self.vars.len();
        self.vars.clear();
        held
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
                let number: f64 = text.trim().parse().map_err(|_| {
                    ExprFail::Parse(format!("invalid {} literal {text:?}", ty.tag()))
                })?;
                if ty == Type::Float32 {
                    Ok(Value::Float32(number as f32))
                } else {
                    Ok(Value::Float64(number))
                }
            }
            _ => {
                let raw = text.trim().parse::<i128>().map_err(|_| {
                    ExprFail::Parse(format!("invalid {} literal {text:?}", ty.tag()))
                })?;
                narrow_int(raw, ty)
            }
        }
    }
}

fn narrow_int(raw: i128, ty: Type) -> Result<Value, ExprFail> {
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
