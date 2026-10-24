//! Storage layer: nodes, edges, ids and values.
//!
//! This crate holds the shape of a program's graph and nothing else. It
//! has no notion of commands, branches, validation or execution — those
//! live in `optilotus-core`, which owns the rules for writing here.
//!
//! Nothing in this crate may depend on `optilotus-core`,
//! `optilotus-exec` or `optilotus-bridge` (refactor rule 1: dependencies
//! point one way only).

pub mod edge;
pub mod graph;
pub mod ids;
pub mod node;
pub mod snapshot;
pub mod value;
pub mod value_type;

pub use edge::{Edge, EdgeKind};
pub use graph::Graph;
pub use ids::{EdgeId, FunctionId, NodeId, ValueId};
pub use node::Node;
pub use snapshot::Snapshot;
pub use value::Value;
pub use value_type::Type;
