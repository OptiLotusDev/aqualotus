use optilotus::{
    add, empty_program_json, health_check, run_empty_program_json, run_function_json,
    session_clear, session_exec_math, session_get, session_print, session_set, version, Command,
    CommandId, Function, FunctionId, Op, Type, Value, ValueId, PROGRAM_FORMAT_VERSION,
};

#[test]
fn it_works() {
    let result = add(2, 2);
    assert_eq!(result, 4);
}

#[test]
fn version_is_set() {
    assert_eq!(version(), "0.1.0");
}

#[test]
fn health_is_ok() {
    assert_eq!(health_check(), "ok");
}

#[test]
fn empty_program_round_trips() {
    let json = empty_program_json();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["version"], PROGRAM_FORMAT_VERSION);
    assert_eq!(v["package"], "main");
    assert!(v["functions"].as_array().unwrap().is_empty());
}

#[test]
fn run_empty_reports_ok() {
    let json = run_empty_program_json();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["status"], "ok");
}

fn greeting_function() -> Function {
    // name = "Bob"; print "Hello {name}" + " AAA".
    Function {
        id: FunctionId(1),
        name: "main".to_string(),
        entry: Some(CommandId(1)),
        commands: vec![
            Command {
                id: CommandId(1),
                op: Op::Lit(Value::String("Bob".to_string())),
                inputs: vec![],
                outputs: vec![ValueId(1)],
                next: Some(CommandId(2)),
            },
            Command {
                id: CommandId(2),
                op: Op::Set {
                    var: "name".to_string(),
                    ty: Type::String,
                },
                inputs: vec![ValueId(1)],
                outputs: vec![],
                next: Some(CommandId(3)),
            },
            Command {
                id: CommandId(3),
                op: Op::Lit(Value::String("\"Hello {name}\" + \" AAA\"".to_string())),
                inputs: vec![],
                outputs: vec![ValueId(2)],
                next: Some(CommandId(4)),
            },
            Command {
                id: CommandId(4),
                op: Op::Print,
                inputs: vec![ValueId(2)],
                outputs: vec![],
                next: None,
            },
        ],
    }
}

#[test]
fn run_function_json_reports_prints() {
    let input = serde_json::to_string(&greeting_function()).unwrap();
    let out: serde_json::Value = serde_json::from_str(&run_function_json(&input)).unwrap();
    assert_eq!(out["status"], "ok");
    assert_eq!(out["steps"], 4);
    assert_eq!(out["prints"], 1);
    assert_eq!(out["printed"], serde_json::json!(["Hello Bob AAA"]));
}

#[test]
fn run_function_json_reports_errors_with_command() {
    // Get an unknown variable at command 1.
    let fun = Function {
        id: FunctionId(1),
        name: "main".to_string(),
        entry: Some(CommandId(1)),
        commands: vec![Command {
            id: CommandId(1),
            op: Op::Get {
                var: "ghost".to_string(),
            },
            inputs: vec![],
            outputs: vec![ValueId(1)],
            next: None,
        }],
    };
    let input = serde_json::to_string(&fun).unwrap();
    let out: serde_json::Value = serde_json::from_str(&run_function_json(&input)).unwrap();
    assert_eq!(out["status"], "error");
    assert_eq!(out["kind"], "UnknownVariable");
    assert_eq!(out["command"], 1);
    assert_eq!(out["var"], "ghost");
    assert!(out["message"].as_str().is_some());
}

#[test]
fn run_function_json_rejects_bad_json() {
    let out: serde_json::Value = serde_json::from_str(&run_function_json("{not json")).unwrap();
    assert_eq!(out["status"], "error");
    assert_eq!(out["kind"], "ParseError");
    assert!(out["command"].is_null());
}

fn report(json: &str) -> serde_json::Value {
    serde_json::from_str(json).unwrap()
}

#[test]
fn session_set_then_get() {
    session_clear();
    let out = report(&session_set("n", "int32", "41"));
    assert_eq!(out["status"], "ok");
    assert_eq!(out["var"], "n");
    assert_eq!(out["type"], "int32");

    let out = report(&session_get("n"));
    assert_eq!(out["status"], "ok");
    assert_eq!(out["value"], serde_json::json!({"Int32": 41}));
    assert_eq!(out["type"], "int32");
    assert_eq!(out["display"], "41");
}

#[test]
fn session_set_rejects_bad_type_and_text() {
    session_clear();
    let out = report(&session_set("n", "int32", "abc"));
    assert_eq!(out["status"], "error");

    let out = report(&session_set("n", "nope", "1"));
    assert_eq!(out["status"], "error");
    assert!(out["message"].as_str().unwrap().contains("unknown type"));

    session_clear();
    let out = report(&session_get("ghost"));
    assert_eq!(out["status"], "error");
    assert_eq!(out["kind"], "UnknownVariable");
    assert_eq!(out["var"], "ghost");
    assert!(out["command"].is_null());
}

#[test]
fn session_exec_math_uses_session_variables() {
    session_clear();
    session_set("n", "int32", "3");
    let out = report(&session_exec_math("({n} + 4) % 2"));
    assert_eq!(out["status"], "ok");
    assert_eq!(out["value"], serde_json::json!({"Int32": 1}));
    assert_eq!(out["display"], "1");

    let out = report(&session_exec_math("(3 +"));
    assert_eq!(out["status"], "error");
    assert_eq!(out["kind"], "ExprError");
}

#[test]
fn session_print_interpolates() {
    session_clear();
    session_set("name", "string", "Bob");
    let out = report(&session_print("\"Hello {name}\" + \" AAA\""));
    assert_eq!(out["status"], "ok");
    assert_eq!(out["printed"], "Hello Bob AAA");
}

#[test]
fn session_clear_resets() {
    session_clear();
    session_set("a", "int32", "1");
    let out = report(&session_clear());
    assert_eq!(out["status"], "ok");
    assert_eq!(out["cleared"], 1);

    let out = report(&session_get("a"));
    assert_eq!(out["kind"], "UnknownVariable");
}
