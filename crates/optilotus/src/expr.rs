use std::cmp::Ordering;
use std::collections::HashMap;
use std::fmt;

use crate::ops::{apply_arith, ArithKind, OpError};
use crate::types::Type;
use crate::value::Value;

/// Maximum parenthesis nesting in a `Compute` expression.
/// Bounds recursion in the parser; deeper input is a parse error.
pub const MAX_EXPR_DEPTH: usize = 64;

/// Pure failure of expression/template evaluation, without command identity.
/// The executor attaches the `CommandId`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExprFail {
    Parse(String),
    UnknownVariable(String),
    TypeMismatch(String),
    Overflow,
    DivByZero,
    UnknownFunction(String),
    MissingReturn(String),
    /// A callee already failed with a fully-typed error (keeps its own
    /// command id); the executor propagates it unwrapped.
    Callee(Box<crate::error::ExecError>),
}

impl fmt::Display for ExprFail {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExprFail::Parse(detail) => write!(f, "{detail}"),
            ExprFail::UnknownVariable(var) => write!(f, "unknown variable {var:?}"),
            ExprFail::TypeMismatch(detail) => write!(f, "{detail}"),
            ExprFail::Overflow => write!(f, "integer overflow"),
            ExprFail::DivByZero => write!(f, "division by zero"),
            ExprFail::UnknownFunction(name) => write!(f, "unknown function {name:?}"),
            ExprFail::MissingReturn(name) => {
                write!(f, "function {name:?} returned no value")
            }
            ExprFail::Callee(inner) => write!(f, "{inner}"),
        }
    }
}

impl std::error::Error for ExprFail {}

/// Validate a variable name shared by `Set`, `Get`, `{refs}` and templates.
///
/// Trims surrounding whitespace, rejects empty names and names containing
/// `{`, `}` or `"`. Returns the trimmed name.
pub fn check_var_name(raw: &str) -> Result<String, ExprFail> {
    let name = raw.trim().to_string();
    if name.is_empty() {
        return Err(ExprFail::Parse("empty variable name".to_string()));
    }
    if name.chars().any(|c| c == '{' || c == '}' || c == '"') {
        return Err(ExprFail::Parse(format!(
            "invalid variable name {name:?}: must not contain '{{', '}}' or '\"'"
        )));
    }
    Ok(name)
}

// ---------------------------------------------------------------------------
// Compute expressions: "(3 + 4) % 2", "{count} * 2", ...
// ---------------------------------------------------------------------------

/// Untyped numeric literal inside an expression.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Num {
    Int(i128),
    Float(f64),
}

/// Partial evaluation result: still-untyped constant, or typed value.
#[derive(Debug, Clone, PartialEq)]
enum Partial {
    Const(Num),
    Val(Value),
}

/// Evaluate an arithmetic expression with `{variable}` references.
///
/// Grammar: `+ - * / %`, parentheses, unary minus, standard precedence,
/// integer/float literals, `{name}` variable reads. Integer literals are
/// untyped until combined with a typed value, which they adopt (checked,
/// so `300` with an `int8` variable is `Overflow`); literal-only results
/// narrow to `int32`/`int64`/`int128` (integers) or `float64` (floats).
/// Variable-vs-variable operations stay strict same-type-only.
pub fn eval_expr(expr: &str, vars: &HashMap<String, Value>) -> Result<Value, ExprFail> {
    let mut no_calls = |name: &str| -> Result<Value, ExprFail> {
        Err(ExprFail::UnknownFunction(name.to_string()))
    };
    eval_expr_with(expr, vars, &mut no_calls)
}

/// Same as [`eval_expr`] but `name()` calls resolve via `call` (zero-arg).
/// Unknown names are `UnknownFunction`, callees without `Return` are
/// `MissingReturn`, and nested callee failures travel as `Callee` (kept
/// typed, with their own command id). Calling `main` is rejected by the
/// caller (entry only).
pub fn eval_expr_with(
    expr: &str,
    vars: &HashMap<String, Value>,
    call: &mut dyn FnMut(&str) -> Result<Value, ExprFail>,
) -> Result<Value, ExprFail> {
    let mut parser = ExprParser {
        text: expr,
        pos: 0,
        depth: 0,
        call,
    };
    parser.skip_ws();
    if parser.peek().is_none() {
        return Err(ExprFail::Parse("empty expression".to_string()));
    }
    let out = parser.parse_cmp(vars)?;
    parser.skip_ws();
    if let Some(c) = parser.peek() {
        return Err(ExprFail::Parse(format!(
            "unexpected {c:?} at {}: expected end of expression",
            parser.pos
        )));
    }
    finalize(out)
}

