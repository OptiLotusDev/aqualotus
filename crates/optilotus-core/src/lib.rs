//! Business layer: what a program means.
//!
//! Owns commands, programs, branching, validation, execution and history,
//! plus the storage shape underneath them. Has no crate dependencies above
//! it (refactor rule 1: dependencies point one way only).
//!
//! The graph storage layer (nodes, edges, snapshots) lives in
//! `optilotus-data`, a separate independent crate. This crate knows nothing
//! about it.

pub mod error;
pub mod exec;
pub mod expr;
pub mod ir;
pub mod ops;
pub mod package;
pub mod run_resumable;
pub mod sink;
pub mod types;
pub mod session;
pub mod value;

pub use error::ExecError;
pub use exec::{
    find_main, map_expr_fail_pub, run_command, run_function, run_function_returning,
    run_function_returning_with_limit, run_function_with_limit, run_program,
    run_program_returning_with_limit, run_program_with_limit, set_pause_on_input,
    take_pending_input, ExecReport, MAX_CALL_DEPTH, MAX_STEPS,
};
pub use expr::{
    check_var_name, eval_expr, eval_expr_with, render_template, ExprFail, MAX_EXPR_DEPTH,
};
pub use ir::{Command, CommandId, Function, FunctionId, Program, ValueId};
pub use ops::{apply_arith, cast_value, parse_input_line, print_text, ArithKind, Op, OpError};
pub use package::{
    Access, CommandKind, CommandSpec, CommandSummary, FunctionInfo, FunctionSummary, IfSide,
    Package, PackageError, MAIN_ID, MAIN_NAME, PACKAGE_NAME,
};
pub use run_resumable::{PendingInput, RunSession, RunStatus};
pub use sink::{InputSource, PrintSink, VecSink, VecSource};
pub use types::Type;
pub use value::Value;
