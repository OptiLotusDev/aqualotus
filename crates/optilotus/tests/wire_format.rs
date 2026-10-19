//! Wire-format regression tests (P18: serialization is a contract).
//!
//! These pin the exact JSON the bridge emits. The bridge was refactored
//! from ad-hoc `serde_json::json!` literals to declared types in
//! `crate::wire`; these tests prove the observable output did not change,
//! so existing UI consumers keep working.

use optilotus::wire::{
    exec_error_response, ClearedResponse, CommandIdResponse, DeletedResponse, ErrorResponse,
    FunctionInfoResponse, FunctionRow, FunctionResponse, IdleResponse, ListCommandsResponse,
    ListFunctionsResponse, OkResponse, RunOkResponse, WaitingInputResponse,
};
use optilotus::{CommandId, ExecError, FunctionId, FunctionInfo, Type, Value, ValueId};

fn json_of<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("wire types must serialize")
}

#[test]
fn ok_and_idle_envelopes() {
    assert_eq!(json_of(&OkResponse::default()), r#"{"status":"ok"}"#);
    assert_eq!(json_of(&IdleResponse::default()), r#"{"status":"idle"}"#);
}

#[test]
fn command_id_and_deleted_envelopes() {
    assert_eq!(
        json_of(&CommandIdResponse::new(CommandId(7))),
        r#"{"status":"ok","id":7}"#
    );
    assert_eq!(
        json_of(&DeletedResponse::new(3)),
        r#"{"status":"ok","deleted":3}"#
    );
    assert_eq!(
        json_of(&ClearedResponse::new(2)),
        r#"{"status":"ok","cleared":2}"#
    );
}

#[test]
fn function_row_uses_camel_case_is_main() {
    let row = FunctionRow {
        id: 0,
        name: "main".to_string(),
        is_main: true,
    };
    assert_eq!(
        json_of(&row),
        r#"{"id":0,"name":"main","isMain":true}"#
    );
}

#[test]
fn list_functions_wraps_rows() {
    let response = ListFunctionsResponse::new(vec![FunctionRow {
        id: 0,
        name: "main".to_string(),
        is_main: true,
    }]);
    assert_eq!(
        json_of(&response),
        r#"{"status":"ok","functions":[{"id":0,"name":"main","isMain":true}]}"#
    );
}

#[test]
fn function_response_and_info_use_camel_case() {
    let info = FunctionInfo {
        id: FunctionId(1),
        name: "helper".to_string(),
        is_main: false,
        entry: Some(CommandId(4)),
        command_count: 9,
    };
    assert_eq!(
        json_of(&FunctionResponse::from(&info)),
        r#"{"status":"ok","id":1,"name":"helper","isMain":false}"#
    );
    assert_eq!(
        json_of(&FunctionInfoResponse::from(&info)),
        r#"{"status":"ok","id":1,"name":"helper","isMain":false,"entry":4,"commandCount":9}"#
    );
}

#[test]
fn function_info_entry_serializes_null_when_absent() {
    let info = FunctionInfo {
        id: FunctionId(1),
        name: "helper".to_string(),
        is_main: false,
        entry: None,
        command_count: 0,
    };
    // `entry` has no skip_serializing_if, so it must appear as null.
    assert_eq!(
        json_of(&FunctionInfoResponse::from(&info)),
        r#"{"status":"ok","id":1,"name":"helper","isMain":false,"entry":null,"commandCount":0}"#
    );
}

#[test]
fn run_ok_omits_step_count_unless_debug() {
    let response = RunOkResponse::new(6, 1, vec!["42".to_string()], None);
    assert_eq!(
        json_of(&response),
        r#"{"status":"ok","steps":6,"prints":1,"printed":["42"],"returned":null}"#
    );
    assert_eq!(
        json_of(&response.with_debug(true)),
        r#"{"status":"ok","steps":6,"prints":1,"printed":["42"],"returned":null,"step_count":6}"#
    );
}

#[test]
fn run_ok_carries_returned_value() {
    let response = RunOkResponse::new(2, 0, vec![], Some(Value::Int32(7)));
    assert_eq!(
        json_of(&response),
        r#"{"status":"ok","steps":2,"prints":0,"printed":[],"returned":{"Int32":7}}"#
    );
}

#[test]
fn waiting_input_omits_peek_unless_debug() {
    let response = WaitingInputResponse::new(CommandId(5), Type::Int32);
    assert_eq!(
        json_of(&response),
        r#"{"status":"waiting_input","command":5,"ty":"int32"}"#
    );
    let mut peeked = WaitingInputResponse::new(CommandId(5), Type::Int32);
    peeked.peek = Some(true);
    assert_eq!(
        json_of(&peeked),
        r#"{"status":"waiting_input","command":5,"ty":"int32","peek":true}"#
    );
}

#[test]
fn error_envelope_has_null_command_when_unattributed() {
    assert_eq!(
        json_of(&ErrorResponse::new("NoRun", "no active run")),
        r#"{"status":"error","kind":"NoRun","command":null,"message":"no active run"}"#
    );
}

#[test]
fn error_envelope_attributes_command_and_detail() {
    let err = ExecError::TypeMismatch {
        command: CommandId(7),
        detail: "expected int32".to_string(),
    };
    assert_eq!(
        json_of(&exec_error_response(&err)),
        r#"{"status":"error","kind":"TypeMismatch","command":7,"message":"type mismatch at 7: expected int32","detail":"expected int32"}"#
    );
}

#[test]
fn error_envelope_carries_value_for_missing_value() {
    let err = ExecError::MissingValue {
        command: CommandId(2),
        value: ValueId(9),
    };
    assert_eq!(
        json_of(&exec_error_response(&err)),
        r#"{"status":"error","kind":"MissingValue","command":2,"message":"missing value 9 at 2","value":9}"#
    );
}

#[test]
fn loop_limit_error_has_no_command() {
    let err = ExecError::LoopLimit { limit: 1000 };
    assert_eq!(
        json_of(&exec_error_response(&err)),
        r#"{"status":"error","kind":"LoopLimit","command":null,"message":"step limit 1000 exceeded"}"#
    );
}

#[test]
fn list_commands_wraps_summaries() {
    let response = ListCommandsResponse::new(vec![]);
    assert_eq!(json_of(&response), r#"{"status":"ok","commands":[]}"#);
}
