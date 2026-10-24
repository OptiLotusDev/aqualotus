//! Branch wiring end-to-end: `if_append`, `if_condition`, and
//! `if_set_condition` against the package executor. These cover the UI
//! flows (port drop wiring, inspector condition edit) that previously
//! crashed with dangling values or stale branch lists.
use optilotus_core::ir::CommandId;
use optilotus_core::package::{CommandSummary, IfSide, Package, MAIN_ID};
use optilotus_core::VecSink;

fn summary(cmds: &[CommandSummary], id: CommandId) -> &CommandSummary {
    cmds.iter().find(|c| c.id == id).expect("summary present")
}

/// Appending several prints into then, one into else: the summaries keep
/// the user branch lists in order (plus the pair tails the executor
/// needs for its membership walk).
#[test]
fn then_then_else_append_updates_summaries() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("0")).unwrap();
    let cond = pkg.eval_cond(MAIN_ID, "{x} > 3").unwrap();
    let if_id = pkg.if_(MAIN_ID, cond, vec![], None).unwrap();
    let p1 = pkg.print(MAIN_ID, "\"then one\"").unwrap();
    let p2 = pkg.print(MAIN_ID, "\"then two\"").unwrap();
    let p3 = pkg.print(MAIN_ID, "\"other\"").unwrap();

    pkg.if_append(MAIN_ID, if_id, IfSide::Then, p1).unwrap();
    pkg.if_append(MAIN_ID, if_id, IfSide::Then, p2).unwrap();
    pkg.if_append(MAIN_ID, if_id, IfSide::Else, p3).unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    let if_sum = summary(&cmds, if_id);
    let then_body = if_sum.then_body.clone().unwrap_or_default();
    let else_body = if_sum.else_body.clone().unwrap_or_default();
    assert!(then_body.contains(&p1) && then_body.contains(&p2));
    assert_eq!(then_body.first(), Some(&p1), "then head first");
    assert!(else_body.contains(&p3));
    assert_eq!(else_body.first(), Some(&p3), "else head first");
}

/// UI flow: if with expr -> inspect condition -> edit condition in place
/// via `if_set_condition` -> run -> the opposite branch prints, and both
/// runs execute their hidden compute (never a dangling value).
#[test]
fn set_condition_false_then_run_prints_else() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    let if_id = pkg.if_with_expr(MAIN_ID, "{x} > 3", &[], None).unwrap();
    let then_print = pkg.print(MAIN_ID, "\"then hit\"").unwrap();
    let else_print = pkg.print(MAIN_ID, "\"else hit\"").unwrap();
    pkg.if_append(MAIN_ID, if_id, IfSide::Then, then_print)
        .unwrap();
    pkg.if_append(MAIN_ID, if_id, IfSide::Else, else_print)
        .unwrap();

    let cond = pkg.if_condition(MAIN_ID, if_id).unwrap();
    assert_eq!(cond, "{x} > 3", "condition text round-trips");

    // true branch
    let mut sink = VecSink::default();
    pkg.run_main(&mut sink)
        .unwrap_or_else(|e| panic!("run failed before condition edit: {e:?}"));
    assert_eq!(sink.lines, vec!["then hit".to_string()]);

    // edit the condition in place, like the inspector Apply does
    pkg.if_set_condition(MAIN_ID, if_id, "false").unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert_eq!(sink.lines, vec!["else hit".to_string()]);

    let it = pkg.if_condition(MAIN_ID, if_id).unwrap();
    assert_eq!(it, "false");
}

/// Rewiring prints across branches (the "rewrite" gesture) must keep
/// every `list_commands` id resolvable and every wired branch runnable.
#[test]
fn summary_ids_stay_resolvable_when_wiring() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("1")).unwrap();
    let if_id = pkg.if_with_expr(MAIN_ID, "false", &[], None).unwrap();
    let a = pkg.print(MAIN_ID, "\"A\"").unwrap();
    let b = pkg.print(MAIN_ID, "\"B\"").unwrap();

    pkg.if_append(MAIN_ID, if_id, IfSide::Then, a).unwrap();
    // Same-if cross-branch move is allowed by design (it lifts the
    // command out of the opposite branch list first).
    pkg.if_append(MAIN_ID, if_id, IfSide::Else, a).unwrap();
    // Re-append to the SAME branch is rejected (the UI's rewrite error).
    pkg.if_append(MAIN_ID, if_id, IfSide::Else, a).unwrap_err();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    let _ = summary(&cmds, a);
    pkg.if_append(MAIN_ID, if_id, IfSide::Else, b).unwrap();

    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    // Condition false -> the else body runs [A, B]; then flow continues
    // after the if (nothing left to execute).
    assert_eq!(sink.lines, vec!["A", "B"]);
}

/// A deleted branch member must disappear from the branch lists: the
/// executor's membership walk would never crash on a stale id.
#[test]
fn delete_branch_member_clears_membership() {
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
    let if_id = pkg.if_with_expr(MAIN_ID, "{x} > 3", &[], None).unwrap();
    let hit = pkg.print(MAIN_ID, "\"hit\"").unwrap();
    pkg.if_append(MAIN_ID, if_id, IfSide::Then, hit).unwrap();

    pkg.delete_command(MAIN_ID, hit).unwrap();

    let cmds = pkg.list_commands(MAIN_ID).unwrap();
    let if_sum = summary(&cmds, if_id);
    // The then branch emptied; the refresh collapses it to None.
    assert!(if_sum.then_body.is_none());
    let mut sink = VecSink::default();
    pkg.run_main(&mut sink).unwrap();
    assert!(sink.lines.is_empty());
}
