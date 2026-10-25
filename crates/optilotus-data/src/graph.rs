//! The graph: nodes and the edges between them.
//!
//! This is a plain mutable store with no rules attached. Consumers decide
//! which edges are legal and write them through their own lowering step;
//! this crate only keeps them.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::edge::{Edge, EdgeKind};
use crate::ids::{EdgeId, NodeId};
use crate::node::Node;
use crate::snapshot::Snapshot;

/// A mutable graph of nodes and edges.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Graph {
    nodes: HashMap<NodeId, Node>,
    edges: HashMap<EdgeId, Edge>,
    next_edge_id: u32,
}

impl Graph {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert a node, replacing any node already at its id.
    pub fn insert_node(&mut self, node: Node) {
        self.nodes.insert(node.id, node);
    }

    /// Remove a node and every edge touching it. Returns whether the node
    /// was present.
    pub fn remove_node(&mut self, id: NodeId) -> bool {
        if self.nodes.remove(&id).is_none() {
            return false;
        }
        self.edges
            .retain(|_, edge| edge.from != id && edge.to != id);
        true
    }

    /// Add an edge, allocating its id from the graph's counter.
    pub fn add_edge(&mut self, from: NodeId, to: NodeId, kind: EdgeKind) -> EdgeId {
        let id = EdgeId(self.next_edge_id);
        self.next_edge_id += 1;
        self.edges.insert(id, Edge::new(id, from, to, kind));
        id
    }

    /// Add an edge that already carries an id.
    pub fn insert_edge(&mut self, edge: Edge) {
        self.next_edge_id = self.next_edge_id.max(edge.id.0 + 1);
        self.edges.insert(edge.id, edge);
    }

    pub fn remove_edge(&mut self, id: EdgeId) -> bool {
        self.edges.remove(&id).is_some()
    }

    pub fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(&id)
    }

    pub fn edge(&self, id: EdgeId) -> Option<&Edge> {
        self.edges.get(&id)
    }

    pub fn nodes(&self) -> impl Iterator<Item = &Node> {
        self.nodes.values()
    }

    pub fn edges(&self) -> impl Iterator<Item = &Edge> {
        self.edges.values()
    }

    /// Every edge leaving `id`.
    pub fn outgoing(&self, id: NodeId) -> impl Iterator<Item = &Edge> {
        self.edges.values().filter(move |e| e.from == id)
    }

    /// Every edge arriving at `id`.
    pub fn incoming(&self, id: NodeId) -> impl Iterator<Item = &Edge> {
        self.edges.values().filter(move |e| e.to == id)
    }

    /// Every edge of one kind leaving `id`.
    pub fn outgoing_of_kind(&self, id: NodeId, kind: EdgeKind) -> impl Iterator<Item = &Edge> {
        self.edges
            .values()
            .filter(move |e| e.from == id && e.kind == kind)
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// An immutable copy of the current nodes and edges.
    pub fn snapshot(&self) -> Snapshot {
        let mut nodes: Vec<Node> = self.nodes.values().cloned().collect();
        nodes.sort_by_key(|n| n.id.0);
        let mut edges: Vec<Edge> = self.edges.values().cloned().collect();
        edges.sort_by_key(|e| e.id.0);
        Snapshot::capture(nodes, edges)
    }
}