//! The owned single-package registry.
//!
//! One concept per file: the registry shape, its errors, the read models
//! it hands out, the specs callers build from, and the raw command groups
//! each user-level command expands into.

pub mod access;
pub mod branch;
pub mod builders;
pub mod command_summary;
pub mod default;
pub mod delete;
pub mod error;
pub mod functions;
pub mod groups;
pub mod if_side;
pub mod kind;
pub mod literal;
pub mod read;
pub mod registry;
pub mod run;
pub mod spec;
pub mod stage;
pub mod summary;

pub use crate::ir::{CommandId, FunctionId, ValueId};
pub use access::Access;
pub use command_summary::CommandSummary;
pub use error::PackageError;
pub use if_side::IfSide;
pub use kind::CommandKind;
pub use registry::{Package, MAIN_ID, MAIN_NAME, PACKAGE_NAME};
pub use spec::CommandSpec;
pub use summary::{FunctionInfo, FunctionSummary};
