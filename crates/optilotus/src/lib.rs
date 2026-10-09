//! Language core: types, values, program model, operations, execution.
//!
//! Optilotus is a small, headless, deterministic programming language and
//! runtime.  It has no UI dependencies; the same core compiles to WASM for
//! the web and to a native library for desktop/mobile.
//!
//! # Architecture
//!
//! ```text
//! Program IR ──▶ Validation ──▶ Scheduler ──▶ Runtime
//! ```
//!
//! The IR is the single source of truth.  The editor (Aqualotus) is a
//! projection; it never owns program semantics.
//!
//! # Module layout (flat by design, one concern per file)
//!
//! | Module | Responsibility |
//! |--------|---------------|
//! | `bridge` | UI/runtime boundary (version, health, JSON helpers, WASM exports) |
//! | `types` | Scalar type tags (`Type` enum, parsing) |
//! | `value` | Runtime values (`Value` enum, one variant per type) |
//! | `ir` | Authoritative program model (`Program`/`Function`/`Command`, `entry`/`next`) |
//! | `ops` | Primitive operations (`Op` enum) and pure arithmetic helpers |
//! | `expr` | Expression/template mini-language (compute, print templates) |
//! | `exec` | Sequential executor over `next` edges |
//! | `sink` | Explicit effect boundary for `Print` |
//! | `error` | Typed execution failures with source identity |
//! | `package` | Owned single-package registry (many functions, stable `main`) |
//!
//! # Expression language
//!
//! Expressions use `{variable}` references and support `+ - * / %` with
//! standard precedence, parentheses, and unary minus.  Integer literals are
//! untyped until combined with a typed value, which they adopt (checked).
//! Variable-vs-variable operations are strict same-type-only.
//!
//! Print templates are quoted strings with `{variable}` interpolation.  When
//! a template is a single quoted string that forms a valid arithmetic
//! expression after interpolation, the expression is evaluated and the
//! result is printed (e.g. `"{x} + {y}"` prints `15` when `x=10`, `y=5`).
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

pub mod bridge;
pub mod error;
pub mod exec;
pub mod expr;
pub mod ir;
pub mod ops;
pub mod package;
pub mod sink;
pub mod types;
pub mod value;

pub use bridge::{
    health_check, package_assign, package_clear, package_create_function, package_declare,
    package_delete_command, package_delete_function, package_get_function, package_list_commands,
    package_list_functions, package_print, package_return, package_set_entry, package_set_next,
    run_program, version, VERSION,
};
pub use error::ExecError;
pub use exec::{
    run_function, run_function_returning, run_function_returning_with_limit,
    run_function_with_limit, run_program as run_program_exec, run_program_returning_with_limit,
    run_program_with_limit, ExecReport, MAX_CALL_DEPTH, MAX_STEPS,
};
pub use expr::{
    check_var_name, eval_expr, eval_expr_with, render_template, ExprFail, MAX_EXPR_DEPTH,
};
pub use ir::{Command, CommandId, Function, FunctionId, Program, ValueId};
pub use ops::{apply_arith, print_text, ArithKind, Op, OpError};
pub use package::{
    CommandKind, CommandSummary, FunctionInfo, FunctionSummary, Package, PackageError, MAIN_ID,
    MAIN_NAME, PACKAGE_NAME,
};
pub use sink::{PrintSink, VecSink};
pub use types::Type;
pub use value::Value;
