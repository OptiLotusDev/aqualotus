//! Comprehensive unit tests for the `optilotus-data` storage layer.
//!
//! These tests guard correctness of the graph store — nodes, edges,
//! snapshots, and stable ids — independent of any business logic.

use optilotus_data::edge::{Edge, EdgeKind};
use optilotus_data::graph::Graph;
use optilotus_data::ids::{EdgeId, NodeId};
use optilotus_data::node::Node;
use optilotus_data::snapshot::Snapshot;

// NodeId / EdgeId

#[test]
fn node_id_get_and_next() {
    let a = NodeId(7);
    assert_eq!(a.get(), 7);
    assert_eq!(a.next_id(), NodeId(8));
    assert_eq!(NodeId::from(0).get(), 0);
}

#[test]
fn edge_id_get_and_next() {
    let a = EdgeId(3);
    assert_eq!(a.get(), 3);
    assert_eq!(a.next_id(), EdgeId(4));
}

#[test]
fn ids_are_hashable_and_comparable() {
    use std::collections::HashSet;
    let mut set = HashSet::new();
    set.insert(NodeId(1));
    set.insert(NodeId(2));
    assert!(set.contains(&NodeId(1)));
    assert!(!set.contains(&NodeId(99)));
}

#[test]
fn ids_display() {
    assert_eq!(NodeId(42).to_string(), "42");
    assert_eq!(EdgeId(13).to_string(), "13");
}

// EdgeKind

#[test]
fn edge_kind_variants() {
    assert!(matches!(EdgeKind::Control, EdgeKind::Control));
    assert!(matches!(EdgeKind::Data, EdgeKind::Data));
    assert!(matches!(EdgeKind::Branch, EdgeKind::Branch));
    assert_ne!(EdgeKind::Control, EdgeKind::Data);
}

// Node

#[test]
fn node_new_with_outputs() {
    let node = Node::with_outputs(NodeId(1), "compute-x", vec![NodeId(5).get()]);
    assert_eq!(node.id, NodeId(1));
    assert_eq!(node.payload, "compute-x");
    assert_eq!(node.outputs, vec![5]);
}

#[test]
fn node_new_no_outputs() {
    let node = Node::new(NodeId(2), "literal-42");
    assert_eq!(node.id, NodeId(2));
    assert_eq!(node.payload, "literal-42");
    assert!(node.outputs.is_empty());
}

#[test]
fn node_eq() {
    let a = Node::new(NodeId(1), "payload");
    let b = Node::new(NodeId(1), "payload");
    let c = Node::new(NodeId(2), "payload");
    assert_eq!(a, b);
    assert_ne!(a, c);
}

// Edge

#[test]
fn edge_new_and_accessors() {
    let edge = Edge::new(EdgeId(1), NodeId(10), NodeId(20), EdgeKind::Control);
    assert_eq!(edge.id, EdgeId(1));
    assert_eq!(edge.from, NodeId(10));
    assert_eq!(edge.to, NodeId(20));
    assert_eq!(edge.kind, EdgeKind::Control);
    assert_eq!(edge.source(), NodeId(10));
    assert_eq!(edge.target(), NodeId(20));
}

#[test]
fn edge_eq_and_hash() {
    use std::collections::HashSet;
    let a = Edge::new(EdgeId(1), NodeId(1), NodeId(2), EdgeKind::Control);
    let b = Edge::new(EdgeId(1), NodeId(1), NodeId(2), EdgeKind::Control);
    let c = Edge::new(EdgeId(2), NodeId(1), NodeId(2), EdgeKind::Control);
    assert_eq!(a, b);
    assert_ne!(a, c);

    let mut set = HashSet::new();
    set.insert(a);
    set.insert(b); // same id — should not duplicate
    assert_eq!(set.len(), 1);
    set.insert(c);
    assert_eq!(set.len(), 2);
}

// Graph

#[test]
fn graph_insert_and_lookup_node() {
    let mut g = Graph::new();
    assert!(g.is_empty());
    assert_eq!(g.len(), 0);

    let node = Node::new(NodeId(1), "alpha");
    g.insert_node(node.clone());
    assert!(!g.is_empty());
    assert_eq!(g.len(), 1);
    assert_eq!(g.node(NodeId(1)), Some(&node));
    assert_eq!(g.node(NodeId(999)), None);
}

