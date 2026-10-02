/// Language core: types, values, program model, operations, execution.
///
/// Module layout (flat by design, one concern per file):
/// - `bridge` — UI/runtime boundary (version, health, JSON helpers, WASM exports)
/// - `types` — scalar type tags
/// - `value` — runtime values
/// - `ir` — authoritative program model (`Program`/`Function`/`Command`, `entry`/`next`)
/// - `ops` — primitive operations and pure arithmetic helpers
/// - `expr` — expression/template mini-language (compute, print templates)
/// - `session` — owned variable session (the easy single-operation path)
/// - `exec` — sequential executor over `next` edges
/// - `sink` — explicit effect boundary for `Print`
/// - `error` — typed execution failures with source identity
pub mod bridge;
pub mod error;
pub mod exec;
pub mod expr;
pub mod ir;
pub mod ops;
pub mod session;
pub mod sink;
pub mod types;
pub mod value;

pub use bridge::{
    add, empty_program_json, health_check, run_empty_program_json, run_function_json,
    session_clear, session_exec_math, session_get, session_print, session_set, version,
    PROGRAM_FORMAT_VERSION, VERSION,
};
pub use error::ExecError;
pub use exec::{run_function, run_function_with_limit, ExecReport, MAX_STEPS};
pub use expr::{check_var_name, eval_expr, render_template, ExprFail};
pub use ir::{Command, CommandId, Function, FunctionId, Program, ValueId};
pub use ops::{apply_arith, print_text, ArithKind, Op, OpError};
pub use session::Session;
pub use sink::{PrintSink, VecSink};
pub use types::Type;
pub use value::Value;
