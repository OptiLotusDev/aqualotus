//! Edges: directed links between nodes.
//!
//! An edge records only that `from` leads to `to`. Whether an edge is
//! control flow, a data dependency, or a branch membership is a meaning
//! the data layer does not attach; it keeps them interchangeable.

use serde::{Deserialize, Serialize};

use crate::ids::{EdgeId, NodeId};

/// What an edge carries. The data layer treats these identically; the
/// tag exists so consumers can tell them apart without guessing from
/// node contents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EdgeKind {
    /// The next node to visit in execution order.
    Control,
    /// A data dependency: `to` reads what `from` produces.
    Data,
    /// `from` is a member of the body owned by `to`.
    Branch,
}

/// One directed edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edge {
    pub id: EdgeId,
    pub from: NodeId,
    pub to: NodeId,
    pub kind: EdgeKind,
}

impl Edge {
    pub fn new(id: EdgeId, from: NodeId, to: NodeId, kind: EdgeKind) -> Self {
        Self { id, from, to, kind }
    }

    /// The node this edge points at.
    pub fn target(&self) -> NodeId {
        self.to
    }

    /// The node this edge leaves.
    pub fn source(&self) -> NodeId {
        self.from
    }
}