struct ExprParser<'a, 'b> {
    text: &'a str,
    pos: usize,
    depth: usize,
    call: &'b mut dyn FnMut(&str) -> Result<Value, ExprFail>,
}

impl<'a, 'b> ExprParser<'a, 'b> {
    fn peek(&self) -> Option<char> {
        self.text[self.pos..].chars().next()
    }

    fn bump(&mut self) {
        if let Some(c) = self.peek() {
            self.pos += c.len_utf8();
        }
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(c) if c.is_whitespace()) {
            self.bump();
        }
    }

    fn parse_error(&self, what: &str) -> ExprFail {
        ExprFail::Parse(format!("parse error at {}: {what}", self.pos))
    }

    fn parse_cmp(&mut self, vars: &HashMap<String, Value>) -> Result<Partial, ExprFail> {
        let left = self.parse_add(vars)?;
        self.skip_ws();
        let kind = match self.peek() {
            Some('=') => {
                self.bump();
                if self.peek() == Some('=') {
                    self.bump();
                    CmpKind::Eq
                } else {
                    return Err(self.parse_error("expected '=='"));
                }
            }
            Some('!') => {
                self.bump();
                if self.peek() == Some('=') {
                    self.bump();
                    CmpKind::Ne
                } else {
                    return Err(self.parse_error("expected '!='"));
                }
            }
            Some('<') => {
                self.bump();
                if self.peek() == Some('=') {
                    self.bump();
                    CmpKind::Le
                } else {
                    CmpKind::Lt
                }
            }
            Some('>') => {
                self.bump();
                if self.peek() == Some('=') {
                    self.bump();
                    CmpKind::Ge
                } else {
                    CmpKind::Gt
                }
            }
            _ => return Ok(left),
        };
        let right = self.parse_add(vars)?;
        compare(kind, left, right)
    }

    fn parse_add(&mut self, vars: &HashMap<String, Value>) -> Result<Partial, ExprFail> {
        let mut left = self.parse_mul(vars)?;
        loop {
            self.skip_ws();
            let kind = match self.peek() {
                Some('+') => ArithKind::Add,
                Some('-') => ArithKind::Sub,
                _ => return Ok(left),
            };
            self.bump();
            let right = self.parse_mul(vars)?;
            left = combine(kind, left, right)?;
        }
    }

    fn parse_mul(&mut self, vars: &HashMap<String, Value>) -> Result<Partial, ExprFail> {
        let mut left = self.parse_unary(vars)?;
        loop {
            self.skip_ws();
            let kind = match self.peek() {
                Some('*') => ArithKind::Mul,
                Some('/') => ArithKind::Div,
                Some('%') => ArithKind::Mod,
                _ => return Ok(left),
            };
            self.bump();
            let right = self.parse_unary(vars)?;
            left = combine(kind, left, right)?;
        }
    }

    fn parse_unary(&mut self, vars: &HashMap<String, Value>) -> Result<Partial, ExprFail> {
        self.skip_ws();
        if self.peek() == Some('-') {
            self.bump();
            let inner = self.parse_unary(vars)?;
            return negate_partial(inner);
        }
        self.parse_primary(vars)
    }

    fn parse_primary(&mut self, vars: &HashMap<String, Value>) -> Result<Partial, ExprFail> {
        self.skip_ws();
        match self.peek() {
            None => Err(self.parse_error("expected a number, '{variable}', '\"string\"' or '('")),
            Some('(') => {
                if self.depth >= MAX_EXPR_DEPTH {
                    return Err(ExprFail::Parse("expression too deeply nested".to_string()));
                }
                self.bump();
                self.depth += 1;
                let out = self.parse_add(vars);
                self.depth -= 1;
                let out = out?;
                self.skip_ws();
                match self.peek() {
                    Some(')') => {
                        self.bump();
                        Ok(out)
                    }
                    _ => Err(self.parse_error("expected ')'")),
                }
            }
            Some('{') => {
                let name = self.parse_ref()?;
                vars.get(&name)
                    .cloned()
                    .map(Partial::Val)
                    .ok_or(ExprFail::UnknownVariable(name))
            }
            Some(c) if c.is_ascii_digit() || c == '.' => self.lex_number().map(Partial::Const),
            Some('"') => {
                let text = self.parse_string(vars)?;
                Ok(Partial::Val(Value::String(text)))
            }
            Some(c) if c.is_ascii_alphabetic() || c == '_' => {
                let start = self.pos;
                while let Some(c) = self.peek() {
                    if c.is_ascii_alphanumeric() || c == '_' {
                        self.bump();
                    } else {
                        break;
                    }
                }
                let word = &self.text[start..self.pos];
                match word {
                    "true" => Ok(Partial::Val(Value::Bool(true))),
                    "false" => Ok(Partial::Val(Value::Bool(false))),
                    _ => {
                        self.pos = start;
                        self.parse_call()
                    }
                }
            }
            Some(c) => Err(self.parse_error(&format!("unexpected {c:?}"))),
        }
    }

    /// Parse `name()` (zero-arg). Bare identifiers are rejected: use
    /// `{var}` for variables. Non-empty args are a parse error for now
    /// (formal parameters are deferred; see the package plan).
    fn parse_call(&mut self) -> Result<Partial, ExprFail> {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == '_' {
                self.bump();
            } else {
                break;
            }
        }
        let name = self.text[start..self.pos].to_string();
        if name.is_empty() {
            return Err(self.parse_error("expected a function name"));
        }
        self.skip_ws();
        if self.peek() != Some('(') {
            return Err(self.parse_error(&format!(
                "unexpected identifier {name:?}: use '{{variable}}' for variables or '{name}()' for calls"
            )));
        }
        self.bump(); // '('
        self.skip_ws();
        match self.peek() {
            Some(')') => {
                self.bump();
                let value = (self.call)(&name)?;
                Ok(Partial::Val(value))
            }
            _ => Err(self.parse_error("function arguments are not supported; use name()")),
        }
    }

    /// Parse a single `"..."` string literal with `\\ \" \n \{ \}`
    /// escapes and `{var}` interpolation.
    fn parse_string(&mut self, vars: &HashMap<String, Value>) -> Result<String, ExprFail> {
        let open = self.pos;
        self.bump(); // opening quote
        let mut out = String::new();
        loop {
            match self.peek() {
                None => {
                    return Err(ExprFail::Parse(format!(
                        "parse error at {open}: unclosed '\"', expected closing quote"
                    )));
                }
                Some('"') => {
                    self.bump();
                    return Ok(out);
                }
                Some('\\') => {
                    self.bump();
                    match self.peek() {
                        Some('"') => out.push('"'),
                        Some('\\') => out.push('\\'),
                        Some('n') => out.push('\n'),
                        Some('{') => out.push('{'),
                        Some('}') => out.push('}'),
                        Some(c) => {
                            return Err(ExprFail::Parse(format!(
                                "parse error at {}: unknown escape '\\{c}'; use \\\" \\\\ \\n \\{{ or \\}}",
                                self.pos
                            )));
                        }
                        None => {
                            return Err(ExprFail::Parse(format!(
                                "parse error at {open}: unclosed '\"', expected closing quote"
                            )));
                        }
                    }
                    self.bump();
                }
                Some('{') => {
                    let name = self.parse_ref()?;
                    let value = vars.get(&name).ok_or(ExprFail::UnknownVariable(name))?;
                    out.push_str(&value.to_string());
                }
                Some(c) => {
                    out.push(c);
                    self.bump();
                }
            }
        }
    }

    /// Parse `{name}` assuming the opening brace is next. Returns the
    /// validated (trimmed) variable name.
    fn parse_ref(&mut self) -> Result<String, ExprFail> {
        let open = self.pos;
        self.bump(); // consume '{'
        let start = self.pos;
        loop {
            match self.peek() {
                None => {
                    return Err(ExprFail::Parse(format!(
                        "parse error at {open}: unclosed '{{', expected '}}'"
                    )));
                }
                Some('}') => {
                    let raw = &self.text[start..self.pos];
                    self.bump();
                    return check_var_name(raw);
                }
                _ => self.bump(),
            }
        }
    }

    fn lex_number(&mut self) -> Result<Num, ExprFail> {
        let start = self.pos;
        let mut seen_dot = false;
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() {
                self.bump();
            } else if c == '.' && !seen_dot {
                seen_dot = true;
                self.bump();
            } else {
                break;
            }
        }
        let text = &self.text[start..self.pos];
        if !text.chars().any(|c| c.is_ascii_digit()) {
            return Err(self.parse_error("expected a number"));
        }
        if seen_dot {
            text.parse::<f64>()
                .map(Num::Float)
                .map_err(|_| self.parse_error(&format!("invalid number {text:?}")))
        } else {
            text.parse::<i128>()
                .map(Num::Int)
                .map_err(|_| ExprFail::Overflow)
        }
    }
}

