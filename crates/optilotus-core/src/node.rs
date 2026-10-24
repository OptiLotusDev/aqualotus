//! One unit of storage in the graph.
//!
//! A node holds an opaque payload. The data layer does not interpret it —
//! `optilotus-core` decides what a payload means and how it may be linked.

use serde::{Deserialize, Serialize};

use crate::ids::NodeId;
use crate::ir::ValueId;

/// A node: an id, a payload, and the value slots it produces.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    /// Opaque payload. Its meaning belongs to `optilotus-core`.
    pub payload: String,
    pub outputs: Vec<ValueId>,
}

impl Node {
    /// A node with no outputs.
    pub fn new(id: NodeId, payload: impl Into<String>) -> Self {
        Self {
            id,
            payload: payload.into(),
            outputs: Vec::new(),
        }
    }

    /// A node producing the given value slots.
    pub fn with_outputs(id: NodeId, payload: impl Into<String>, outputs: Vec<ValueId>) -> Self {
        Self {
            id,
            payload: payload.into(),
            outputs,
        }
    }
}
