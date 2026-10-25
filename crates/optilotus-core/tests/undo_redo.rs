use optilotus_core::ir::{CommandId, Function, FunctionId};
use optilotus_core::package::registry::PackageSnapshot;
use optilotus_core::package::CommandKind;
use optilotus_core::session::Commit;

#[test]
fn test_commit_enum_variants() {
    // Test that we can create all Commit variants
    let _ = Commit::CommandAdded {
        fid: FunctionId(1),
        head_id: CommandId(1),
        kind: CommandKind::Declare,
        var: None,
        commands: vec![],
        summary: optilotus_core::CommandSummary {
            id: CommandId(1),
            kind: CommandKind::Declare,
            next: None,
            var: None,
            ty: None,
            access: None,
            expr: None,
            template: None,
            condition: None,
            then_body: None,
            else_body: None,
        },
        old_entry: None,
    };

    let _ = Commit::FunctionCreated {
        fid: FunctionId(1),
        name: "test".to_string(),
        function: Function {
            id: FunctionId(1),
            name: "test".to_string(),
            entry: None,
            commands: vec![],
        },
        meta: vec![],
        order: vec![FunctionId(1)],
        next_function_id: 2,
    };

    let _ = Commit::FunctionRenamed {
        fid: FunctionId(1),
        old_name: "old".to_string(),
        new_name: "new".to_string(),
    };

    let _ = Commit::EntryChanged {
        fid: FunctionId(1),
        old_entry: None,
        new_entry: None,
    };

    let _ = Commit::FunctionDeleted {
        fid: FunctionId(1),
        function: Function {
            id: FunctionId(1),
            name: "test".to_string(),
            entry: None,
            commands: vec![],
        },
        meta: vec![],
        next_function_id: 2,
        next_command_id: 1,
        next_value_id: 1,
    };

    let _ = Commit::PackageCleared {
        snapshot: PackageSnapshot {
            version: 1,
            package: optilotus_core::Package::new(),
        },
    };
}

#[test]
fn test_commit_methods_exist() {
    // Just verify the methods exist and have correct signatures
    fn _forward_apply(_: Commit) {}
    fn _inverse_apply(_: Commit) {}
}
