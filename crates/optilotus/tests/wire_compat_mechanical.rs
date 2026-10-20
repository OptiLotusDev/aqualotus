//! Mechanical backwards-compatibility check for the error envelope.
//!
//! Unlike `wire_compat.rs` (which pins hand-written expectations), this
//! test builds one `ExecError` per variant and asserts that every key the
//! *pre-refactor* bridge emitted is still present. The expected key sets
//! were extracted mechanically from
//! `git show <pre-refactor>:crates/optilotus/src/bridge.rs`.
//!
//! `extra_keys` records keys the new envelope adds beyond the old one;
//! they are additive and therefore allowed (P18: the format may grow).

use optilotus::wire::exec_error_response;
use optilotus::{CommandId, ExecError, ValueId};

/// (variant, keys the OLD bridge emitted)
fn old_key_sets() -> Vec<(&'static str, ExecError, Vec<&'static str>)> {
    vec![
        (
            "TypeMismatch",
            ExecError::TypeMismatch {
                command: CommandId(1),
                detail: "d".into(),
            },
            vec!["command", "detail", "kind", "message", "status"],
        ),
        (
            "Overflow",
            ExecError::Overflow {
                command: CommandId(1),
            },
            vec!["command", "kind", "message", "status"],
        ),
        (
            "DivByZero",
            ExecError::DivByZero {
                command: CommandId(1),
            },
            vec!["command", "kind", "message", "status"],
        ),
        (
            "MissingValue",
            ExecError::MissingValue {
                command: CommandId(1),
                value: ValueId(2),
            },
            vec!["command", "kind", "message", "status", "value"],
        ),
        (
            "Arity",
            ExecError::Arity {
                command: CommandId(1),
                expected: "int32".into(),
                found: 2,
            },
            vec!["command", "expected", "found", "kind", "message", "status"],
        ),
        (
            "UnknownCommand",
            ExecError::UnknownCommand {
                command: CommandId(1),
            },
            vec!["command", "kind", "message", "status"],
        ),
        (
            "LoopLimit",
            ExecError::LoopLimit { limit: 10 },
            vec!["command", "kind", "limit", "message", "status"],
        ),
        (
            "UnknownVariable",
            ExecError::UnknownVariable {
                command: CommandId(1),
                var: "x".into(),
            },
            vec!["command", "kind", "message", "status", "var"],
        ),
        (
            "ExprError",
            ExecError::ExprError {
                command: CommandId(1),
                detail: "d".into(),
            },
            vec!["command", "detail", "kind", "message", "status"],
        ),
        (
            "UnknownFunction",
            ExecError::UnknownFunction {
                command: CommandId(1),
                name: "f".into(),
            },
            vec!["command", "function", "kind", "message", "status"],
        ),
        (
            "MissingReturn",
            ExecError::MissingReturn {
                command: CommandId(1),
                function: "f".into(),
            },
            vec!["command", "function", "kind", "message", "status"],
        ),
        (
            "InputEof",
            ExecError::InputEof {
                command: CommandId(1),
            },
            vec!["command", "kind", "message", "status"],
        ),
        (
            "InputParse",
            ExecError::InputParse {
                command: CommandId(1),
                detail: "d".into(),
            },
            vec!["command", "detail", "kind", "message", "status"],
        ),
        (
            "Paused",
            ExecError::Paused,
            vec!["command", "kind", "message", "status"],
        ),
        (
            "InvalidState",
            ExecError::InvalidState,
            vec!["command", "kind", "message", "status"],
        ),
    ]
}

#[test]
fn every_old_error_key_is_still_emitted() {
    for (name, err, old_keys) in old_key_sets() {
        let value = serde_json::to_value(exec_error_response(&err)).expect("serialize");
        let object = value.as_object().expect("object");
        for key in &old_keys {
            assert!(
                object.contains_key(*key),
                "{name}: lost key {key:?} (has: {:?})",
                object.keys().collect::<Vec<_>>()
            );
        }
    }
}

#[test]
fn new_envelope_adds_only_optional_fields() {
    // Every key the new envelope can emit must be one the old one also
    // emitted, or one of the documented additive fields.
    let additive = [
        "detail", "value", "expected", "found", "limit", "var", "function",
    ];
    let core = ["status", "kind", "command", "message"];

    for (name, err, _) in old_key_sets() {
        let value = serde_json::to_value(exec_error_response(&err)).expect("serialize");
        for key in value.as_object().expect("object").keys() {
            assert!(
                core.contains(&key.as_str()) || additive.contains(&key.as_str()),
                "{name}: unexpected new key {key:?}"
            );
        }
    }
}