fn combine(kind: ArithKind, left: Partial, right: Partial) -> Result<Partial, ExprFail> {
    match (left, right) {
        (Partial::Const(a), Partial::Const(b)) => combine_const(kind, a, b).map(Partial::Const),
        (Partial::Val(v), Partial::Const(c)) => {
            let typed = const_into_value(c, v.ty())?;
            apply_vals(kind, &v, &typed)
        }
        (Partial::Const(c), Partial::Val(v)) => {
            let typed = const_into_value(c, v.ty())?;
            apply_vals(kind, &typed, &v)
        }
        (Partial::Val(a), Partial::Val(b)) => apply_vals(kind, &a, &b),
    }
}

fn apply_vals(kind: ArithKind, left: &Value, right: &Value) -> Result<Partial, ExprFail> {
    apply_arith(kind, left, right)
        .map(Partial::Val)
        .map_err(|e| match e {
            OpError::TypeMismatch(detail) => ExprFail::TypeMismatch(detail),
            OpError::Overflow => ExprFail::Overflow,
            OpError::DivByZero => ExprFail::DivByZero,
        })
}

fn combine_const(kind: ArithKind, a: Num, b: Num) -> Result<Num, ExprFail> {
    match (a, b) {
        (Num::Int(x), Num::Int(y)) => {
            if matches!(kind, ArithKind::Div | ArithKind::Mod) && y == 0 {
                return Err(ExprFail::DivByZero);
            }
            let out = match kind {
                ArithKind::Add => x.checked_add(y),
                ArithKind::Sub => x.checked_sub(y),
                ArithKind::Mul => x.checked_mul(y),
                ArithKind::Div => x.checked_div(y),
                ArithKind::Mod => x.checked_rem(y),
            };
            out.map(Num::Int).ok_or(ExprFail::Overflow)
        }
        (x, y) => {
            let (xf, yf) = (const_as_f64(x), const_as_f64(y));
            Ok(Num::Float(match kind {
                ArithKind::Add => xf + yf,
                ArithKind::Sub => xf - yf,
                ArithKind::Mul => xf * yf,
                ArithKind::Div => xf / yf,
                ArithKind::Mod => xf % yf,
            }))
        }
    }
}

