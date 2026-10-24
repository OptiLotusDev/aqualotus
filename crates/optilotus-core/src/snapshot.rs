//! An immutable copy of a graph.
//!
//! A snapshot is a value: taking one never borrows the graph it came
//! from, and two snapshots of the same graph compare equal. This is what
//! makes a graph safe to hand to a reader while an edit is being prepared.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::edge::Edge;
use crate::ids::{EdgeId, NodeId};
use crate::node::Node;

/// A copied graph, indexed for lookup.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
    nodes_by_id: HashMap<NodeId, usize>,
    edges_by_id: HashMap<EdgeId, usize>,
}

impl Snapshot {
    /// A snapshot of nothing.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Capture `nodes` and `edges`. Duplicate ids are kept as given; the
    /// indexes then point at the first occurrence.
    pub fn capture(nodes: Vec<Node>, edges: Vec<Edge>) -> Self {
        let mut nodes_by_id = HashMap::with_capacity(nodes.len());
        for (index, node) in nodes.iter().enumerate() {
            nodes_by_id.entry(node.id).or_insert(index);
        }
        let mut edges_by_id = HashMap::with_capacity(edges.len());
        for (index, edge) in edges.iter().enumerate() {
            edges_by_id.entry(edge.id).or_insert(index);
        }
        Self {
            nodes,
            edges,
            nodes_by_id,
            edges_by_id,
        }
    }

    pub fn nodes(&self) -> &[Node] {
        &self.nodes
    }

    pub fn edges(&self) -> &[Edge] {
        &self.edges
    }

    pub fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes_by_id.get(&id).map(|&i| &self.nodes[i])
    }

    pub fn edge(&self, id: EdgeId) -> Option<&Edge> {
        self.edges_by_id.get(&id).map(|&i| &self.edges[i])
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}
