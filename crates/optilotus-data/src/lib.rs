//! Data layer: the raw graph store (nodes, edges, snapshots).
//!
//! Independent of `optilotus-core` (business logic). Both are headless
//! and neither depends on the other.

pub mod edge;
pub mod graph;
pub mod ids;
pub mod node;
pub mod snapshot;

pub use edge::{Edge, EdgeKind};
pub use graph::Graph;
pub use ids::{EdgeId, NodeId};
pub use node::Node;
pub use snapshot::Snapshot;