fn const_as_f64(n: Num) -> f64 {
    match n {
        Num::Int(i) => i as f64,
        Num::Float(f) => f,
    }
}

/// Which comparison operation to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CmpKind {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

fn compare(kind: CmpKind, left: Partial, right: Partial) -> Result<Partial, ExprFail> {
    match (left, right) {
        (Partial::Const(a), Partial::Const(b)) => {
            compare_const(kind, a, b).map(|b| Partial::Val(Value::Bool(b)))
        }
        (Partial::Val(v), Partial::Const(c)) => {
            let typed = const_into_value(c, v.ty())?;
            compare_vals(kind, &v, &typed)
        }
        (Partial::Const(c), Partial::Val(v)) => {
            let typed = const_into_value(c, v.ty())?;
            compare_vals(kind, &typed, &v)
        }
        (Partial::Val(a), Partial::Val(b)) => compare_vals(kind, &a, &b),
    }
}

fn compare_const(kind: CmpKind, a: Num, b: Num) -> Result<bool, ExprFail> {
    match (a, b) {
        (Num::Int(x), Num::Int(y)) => Ok(apply_cmp(kind, x, y)),
        (Num::Float(x), Num::Float(y)) => Ok(apply_cmp(kind, x, y)),
        _ => Err(ExprFail::TypeMismatch(
            "cannot compare int and float literals".to_string(),
        )),
    }
}