#[test]
fn graph_insert_node_replaces() {
    let mut g = Graph::new();
    g.insert_node(Node::new(NodeId(1), "old"));
    g.insert_node(Node::new(NodeId(1), "new"));
    assert_eq!(g.len(), 1);
    assert_eq!(g.node(NodeId(1)).map(|n| n.payload.as_str()), Some("new"));
}

#[test]
fn graph_remove_node_removes_touching_edges() {
    let mut g = Graph::new();
    g.insert_node(Node::new(NodeId(1), "a"));
    g.insert_node(Node::new(NodeId(2), "b"));
    g.insert_node(Node::new(NodeId(3), "c"));
    g.add_edge(NodeId(1), NodeId(2), EdgeKind::Control);
    g.add_edge(NodeId(2), NodeId(3), EdgeKind::Data);

    assert!(g.remove_node(NodeId(2)));
    assert_eq!(g.node(NodeId(2)), None);
    // Both edges touching node 2 are gone.
    assert_eq!(g.edges().count(), 0);

    assert!(!g.remove_node(NodeId(999))); // not present
}

#[test]
fn graph_add_edge_and_lookup() {
    let mut g = Graph::new();
    g.insert_node(Node::new(NodeId(1), "a"));
    g.insert_node(Node::new(NodeId(2), "b"));

    let eid = g.add_edge(NodeId(1), NodeId(2), EdgeKind::Data);
    assert_eq!(eid, EdgeId(0));
    let edge = g.edge(eid).unwrap();
    assert_eq!(edge.source(), NodeId(1));
    assert_eq!(edge.target(), NodeId(2));
    assert_eq!(edge.kind, EdgeKind::Data);
}

#[test]
fn graph_edge_ids_increment() {
    let mut g = Graph::new();
    g.insert_node(Node::new(NodeId(1), "a"));
    g.insert_node(Node::new(NodeId(2), "b"));
    g.insert_node(Node::new(NodeId(3), "c"));

    let e1 = g.add_edge(NodeId(1), NodeId(2), EdgeKind::Control);
    let e2 = g.add_edge(NodeId(2), NodeId(3), EdgeKind::Control);
    assert_eq!(e1, EdgeId(0));
    assert_eq!(e2, EdgeId(1));
}

#[test]
fn graph_insert_edge_allocates_forward() {
    let mut g = Graph::new();
    g.insert_node(Node::new(NodeId(1), "a"));
    g.insert_node(Node::new(NodeId(2), "b"));

    // Insert an edge with id 5; next allocated id should be 6.
    g.insert_edge(Edge::new(EdgeId(5), NodeId(1), NodeId(2), EdgeKind::Branch));
    let next = g.add_edge(NodeId(1), NodeId(2), EdgeKind::Control);
    assert_eq!(next, EdgeId(6));
}

#[test]
fn graph_remove_edge() {
    let mut g = Graph::new();
    g.insert_node(Node::new(NodeId(1), "a"));
    g.insert_node(Node::new(NodeId(2), "b"));
    let eid = g.add_edge(NodeId(1), NodeId(2), EdgeKind::Control);

    assert!(g.remove_edge(eid));
    assert_eq!(g.edge(eid), None);
    assert!(!g.remove_edge(eid)); // already gone
}

#[test]
fn graph_outgoing_and_incoming() {
    let mut g = Graph::new();
    g.insert_node(Node::new(NodeId(1), "a"));
    g.insert_node(Node::new(NodeId(2), "b"));
    g.insert_node(Node::new(NodeId(3), "c"));
    g.add_edge(NodeId(1), NodeId(2), EdgeKind::Control);
    g.add_edge(NodeId(1), NodeId(3), EdgeKind::Data);
    g.add_edge(NodeId(3), NodeId(1), EdgeKind::Branch);

    let out: Vec<_> = g.outgoing(NodeId(1)).map(|e| e.kind).collect();
    assert_eq!(out.len(), 2);
    assert!(out.contains(&EdgeKind::Control));
    assert!(out.contains(&EdgeKind::Data));

    let in_: Vec<_> = g.incoming(NodeId(1)).map(|e| e.kind).collect();
    assert_eq!(in_.len(), 1);
    assert_eq!(in_[0], EdgeKind::Branch);
}

