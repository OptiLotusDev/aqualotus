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
/// - `package` — owned single-package registry (many functions, stable `main`)
pub mod bridge;
pub mod error;
pub mod exec;
pub mod expr;
pub mod ir;
pub mod ops;
pub mod package;
pub mod session;
pub mod sink;
pub mod types;
pub mod value;

pub use bridge::{
    health_check, package_assign, package_clear, package_create_function, package_declare,
    package_delete_command, package_delete_function, package_get_function, package_list_commands,
    package_list_functions, package_print, package_return, package_set_entry, package_set_next,
    run_function_json, run_program, session_clear, session_exec_math, session_get, session_print,
    session_set, version, VERSION,
};
pub use error::ExecError;
pub use exec::{
    run_function, run_function_returning, run_function_returning_with_limit,
    run_function_with_limit, run_program as run_program_exec, run_program_returning_with_limit,
    run_program_with_limit, ExecReport, MAX_CALL_DEPTH, MAX_STEPS,
};
pub use expr::{check_var_name, eval_expr, eval_expr_with, render_template, ExprFail};
pub use ir::{Command, CommandId, Function, FunctionId, Program, ValueId};
pub use ops::{apply_arith, print_text, ArithKind, Op, OpError};
pub use package::{
    CommandKind, CommandSummary, FunctionInfo, FunctionSummary, Package, PackageError, MAIN_ID,
    MAIN_NAME,
};
pub use session::Session;
pub use sink::{PrintSink, VecSink};
pub use types::Type;
pub use value::Value;
