//! One unit of storage in the graph.
//!
//! A node holds an opaque payload. The data layer does not interpret it.
//! `outputs` are raw value-slot references (u32); their meaning belongs
//! to whichever consumer interprets the graph.

use serde::{Deserialize, Serialize};

use crate::ids::NodeId;

/// A node: an id, a payload, and the value slots it produces.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    /// Opaque payload. Its meaning belongs to the consumer of the graph.
    pub payload: String,
    /// Raw value-slot references produced by this node.
    pub outputs: Vec<u32>,
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
    pub fn with_outputs(id: NodeId, payload: impl Into<String>, outputs: Vec<u32>) -> Self {
        Self {
            id,
            payload: payload.into(),
            outputs,
        }
    }
}