#[test]
fn graph_outgoing_of_kind() {
    let mut g = Graph::new();
    g.insert_node(Node::new(NodeId(1), "a"));
    g.insert_node(Node::new(NodeId(2), "b"));
    g.add_edge(NodeId(1), NodeId(2), EdgeKind::Control);
    g.add_edge(NodeId(1), NodeId(2), EdgeKind::Data);

    let control = g.outgoing_of_kind(NodeId(1), EdgeKind::Control).count();
    let data = g.outgoing_of_kind(NodeId(1), EdgeKind::Data).count();
    assert_eq!(control, 1);
    assert_eq!(data, 1);
}

#[test]
fn graph_snapshot_is_sorted_and_copy_on_write() {
    let mut g = Graph::new();
    g.insert_node(Node::new(NodeId(5), "z"));
    g.insert_node(Node::new(NodeId(1), "a"));
    g.insert_node(Node::new(NodeId(3), "m"));
    g.add_edge(NodeId(5), NodeId(1), EdgeKind::Control);
    g.add_edge(NodeId(1), NodeId(3), EdgeKind::Data);

    let snap = g.snapshot();
    // Nodes sorted by id.
    let node_ids: Vec<u32> = snap.nodes().iter().map(|n| n.id.get()).collect();
    assert_eq!(node_ids, vec![1, 3, 5]);
    // Edges sorted by id.
    let edge_ids: Vec<u32> = snap.edges().iter().map(|e| e.id.get()).collect();
    assert_eq!(edge_ids, vec![0, 1]);

    // Mutating the graph after snapshotting does not affect the snapshot.
    g.remove_node(NodeId(3));
    assert_eq!(snap.len(), 3);
    assert!(snap.node(NodeId(3)).is_some());
}

// Snapshot

#[test]
fn snapshot_empty() {
    let snap = Snapshot::empty();
    assert!(snap.is_empty());
    assert_eq!(snap.len(), 0);
    assert_eq!(snap.nodes().len(), 0);
    assert_eq!(snap.edges().len(), 0);
}

#[test]
fn snapshot_capture_and_lookup() {
    let nodes = vec![
        Node::new(NodeId(2), "b"),
        Node::new(NodeId(1), "a"),
        Node::new(NodeId(3), "c"),
    ];
    let edges = vec![
        Edge::new(EdgeId(1), NodeId(2), NodeId(1), EdgeKind::Control),
        Edge::new(EdgeId(0), NodeId(1), NodeId(3), EdgeKind::Data),
    ];
    let snap = Snapshot::capture(nodes, edges);

    assert_eq!(snap.len(), 3);
    assert_eq!(snap.node(NodeId(1)).unwrap().payload, "a");
    assert_eq!(snap.node(NodeId(2)).unwrap().payload, "b");
    assert_eq!(snap.node(NodeId(999)), None);

    assert_eq!(snap.edge(EdgeId(0)).unwrap().source(), NodeId(1));
    assert_eq!(snap.edge(EdgeId(1)).unwrap().target(), NodeId(1));
    assert_eq!(snap.edge(EdgeId(999)), None);
}

#[test]
fn snapshot_eq() {
    let nodes = vec![Node::new(NodeId(1), "a")];
    let edges = vec![];
    let a = Snapshot::capture(nodes.clone(), edges.clone());
    let b = Snapshot::capture(nodes, edges);
    assert_eq!(a, b);
}

#[test]
fn snapshot_duplicate_ids_first_wins_in_index() {
    // Two nodes with the same id: lookup returns the first, iteration returns both.
    let nodes = vec![
        Node::new(NodeId(1), "first"),
        Node::new(NodeId(1), "second"),
    ];
    let snap = Snapshot::capture(nodes, vec![]);
    assert_eq!(snap.len(), 2);
    assert_eq!(snap.node(NodeId(1)).unwrap().payload, "first");
    let all: Vec<_> = snap.nodes().iter().map(|n| n.payload.as_str()).collect();
    assert_eq!(all, vec!["first", "second"]);
}
