//! Characterization of `list_commands` ordering, pinned before the
//! data/core layering refactor (rule 17: pin a behavior before moving it).
//!
//! The contract under test is the one the UI depends on to lay out the
//! canvas: rows come back in *execution order* first, then orphaned
//! commands sorted by id, and each row's `next` is the user-level
//! successor (never a hidden group node). These assertions are written
//! against today's behaviour only — they must keep passing unchanged
//! after the layering, which is what proves the move was behaviour-free.

use optilotus::package::{CommandSummary, IfSide, Package, MAIN_ID};
use optilotus::CommandKind;

fn summary(cmds: &[CommandSummary], id: u32) -> &CommandSummary {
    cmds.iter().find(|c| c.id.0 == id).expect("summary present")
}

fn kinds(cmds: &[CommandSummary]) -> Vec<CommandKind> {
    cmds.iter().map(|c| c.kind).collect()
}

/// Reachable rows follow `entry` -> `next`, skipping each group's hidden
/// nodes, and `next` is always a user head (or `None` at the tail).
#[test]
fn list_commands_returns_reachable_rows_in_execution_order() {
    let mut pkg = Package::new();
    let d = pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    let a = pkg.assign(MAIN_ID, "n", "{n} + 1").unwrap();
    let p = pkg.print(MAIN_ID, "\"done\"").unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    let ids: Vec<u32> = cmds.iter().map(|c| c.id.0).collect();
    assert_eq!(ids, vec![d.0, a.0, p.0], "user heads in chain order");
    assert_eq!(
        kinds(&cmds),
        vec![
            CommandKind::Declare,
            CommandKind::Assign,
            CommandKind::Print
        ]
    );

    assert_eq!(cmds[0].next, Some(a));
    assert_eq!(cmds[1].next, Some(p));
    assert_eq!(cmds[2].next, None, "tail reports no successor");
}

/// An orphaned command (unreachable from `entry`) is still listed, after
/// every reachable row, ordered by id rather than insertion order.
#[test]
fn orphans_are_appended_after_reachable_rows_sorted_by_id() {
    let mut pkg = Package::new();
    let a = pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    let b = pkg.print(MAIN_ID, "\"b\"").unwrap();
    let c = pkg.print(MAIN_ID, "\"c\"").unwrap();

    // b was appended after c, so insertion order would be a, c, b.
    pkg.set_next(MAIN_ID, a, Some(c)).unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    let ids: Vec<u32> = cmds.iter().map(|c| c.id.0).collect();
    assert_eq!(
        ids,
        vec![a.0, c.0, b.0],
        "reachable (a, c) first, then the orphan b"
    );
    assert_eq!(cmds[0].next, Some(c), "rewired edge is reflected");
    assert_eq!(cmds[1].next, None);
    // An orphan keeps the successor its group tail points at. `b`'s chain
    // continues into `c`, so it stays visible even though `b` is orphaned.
    assert_eq!(cmds[2].next, Some(c), "orphan keeps its own successor edge");
}

/// `set_entry(None)` orphans every command; all of them remain listed so
/// the editor can restore them. Orphan order is by id, ascending.
#[test]
fn clearing_entry_keeps_all_rows_as_orphans() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();
    pkg.print(MAIN_ID, "\"tail\"").unwrap();

    pkg.set_entry(MAIN_ID, None).unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(cmds.len(), 3, "orphans stay visible");
    let ids: Vec<u32> = cmds.iter().map(|c| c.id.0).collect();
    assert!(
        ids.windows(2).all(|w| w[0] < w[1]),
        "orphans sorted by id ascending, got {ids:?}"
    );
    // Clearing the entry does not cut the rows' own edges: each still
    // points at whatever its group tail points at.
    for row in &cmds {
        if let Some(next) = row.next {
            assert!(
                ids.contains(&next.0),
                "orphan successor {:?} must still be a listed head",
                next
            );
        }
    }
}

