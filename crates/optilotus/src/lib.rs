//! The bridge: DTOs, serialization and the JS/WASM boundary.
//!
//! This crate is the boundary only. The engine lives in
//! `optilotus-core`, which sits on `optilotus-data`; every name the UI
//! and existing consumers use is re-exported here so the layering is
//! invisible to callers (refactor rule 10: the bridge API stays stable).
//!
//! # Expression language
//!
//! Expressions use `{variable}` references and support `+ - * / %` with
//! standard precedence, parentheses, and unary minus. Integer literals
//! are untyped until combined with a typed value, which they adopt
//! (checked). Variable-vs-variable operations are strict same-type-only.
//!
//! Print templates are quoted strings with `{variable}` interpolation.
//! When a template is a single quoted string that forms a valid
//! arithmetic expression after interpolation, the expression is
//! evaluated and the result is printed.
//!
//! # Example
//!
//! ```rust
//! use optilotus::{Package, VecSink, MAIN_ID};
//!
//! let mut pkg = Package::new();
//! pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
//! pkg.declare(MAIN_ID, "y", "int32", Some("5")).unwrap();
//! pkg.declare(MAIN_ID, "z", "int32", None).unwrap();
//! pkg.assign(MAIN_ID, "z", "{x} + {y}").unwrap();
//! pkg.print(MAIN_ID, "\"{z}\"").unwrap();
//!
//! let mut sink = VecSink::default();
//! pkg.run_main(&mut sink).unwrap();
//! assert_eq!(sink.lines, vec!["15".to_string()]);
//! ```

/// The engine, addressable by its own name from the boundary modules.
pub use optilotus_core as engine;

pub mod bridge;
pub mod wire;

pub use optilotus_core::{
    apply_arith, cast_value, parse_input_line, print_text, ArithKind, Op, OpError,
};
pub use optilotus_core::{
    check_var_name, eval_expr, eval_expr_with, render_template, ExprFail, MAX_EXPR_DEPTH,
};
pub use optilotus_core::{
    run_function, run_function_returning, run_function_returning_with_limit,
    run_function_with_limit, run_program_returning_with_limit, run_program_with_limit, ExecReport,
    MAX_CALL_DEPTH, MAX_STEPS,
};
pub use optilotus_core::{
    Access, CommandKind, CommandSpec, CommandSummary, FunctionInfo, FunctionSummary, IfSide,
};
pub use optilotus_core::{
    Command, CommandId, Function, FunctionId, Program, ValueId, MAIN_ID, MAIN_NAME, PACKAGE_NAME,
};
pub use optilotus_core::{ExecError, Package, PackageError};
pub use optilotus_core::{InputSource, PrintSink, VecSink, VecSource};
pub use optilotus_core::{PendingInput, RunSession, RunStatus};
pub use optilotus_core::{Type, Value};

pub use bridge::{
    health_check, package_assign, package_clear, package_create_function, package_declare,
    package_delete_command, package_delete_function, package_get_function, package_input,
    package_list_commands, package_list_functions, package_print, package_rename_function,
    package_return, package_set_entry, package_set_next, run_program, run_program_cancel,
    run_program_provide_input, run_program_start, run_program_status, run_program_with_inputs,
    version, VERSION,
};

// The boundary modules address the engine through its historical module
// paths (`crate::error`, `crate::package`, ...). These aliases keep that
// code unchanged while the modules themselves live in `optilotus-core`.
pub mod error {
    pub use optilotus_core::error::*;
}
pub mod exec {
    pub use optilotus_core::exec::*;
}
pub mod expr {
    pub use optilotus_core::expr::*;
}
pub mod ir {
    pub use optilotus_core::ir::*;
}
pub mod ops {
    pub use optilotus_core::ops::*;
}
pub mod package {
    pub use optilotus_core::package::*;
}
pub mod run_resumable {
    pub use optilotus_core::run_resumable::*;
}
pub mod sink {
    pub use optilotus_core::sink::*;
}
pub mod types {
    pub use optilotus_core::types::*;
}
pub mod value {
    pub use optilotus_core::value::*;
}
