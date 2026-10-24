use optilotus_data::{EdgeKind, Graph, Node};

fn node(id: u32, payload: &str) -> Node {
    Node::new(id.into(), payload)
}

#[test]
fn empty_graph_has_no_nodes_or_edges() {
    let graph = Graph::new();
    assert!(graph.is_empty());
    assert_eq!(graph.len(), 0);
}

#[test]
fn insert_and_lookup_a_node() {
    let mut graph = Graph::new();
    graph.insert_node(node(1, "lit"));

    let found = graph.node(1.into()).expect("node present");
    assert_eq!(found.payload, "lit");
    assert!(graph.node(2.into()).is_none());
}

#[test]
fn inserting_replaces_a_node_at_the_same_id() {
    let mut graph = Graph::new();
    graph.insert_node(node(1, "first"));
    graph.insert_node(node(1, "second"));

    assert_eq!(graph.len(), 1);
    assert_eq!(graph.node(1.into()).unwrap().payload, "second");
}

#[test]
fn remove_node_also_removes_touching_edges() {
    let mut graph = Graph::new();
    graph.insert_node(node(1, "a"));
    graph.insert_node(node(2, "b"));
    let edge = graph.add_edge(1.into(), 2.into(), EdgeKind::Control);

    assert!(graph.remove_node(2.into()));
    assert!(graph.node(2.into()).is_none());
    assert!(
        graph.edge(edge).is_none(),
        "edge to the removed node is gone"
    );
    assert!(!graph.remove_node(2.into()), "second removal is a no-op");
}

#[test]
fn add_edge_allocates_increasing_ids() {
    let mut graph = Graph::new();
    let first = graph.add_edge(1.into(), 2.into(), EdgeKind::Control);
    let second = graph.add_edge(2.into(), 3.into(), EdgeKind::Data);

    assert!(second.0 > first.0, "ids increase");
    assert_eq!(graph.edge(first).unwrap().kind, EdgeKind::Control);
    assert_eq!(graph.edge(second).unwrap().kind, EdgeKind::Data);
}

#[test]
fn incoming_and_outgoing_are_distinct() {
    let mut graph = Graph::new();
    graph.add_edge(1.into(), 2.into(), EdgeKind::Control);
    graph.add_edge(2.into(), 3.into(), EdgeKind::Control);

    let from_two = graph.outgoing(2.into()).count();
    let into_two = graph.incoming(2.into()).count();
    assert_eq!(from_two, 1);
    assert_eq!(into_two, 1);
}

#[test]
fn outgoing_of_kind_filters_by_kind() {
    let mut graph = Graph::new();
    graph.add_edge(1.into(), 2.into(), EdgeKind::Control);
    graph.add_edge(1.into(), 3.into(), EdgeKind::Data);

    assert_eq!(
        graph.outgoing_of_kind(1.into(), EdgeKind::Control).count(),
        1
    );
    assert_eq!(graph.outgoing_of_kind(1.into(), EdgeKind::Data).count(), 1);
    assert_eq!(
        graph.outgoing_of_kind(1.into(), EdgeKind::Branch).count(),
        0
    );
}

#[test]
fn remove_edge_leaves_the_nodes() {
    let mut graph = Graph::new();
    let edge = graph.add_edge(1.into(), 2.into(), EdgeKind::Control);

    assert!(graph.remove_edge(edge));
    assert_eq!(graph.edges().count(), 0);
    assert_eq!(graph.len(), 0, "nodes were never added");
}

#[test]
fn snapshot_is_an_independent_copy() {
    let mut graph = Graph::new();
    graph.insert_node(node(1, "a"));
    graph.add_edge(1.into(), 1.into(), EdgeKind::Control);

    let snapshot = graph.snapshot();
    graph.insert_node(node(2, "b"));

    assert_eq!(snapshot.len(), 1, "snapshot does not see later edits");
    assert_eq!(graph.len(), 2);
    assert_eq!(snapshot.node(1.into()).unwrap().payload, "a");
}

#[test]
fn snapshots_of_the_same_graph_are_equal() {
    let mut graph = Graph::new();
    graph.insert_node(node(1, "a"));
    graph.insert_node(node(2, "b"));
    graph.add_edge(1.into(), 2.into(), EdgeKind::Data);

    assert_eq!(graph.snapshot(), graph.snapshot());
}

#[test]
fn snapshot_indexes_by_id() {
    let mut graph = Graph::new();
    graph.insert_node(node(5, "a"));
    graph.add_edge(5.into(), 6.into(), EdgeKind::Control);

    let snapshot = graph.snapshot();
    assert_eq!(snapshot.node(5.into()).unwrap().payload, "a");
    assert_eq!(snapshot.edge(0.into()).unwrap().kind, EdgeKind::Control);
    assert_eq!(snapshot.nodes().len(), 1);
}