fn apply_cmp<T: PartialOrd>(kind: CmpKind, a: T, b: T) -> bool {
    match kind {
        CmpKind::Eq => a == b,
        CmpKind::Ne => a != b,
        CmpKind::Lt => a < b,
        CmpKind::Le => a <= b,
        CmpKind::Gt => a > b,
        CmpKind::Ge => a >= b,
    }
}

fn compare_vals(kind: CmpKind, left: &Value, right: &Value) -> Result<Partial, ExprFail> {
    if left.ty() != right.ty() {
        return Err(ExprFail::TypeMismatch(format!(
            "cannot compare {:?} with {:?}",
            left.ty(),
            right.ty()
        )));
    }
    let Some(ordering) = values_comparable(left, right) else {
        return Err(ExprFail::TypeMismatch(format!(
            "comparison not defined for {:?}",
            left.ty()
        )));
    };
    let result = match kind {
        CmpKind::Eq => ordering == Ordering::Equal,
        CmpKind::Ne => ordering != Ordering::Equal,
        CmpKind::Lt => ordering == Ordering::Less,
        CmpKind::Le => ordering != Ordering::Greater,
        CmpKind::Gt => ordering == Ordering::Greater,
        CmpKind::Ge => ordering != Ordering::Less,
    };
    Ok(Partial::Val(Value::Bool(result)))
}

fn values_comparable(left: &Value, right: &Value) -> Option<Ordering> {
    match (left, right) {
        (Value::Int8(a), Value::Int8(b)) => a.partial_cmp(b),
        (Value::Int16(a), Value::Int16(b)) => a.partial_cmp(b),
        (Value::Int32(a), Value::Int32(b)) => a.partial_cmp(b),
        (Value::Int64(a), Value::Int64(b)) => a.partial_cmp(b),
        (Value::Int128(a), Value::Int128(b)) => a.partial_cmp(b),
        (Value::Uint8(a), Value::Uint8(b)) => a.partial_cmp(b),
        (Value::Uint16(a), Value::Uint16(b)) => a.partial_cmp(b),
        (Value::Uint32(a), Value::Uint32(b)) => a.partial_cmp(b),
        (Value::Uint64(a), Value::Uint64(b)) => a.partial_cmp(b),
        (Value::Uint128(a), Value::Uint128(b)) => a.partial_cmp(b),
        (Value::Float32(a), Value::Float32(b)) => a.partial_cmp(b),
        (Value::Float64(a), Value::Float64(b)) => a.partial_cmp(b),
        (Value::String(a), Value::String(b)) => a.partial_cmp(b),
        (Value::Char(a), Value::Char(b)) => a.partial_cmp(b),
        (Value::Bool(a), Value::Bool(b)) => a.partial_cmp(b),
        _ => None,
    }
}

/// Give an untyped literal the type of the value it combines with.
/// Out-of-range integers are `Overflow`; floats forced into integer
/// types and non-numeric targets are `TypeMismatch`.
fn const_into_value(num: Num, ty: Type) -> Result<Value, ExprFail> {
    match (num, ty) {
        (Num::Int(i), Type::Int8) => i8::try_from(i).map(Value::Int8).map_err(|_| ExprFail::Overflow),
        (Num::Int(i), Type::Int16) => i16::try_from(i)
            .map(Value::Int16)
            .map_err(|_| ExprFail::Overflow),
        (Num::Int(i), Type::Int32) => i32::try_from(i)
            .map(Value::Int32)
            .map_err(|_| ExprFail::Overflow),
        (Num::Int(i), Type::Int64) => i64::try_from(i)
            .map(Value::Int64)
            .map_err(|_| ExprFail::Overflow),
        (Num::Int(i), Type::Int128) => Ok(Value::Int128(i)),
        (Num::Int(i), Type::Uint8) => u8::try_from(i).map(Value::Uint8).map_err(|_| ExprFail::Overflow),
        (Num::Int(i), Type::Uint16) => u16::try_from(i)
            .map(Value::Uint16)
            .map_err(|_| ExprFail::Overflow),
        (Num::Int(i), Type::Uint32) => u32::try_from(i)
            .map(Value::Uint32)
            .map_err(|_| ExprFail::Overflow),
        (Num::Int(i), Type::Uint64) => u64::try_from(i)
            .map(Value::Uint64)
            .map_err(|_| ExprFail::Overflow),
        (Num::Int(i), Type::Uint128) => u128::try_from(i)
            .map(Value::Uint128)
            .map_err(|_| ExprFail::Overflow),
        (Num::Int(i), Type::Float32) => Ok(Value::Float32(i as f32)),
        (Num::Int(i), Type::Float64) => Ok(Value::Float64(i as f64)),
        (Num::Float(f), Type::Float32) => Ok(Value::Float32(f as f32)),
        (Num::Float(f), Type::Float64) => Ok(Value::Float64(f)),
        (Num::Float(f), ty) if ty.is_numeric() => Err(ExprFail::TypeMismatch(format!(
            "float literal {f} cannot be used where {} is expected; use an integer or change the variable type",
            ty.tag()
        ))),
        (_, ty) => Err(ExprFail::TypeMismatch(format!(
            "cannot compute with {} values",
            ty.tag()
        ))),
    }
}

