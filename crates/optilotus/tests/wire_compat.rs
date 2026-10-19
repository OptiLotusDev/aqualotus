//! Backwards-compatibility tests for the error envelope (P18).
//!
//! The bridge's error JSON was refactored from ad-hoc `serde_json::json!`
//! literals to `crate::wire::ErrorResponse`. These tests pin the *exact*
//! field set the pre-refactor bridge emitted, so the envelope stays a
//! strict superset and no consumer loses a field.
//!
//! The expected strings below were taken from the old implementation
//! (`git show <pre-refactor>:crates/optilotus/src/bridge.rs`), not from
//! the new code, so they genuinely test backwards compatibility.

use optilotus::wire::exec_error_response;
use optilotus::{CommandId, ExecError, ValueId};

fn json_of(err: &ExecError) -> serde_json::Value {
    serde_json::to_value(exec_error_response(err)).expect("must serialize")
}

/// Assert every key in `expected` is present with the same value. Extra
/// keys are allowed (the envelope may grow), missing or changed keys are
/// a backwards-compatibility break.
fn assert_superset(actual: &serde_json::Value, expected: &serde_json::Value) {
    let actual_obj = actual.as_object().expect("object");
    for (key, want) in expected.as_object().expect("object") {
        let got = actual_obj
            .get(key)
            .unwrap_or_else(|| panic!("missing key {key:?} in {actual}"));
        assert_eq!(got, want, "key {key:?} changed");
    }
}

#[test]
fn arity_keeps_expected_and_found() {
    // Old: {"status":"error","kind":"Arity","command":7,"message":...,
    //       "expected":"int32","found":2}
    let err = ExecError::Arity {
        command: CommandId(7),
        expected: "int32".to_string(),
        found: 2,
    };
    let expected = serde_json::json!({
        "status": "error",
        "kind": "Arity",
        "command": 7,
        "expected": "int32",
        "found": 2,
    });
    assert_superset(&json_of(&err), &expected);
}

#[test]
fn loop_limit_keeps_limit() {
    // Old: {"status":"error","kind":"LoopLimit","command":null,
    //       "message":...,"limit":1000}
    let err = ExecError::LoopLimit { limit: 1000 };
    let expected = serde_json::json!({
        "status": "error",
        "kind": "LoopLimit",
        "command": null,
        "limit": 1000,
    });
    assert_superset(&json_of(&err), &expected);
}

#[test]
fn unknown_variable_keeps_var() {
    // Old: {"status":"error","kind":"UnknownVariable","command":3,
    //       "message":...,"var":"x"}
    let err = ExecError::UnknownVariable {
        command: CommandId(3),
        var: "x".to_string(),
    };
    let expected = serde_json::json!({
        "status": "error",
        "kind": "UnknownVariable",
        "command": 3,
        "var": "x",
    });
    assert_superset(&json_of(&err), &expected);
}

#[test]
fn unknown_function_keeps_function() {
    // Old: {"status":"error","kind":"UnknownFunction","command":5,
    //       "message":...,"function":"helper"}
    let err = ExecError::UnknownFunction {
        command: CommandId(5),
        name: "helper".to_string(),
    };
    let expected = serde_json::json!({
        "status": "error",
        "kind": "UnknownFunction",
        "command": 5,
        "function": "helper",
    });
    assert_superset(&json_of(&err), &expected);
}

#[test]
fn missing_return_keeps_function() {
    // Old: {"status":"error","kind":"MissingReturn","command":9,
    //       "message":...,"function":"helper"}
    let err = ExecError::MissingReturn {
        command: CommandId(9),
        function: "helper".to_string(),
    };
    let expected = serde_json::json!({
        "status": "error",
        "kind": "MissingReturn",
        "command": 9,
        "function": "helper",
    });
    assert_superset(&json_of(&err), &expected);
}

#[test]
fn type_mismatch_keeps_detail() {
    let err = ExecError::TypeMismatch {
        command: CommandId(7),
        detail: "expected int32".to_string(),
    };
    let expected = serde_json::json!({
        "status": "error",
        "kind": "TypeMismatch",
        "command": 7,
        "detail": "expected int32",
    });
    assert_superset(&json_of(&err), &expected);
}

#[test]
fn missing_value_keeps_value() {
    let err = ExecError::MissingValue {
        command: CommandId(2),
        value: ValueId(9),
    };
    let expected = serde_json::json!({
        "status": "error",
        "kind": "MissingValue",
        "command": 2,
        "value": 9,
    });
    assert_superset(&json_of(&err), &expected);
}

#[test]
fn input_parse_keeps_detail() {
    let err = ExecError::InputParse {
        command: CommandId(4),
        detail: "invalid JSON input".to_string(),
    };
    let expected = serde_json::json!({
        "status": "error",
        "kind": "InputParse",
        "command": 4,
        "detail": "invalid JSON input",
    });
    assert_superset(&json_of(&err), &expected);
}

#[test]
fn expr_error_keeps_detail() {
    let err = ExecError::ExprError {
        command: CommandId(1),
        detail: "bad syntax".to_string(),
    };
    let expected = serde_json::json!({
        "status": "error",
        "kind": "ExprError",
        "command": 1,
        "detail": "bad syntax",
    });
    assert_superset(&json_of(&err), &expected);
}

#[test]
fn simple_errors_keep_core_fields() {
    // Overflow / DivByZero / UnknownCommand / InputEof: no extra fields.
    for (err, kind, command) in [
        (
            ExecError::Overflow {
                command: CommandId(2),
            },
            "Overflow",
            2,
        ),
        (
            ExecError::DivByZero {
                command: CommandId(3),
            },
            "DivByZero",
            3,
        ),
        (
            ExecError::UnknownCommand {
                command: CommandId(4),
            },
            "UnknownCommand",
            4,
        ),
        (
            ExecError::InputEof {
                command: CommandId(5),
            },
            "InputEof",
            5,
        ),
    ] {
        let expected = serde_json::json!({
            "status": "error",
            "kind": kind,
            "command": command,
        });
        assert_superset(&json_of(&err), &expected);
    }
}

#[test]
fn unattributed_errors_keep_null_command() {
    for (err, kind) in [
        (ExecError::Paused, "Paused"),
        (ExecError::InvalidState, "InvalidState"),
    ] {
        let expected = serde_json::json!({
            "status": "error",
            "kind": kind,
            "command": null,
        });
        assert_superset(&json_of(&err), &expected);
    }
}

#[test]
fn legacy_fields_are_absent_when_not_applicable() {
    // The new fields must not appear on unrelated errors, so the envelope
    // stays as tight as the old one for those kinds.
    let err = ExecError::DivByZero {
        command: CommandId(1),
    };
    let actual = json_of(&err);
    for key in ["expected", "found", "limit", "var", "function"] {
        assert!(
            actual.get(key).is_none(),
            "unexpected {key:?} on DivByZero: {actual}"
        );
    }
}