/// Deleting a reachable middle node repairs the chain and drops the row.
#[test]
fn deleting_a_row_removes_it_and_repairs_the_chain() {
    let mut pkg = Package::new();
    let a = pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    let b = pkg.print(MAIN_ID, "\"b\"").unwrap();
    let c = pkg.print(MAIN_ID, "\"c\"").unwrap();

    pkg.delete_command(MAIN_ID, b).unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(
        cmds.iter().map(|c| c.id.0).collect::<Vec<_>>(),
        vec![a.0, c.0]
    );
    assert_eq!(
        cmds[0].next,
        Some(c),
        "successor is adopted by the predecessor"
    );
    assert_eq!(cmds[1].next, None);
}

/// A row's `next` is the user head even when the group has hidden nodes,
/// so the UI never has to know a group exists.
#[test]
fn next_never_exposes_a_hidden_group_node() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    let p = pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(cmds[0].next, Some(p));
    // Every reported `next` is itself a listed row id.
    let listed: Vec<u32> = cmds.iter().map(|c| c.id.0).collect();
    for row in &cmds {
        if let Some(next) = row.next {
            assert!(
                listed.contains(&next.0),
                "next {:?} must be a listed user head",
                next
            );
        }
    }
}

/// `get_function` reports the user-visible command count, which is the
/// number of rows `list_commands` returns — not the raw node count.
#[test]
fn command_count_matches_the_row_count() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    pkg.print(MAIN_ID, "\"{n}\"").unwrap();

    let info = pkg.get_function(MAIN_ID).unwrap();
    let rows = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(info.command_count, rows.len());
    assert_eq!(info.command_count, 2, "two user rows, more raw nodes");
}

/// `declare` rows carry their declared type; `assign` rows carry the type
/// resolved from the declaration.
#[test]
fn rows_carry_their_resolved_type() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "n", "int32", Some("1")).unwrap();
    pkg.assign(MAIN_ID, "n", "{n} + 1").unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    assert_eq!(cmds[0].ty.map(|t| t.tag()), Some("int32"));
    assert_eq!(
        cmds[1].ty.map(|t| t.tag()),
        Some("int32"),
        "assign adopts the declared type"
    );
}

/// `if` rows expose their branch bodies as id lists. A branch list carries
/// *every raw id* of each member group (head plus hidden nodes), because
/// the executor's body walk checks membership. An absent branch stays
/// absent rather than becoming an empty list.
#[test]
fn if_rows_expose_branch_bodies_with_every_group_node() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    let cond = pkg.eval_cond(MAIN_ID, "{x} > 3").unwrap();
    let then_print = pkg.print(MAIN_ID, "\"then\"").unwrap();
    let if_id = pkg.if_(MAIN_ID, cond, vec![], None).unwrap();
    pkg.if_append(MAIN_ID, if_id, IfSide::Then, then_print)
        .unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    let if_row = cmds
        .iter()
        .find(|c| c.kind == CommandKind::If)
        .expect("if row present");
    let body = if_row.then_body.as_ref().expect("then branch present");
    // `print` expands to two raw nodes (Lit head + Print tail), and both
    // are members of the branch.
    assert_eq!(body.len(), 2, "branch lists every raw node of the group");
    assert!(body.contains(&then_print), "user head is a member");
    assert!(if_row.condition.is_some(), "condition value id is exposed");
    assert_eq!(if_row.else_body, None, "absent branch stays absent");
}

/// `if_append` onto an `else` side creates the branch when it was absent.
#[test]
fn if_append_creates_an_absent_branch() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    let cond = pkg.eval_cond(MAIN_ID, "{x} > 3").unwrap();
    let else_print = pkg.print(MAIN_ID, "\"else\"").unwrap();
    let if_id = pkg.if_(MAIN_ID, cond, vec![], None).unwrap();
    pkg.if_append(MAIN_ID, if_id, IfSide::Else, else_print)
        .unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    let if_row = summary(&cmds, if_id.0);
    assert!(
        if_row.else_body.is_some(),
        "else branch created by the append"
    );
    assert_eq!(if_row.then_body, None, "still no then branch");
}