fn negate_partial(p: Partial) -> Result<Partial, ExprFail> {
    match p {
        Partial::Const(Num::Int(i)) => i
            .checked_neg()
            .map(|v| Partial::Const(Num::Int(v)))
            .ok_or(ExprFail::Overflow),
        Partial::Const(Num::Float(f)) => Ok(Partial::Const(Num::Float(-f))),
        Partial::Val(v) => negate_value(v).map(Partial::Val),
    }
}

fn negate_value(v: Value) -> Result<Value, ExprFail> {
    match v {
        Value::Int8(x) => x.checked_neg().map(Value::Int8).ok_or(ExprFail::Overflow),
        Value::Int16(x) => x.checked_neg().map(Value::Int16).ok_or(ExprFail::Overflow),
        Value::Int32(x) => x.checked_neg().map(Value::Int32).ok_or(ExprFail::Overflow),
        Value::Int64(x) => x.checked_neg().map(Value::Int64).ok_or(ExprFail::Overflow),
        Value::Int128(x) => x.checked_neg().map(Value::Int128).ok_or(ExprFail::Overflow),
        Value::Uint8(x) => x.checked_neg().map(Value::Uint8).ok_or(ExprFail::Overflow),
        Value::Uint16(x) => x.checked_neg().map(Value::Uint16).ok_or(ExprFail::Overflow),
        Value::Uint32(x) => x.checked_neg().map(Value::Uint32).ok_or(ExprFail::Overflow),
        Value::Uint64(x) => x.checked_neg().map(Value::Uint64).ok_or(ExprFail::Overflow),
        Value::Uint128(x) => x
            .checked_neg()
            .map(Value::Uint128)
            .ok_or(ExprFail::Overflow),
        Value::Float32(x) => Ok(Value::Float32(-x)),
        Value::Float64(x) => Ok(Value::Float64(-x)),
        other => Err(ExprFail::TypeMismatch(format!(
            "cannot negate {} value",
            other.ty().tag()
        ))),
    }
}

/// Give a literal-only result a concrete type: the narrowest of
/// `int32`/`int64`/`int128` that fits (integers) or `float64` (floats).
fn finalize(p: Partial) -> Result<Value, ExprFail> {
    match p {
        Partial::Val(v) => Ok(v),
        Partial::Const(Num::Int(i)) => {
            if let Ok(v) = i32::try_from(i) {
                Ok(Value::Int32(v))
            } else if let Ok(v) = i64::try_from(i) {
                Ok(Value::Int64(v))
            } else {
                Ok(Value::Int128(i))
            }
        }
        Partial::Const(Num::Float(f)) => Ok(Value::Float64(f)),
    }
}

// ---------------------------------------------------------------------------
// Print templates: "\"Hello {name}\" + \" AAA\"", "{count}", ...
// ---------------------------------------------------------------------------

/// Render a `Print` template with `{variable}` interpolation.
///
/// A template is quoted string literals joined by `+`, e.g.
/// `"Hello {name}" + " AAA"`. `{name}` works inside literals and as a
/// bare piece; any value renders via its `Display` form. Unquoted text,
/// stray operators, unclosed quotes/braces and unknown escapes are parse
/// errors; unknown variables are `UnknownVariable`.
pub fn render_template(template: &str, vars: &HashMap<String, Value>) -> Result<String, ExprFail> {
    let mut parser = TemplateParser {
        text: template,
        pos: 0,
    };
    parser.skip_ws();
    let mut out = String::new();
    if parser.peek().is_none() {
        return Ok(out);
    }
    loop {
        parser.parse_piece(vars, &mut out)?;
        parser.skip_ws();
        match parser.peek() {
            None => return Ok(out),
            Some('+') => {
                parser.bump();
                parser.skip_ws();
            }
            Some(c) => {
                return Err(ExprFail::Parse(format!(
                    "parse error at {}: expected '+' or end of template, found {c:?}",
                    parser.pos
                )));
            }
        }
    }
}

struct TemplateParser<'a> {
    text: &'a str,
    pos: usize,
}

impl<'a> TemplateParser<'a> {
    fn peek(&self) -> Option<char> {
        self.text[self.pos..].chars().next()
    }

    fn bump(&mut self) {
        if let Some(c) = self.peek() {
            self.pos += c.len_utf8();
        }
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(c) if c.is_whitespace()) {
            self.bump();
        }
    }

    fn parse_piece(
        &mut self,
        vars: &HashMap<String, Value>,
        out: &mut String,
    ) -> Result<(), ExprFail> {
        match self.peek() {
            Some('"') => self.parse_quoted(vars, out),
            Some('{') => {
                let name = self.parse_ref()?;
                let value = vars.get(&name).ok_or(ExprFail::UnknownVariable(name))?;
                out.push_str(&value.to_string());
                Ok(())
            }
            Some(c) => Err(ExprFail::Parse(format!(
                "parse error at {}: expected a quoted string or '{{variable}}', found {c:?}; string literals must be quoted",
                self.pos
            ))),
            None => Err(ExprFail::Parse(
                "parse error: expected a quoted string or '{variable}' after '+'".to_string(),
            )),
        }
    }

    fn parse_quoted(
        &mut self,
        vars: &HashMap<String, Value>,
        out: &mut String,
    ) -> Result<(), ExprFail> {
        let open = self.pos;
        self.bump(); // consume opening quote
        let mut interpolated = String::new();
        loop {
            match self.peek() {
                None => {
                    return Err(ExprFail::Parse(format!(
                        "parse error at {open}: unclosed '\"', expected closing quote"
                    )));
                }
                Some('"') => {
                    self.bump();
                    break;
                }
                Some('\\') => {
                    self.bump();
                    match self.peek() {
                        Some('"') => interpolated.push('"'),
                        Some('\\') => interpolated.push('\\'),
                        Some('n') => interpolated.push('\n'),
                        Some('{') => interpolated.push('{'),
                        Some('}') => interpolated.push('}'),
                        Some(c) => {
                            return Err(ExprFail::Parse(format!(
                                "parse error at {}: unknown escape '\\{c}'; use \\\" \\\\ \\n \\{{ or \\}}",
                                self.pos
                            )));
                        }
                        None => {
                            return Err(ExprFail::Parse(format!(
                                "parse error at {open}: unclosed '\"', expected closing quote"
                            )));
                        }
                    }
                    self.bump();
                }
                Some('{') => {
                    let name = self.parse_ref()?;
                    let value = vars.get(&name).ok_or(ExprFail::UnknownVariable(name))?;
                    interpolated.push_str(&value.to_string());
                }
                Some(c) => {
                    interpolated.push(c);
                    self.bump();
                }
            }
        }
        // After interpolation, try evaluating the result as an arithmetic
        // expression.  If it succeeds and produces a non-string value, use
        // that; otherwise fall back to the literal interpolated string.
        match eval_expr(&interpolated, vars) {
            Ok(value) if !matches!(value, Value::String(_)) => {
                out.push_str(&value.to_string());
            }
            _ => {
                out.push_str(&interpolated);
            }
        }
        Ok(())
    }

    fn parse_ref(&mut self) -> Result<String, ExprFail> {
        let open = self.pos;
        self.bump(); // consume '{'
        let start = self.pos;
        loop {
            match self.peek() {
                None => {
                    return Err(ExprFail::Parse(format!(
                        "parse error at {open}: unclosed '{{', expected '}}'"
                    )));
                }
                Some('}') => {
                    let raw = &self.text[start..self.pos];
                    self.bump();
                    return check_var_name(raw);
                }
                _ => self.bump(),
            }
        }
    }
}
