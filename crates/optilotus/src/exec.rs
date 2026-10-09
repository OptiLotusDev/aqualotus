use std::collections::{HashMap, HashSet};

use crate::error::ExecError;
use crate::expr::{check_var_name, eval_expr, eval_expr_with, render_template, ExprFail};
use crate::ir::{CommandId, Function, Program, ValueId};
use crate::ops::{print_text, Op};
use crate::sink::PrintSink;
use crate::types::Type;
use crate::value::Value;

/// Default step cap: cycles are allowed but bounded.
pub const MAX_STEPS: usize = 10_000;

/// Maximum nested `name()` call depth. Recursion is allowed but bounded;
/// deeper calls fail with `LoopLimit` (shared with the step cap).
pub const MAX_CALL_DEPTH: usize = 64;

/// Summary of a successful run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecReport {
    pub steps: usize,
    pub prints: usize,
}

/// Run a function from its `entry` following `next` edges.
pub fn run_function(
    function: &Function,
    sink: &mut impl PrintSink,
) -> Result<ExecReport, ExecError> {
    run_function_with_limit(function, sink, MAX_STEPS)
}

/// Same as [`run_function`] with an explicit step cap (tests use this
/// to trigger `LoopLimit` quickly).
pub fn run_function_with_limit(
    function: &Function,
    sink: &mut impl PrintSink,
    max_steps: usize,
) -> Result<ExecReport, ExecError> {
    run_function_returning_with_limit(function, sink, max_steps).map(|(report, _)| report)
}

/// Run and also capture an optional `Return` value. `Return` evaluates its
/// expression, stores the value and stops the function; without a `Return`
/// the second element is `None`. Existing callers (`run_function`) ignore
/// it, so this stays backward compatible.
pub fn run_function_returning(
    function: &Function,
    sink: &mut impl PrintSink,
) -> Result<(ExecReport, Option<Value>), ExecError> {
    run_function_returning_with_limit(function, sink, MAX_STEPS)
}

/// Same as [`run_function_returning`] with an explicit step cap.
pub fn run_function_returning_with_limit(
    function: &Function,
    sink: &mut impl PrintSink,
    max_steps: usize,
) -> Result<(ExecReport, Option<Value>), ExecError> {
    let mut values: HashMap<ValueId, Value> = HashMap::new();
    // Function scope: fresh variables per run, never shared between
    // functions or runs.
    let mut vars: HashMap<String, Value> = HashMap::new();
    let mut current = function.entry;
    let mut steps: usize = 0;
    let mut prints: usize = 0;
    let mut returned: Option<Value> = None;

    while let Some(id) = current {
        if steps >= max_steps {
            return Err(ExecError::LoopLimit { limit: max_steps });
        }
        let command = function
            .find_command(id)
            .ok_or(ExecError::UnknownCommand { command: id })?;
        let flow = run_command(
            function,
            command,
            &mut values,
            &mut vars,
            sink,
            &mut prints,
            &mut steps,
            max_steps,
        )?;
        current = command.next;
        steps += 1;
        if let Some(value) = flow {
            returned = Some(value);
            break;
        }
    }

    Ok((ExecReport { steps, prints }, returned))
}

/// `None` = continue to `next`; `Some(value)` = `Return` requested a stop.
type Flow = Option<Value>;

#[allow(clippy::too_many_arguments)]
fn run_command(
    function: &Function,
    command: &crate::ir::Command,
    values: &mut HashMap<ValueId, Value>,
    vars: &mut HashMap<String, Value>,
    sink: &mut impl PrintSink,
    prints: &mut usize,
    steps: &mut usize,
    max_steps: usize,
) -> Result<Flow, ExecError> {
    match &command.op {
        Op::Lit(value) => {
            if !command.inputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 inputs".to_string(),
                    found: command.inputs.len(),
                });
            }
            if command.outputs.len() > 1 {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0..1 outputs".to_string(),
                    found: command.outputs.len(),
                });
            }
            if let Some(out) = command.outputs.first() {
                values.insert(*out, value.clone());
            }
            Ok(None)
        }
        Op::Print => {
            if command.inputs.len() != 1 {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "1 input".to_string(),
                    found: command.inputs.len(),
                });
            }
            if !command.outputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 outputs".to_string(),
                    found: command.outputs.len(),
                });
            }
            let input = read_input(command.id, values, command.inputs[0])?;
            // Strings are templates ("\"hi {name}\" + \"!\""); every other
            // value prints via its Display form.
            let text = match input {
                Value::String(template) => {
                    render_template(template, vars).map_err(|e| map_expr_fail(e, command.id))?
                }
                other => print_text(other),
            };
            sink.print(&text);
            *prints += 1;
            Ok(None)
        }
        Op::Set { var, ty } => {
            if command.inputs.len() != 1 {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "1 input".to_string(),
                    found: command.inputs.len(),
                });
            }
            if !command.outputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 outputs".to_string(),
                    found: command.outputs.len(),
                });
            }
            let name = check_var_name(var).map_err(|e| map_expr_fail(e, command.id))?;
            if *ty == Type::Void {
                return Err(ExecError::TypeMismatch {
                    command: command.id,
                    detail: "cannot declare a variable of type void".to_string(),
                });
            }
            let value = read_input(command.id, values, command.inputs[0])?.clone();
            if value.ty() != *ty {
                return Err(ExecError::TypeMismatch {
                    command: command.id,
                    detail: format!(
                        "variable '{name}' declared as {} but got {} value",
                        ty.tag(),
                        value.ty().tag()
                    ),
                });
            }
            if let Some(current) = vars.get(&name) {
                if current.ty() != *ty {
                    return Err(ExecError::TypeMismatch {
                        command: command.id,
                        detail: format!(
                            "cannot change type of variable '{name}' from {} to {}",
                            current.ty().tag(),
                            ty.tag()
                        ),
                    });
                }
            }
            vars.insert(name, value);
            Ok(None)
        }
        Op::Get { var } => {
            if !command.inputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 inputs".to_string(),
                    found: command.inputs.len(),
                });
            }
            if command.outputs.len() != 1 {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "1 output".to_string(),
                    found: command.outputs.len(),
                });
            }
            let name = check_var_name(var).map_err(|e| map_expr_fail(e, command.id))?;
            let value = vars.get(&name).ok_or(ExecError::UnknownVariable {
                command: command.id,
                var: name.clone(),
            })?;
            values.insert(command.outputs[0], value.clone());
            Ok(None)
        }
        Op::Compute { expr } => {
            if !command.inputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 inputs".to_string(),
                    found: command.inputs.len(),
                });
            }
            if command.outputs.len() != 1 {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "1 output".to_string(),
                    found: command.outputs.len(),
                });
            }
            let out = eval_expr(expr, vars).map_err(|e| map_expr_fail(e, command.id))?;
            values.insert(command.outputs[0], out);
            Ok(None)
        }
        Op::Return { expr } => {
            if !command.inputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 inputs".to_string(),
                    found: command.inputs.len(),
                });
            }
            if !command.outputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 outputs".to_string(),
                    found: command.outputs.len(),
                });
            }
            let out = eval_expr(expr, vars).map_err(|e| map_expr_fail(e, command.id))?;
            Ok(Some(out))
        }
        Op::If {
            condition,
            then_body,
            else_body,
        } => {
            let body = select_if_body(
                read_bool_condition(values, command.id, condition)?,
                then_body,
                else_body,
            );
            let body_set: HashSet<CommandId> = body.iter().copied().collect();
            let mut body_current = body.first().copied();
            while let Some(body_id) = body_current {
                if !body_set.contains(&body_id) {
                    break;
                }
                if *steps >= max_steps {
                    return Err(ExecError::LoopLimit { limit: max_steps });
                }
                let body_cmd = function
                    .find_command(body_id)
                    .ok_or(ExecError::UnknownCommand { command: body_id })?;
                *steps += 1;
                let flow = run_command(
                    function, body_cmd, values, vars, sink, prints, steps, max_steps,
                )?;
                if let Some(value) = flow {
                    return Ok(Some(value));
                }
                body_current = body_cmd.next;
            }
            Ok(None)
        }
    }
}

fn read_input(
    command: CommandId,
    values: &HashMap<ValueId, Value>,
    id: ValueId,
) -> Result<&Value, ExecError> {
    values
        .get(&id)
        .ok_or(ExecError::MissingValue { command, value: id })
}

/// Read an `Op::If` condition as a bool. A missing value and a non-`Bool`
/// value are typed errors carrying the `If` command's id.
fn read_bool_condition(
    values: &HashMap<ValueId, Value>,
    command: CommandId,
    condition: &ValueId,
) -> Result<bool, ExecError> {
    let cond_value = values.get(condition).ok_or(ExecError::MissingValue {
        command,
        value: *condition,
    })?;
    if cond_value == &Value::Bool(true) {
        Ok(true)
    } else if cond_value == &Value::Bool(false) {
        Ok(false)
    } else {
        Err(ExecError::TypeMismatch {
            command,
            detail: format!("if condition must be bool, got {}", cond_value.ty().tag()),
        })
    }
}

/// Pick the taken branch of an `Op::If`: empty when taken without `else`.
fn select_if_body<'b>(
    cond: bool,
    then_body: &'b [CommandId],
    else_body: &'b Option<Vec<CommandId>>,
) -> &'b [CommandId] {
    if cond {
        then_body
    } else {
        else_body.as_ref().map(|v| v.as_slice()).unwrap_or(&[])
    }
}

fn map_expr_fail(err: ExprFail, command: CommandId) -> ExecError {
    match err {
        ExprFail::Parse(detail) => ExecError::ExprError { command, detail },
        ExprFail::UnknownVariable(var) => ExecError::UnknownVariable { command, var },
        ExprFail::TypeMismatch(detail) => ExecError::TypeMismatch { command, detail },
        ExprFail::Overflow => ExecError::Overflow { command },
        ExprFail::DivByZero => ExecError::DivByZero { command },
        ExprFail::UnknownFunction(name) => ExecError::UnknownFunction { command, name },
        ExprFail::MissingReturn(function) => ExecError::MissingReturn { command, function },
        ExprFail::Callee(inner) => *inner,
    }
}

// ---------------------------------------------------------------------------
// Package-aware runs: `main` + `name()` calls share one step budget.
// ---------------------------------------------------------------------------

/// Run the `main` function of a `Program` (id 0, fallback by name).
/// Helper calls (`name()`) share the step cap, sink and depth budget;
/// each call gets fresh variables. `main` itself cannot be called.
pub fn run_program(program: &Program, sink: &mut impl PrintSink) -> Result<ExecReport, ExecError> {
    run_program_with_limit(program, sink, MAX_STEPS)
}

/// Same as [`run_program`] with an explicit step cap.
pub fn run_program_with_limit(
    program: &Program,
    sink: &mut impl PrintSink,
    max_steps: usize,
) -> Result<ExecReport, ExecError> {
    let mut steps: usize = 0;
    let mut prints: usize = 0;
    let main = find_main(program).ok_or(ExecError::UnknownFunction {
        command: CommandId(0),
        name: "main".to_string(),
    })?;
    run_func(program, main, sink, &mut steps, &mut prints, max_steps, 0)?;
    Ok(ExecReport { steps, prints })
}

/// Same as [`run_program`] but also captures `main`'s `Return` value.
pub fn run_program_returning(
    program: &Program,
    sink: &mut impl PrintSink,
) -> Result<(ExecReport, Option<Value>), ExecError> {
    run_program_returning_with_limit(program, sink, MAX_STEPS)
}

/// Same as [`run_program_returning`] with an explicit step cap.
pub fn run_program_returning_with_limit(
    program: &Program,
    sink: &mut impl PrintSink,
    max_steps: usize,
) -> Result<(ExecReport, Option<Value>), ExecError> {
    let mut steps: usize = 0;
    let mut prints: usize = 0;
    let main = find_main(program).ok_or(ExecError::UnknownFunction {
        command: CommandId(0),
        name: "main".to_string(),
    })?;
    let returned = run_func(program, main, sink, &mut steps, &mut prints, max_steps, 0)?;
    Ok((ExecReport { steps, prints }, returned))
}

fn find_main(program: &Program) -> Option<&Function> {
    program
        .functions
        .iter()
        .find(|f| f.id.0 == 0)
        .or_else(|| program.functions.iter().find(|f| f.name == "main"))
}

fn find_by_name<'a>(program: &'a Program, name: &str) -> Option<&'a Function> {
    program.functions.iter().find(|f| f.name == name)
}

#[allow(clippy::too_many_arguments)]
fn run_func(
    program: &Program,
    function: &Function,
    sink: &mut impl PrintSink,
    steps: &mut usize,
    prints: &mut usize,
    max_steps: usize,
    depth: usize,
) -> Result<Option<Value>, ExecError> {
    let mut values: HashMap<ValueId, Value> = HashMap::new();
    let mut vars: HashMap<String, Value> = HashMap::new();
    let mut current = function.entry;

    while let Some(id) = current {
        if *steps >= max_steps {
            return Err(ExecError::LoopLimit { limit: max_steps });
        }
        let command = function
            .find_command(id)
            .ok_or(ExecError::UnknownCommand { command: id })?;
        let flow = run_command_with_calls(
            program,
            function,
            command,
            &mut values,
            &mut vars,
            sink,
            prints,
            steps,
            max_steps,
            depth,
        )?;
        current = command.next;
        *steps += 1;
        if let Some(value) = flow {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

#[allow(clippy::too_many_arguments)]
fn run_command_with_calls(
    program: &Program,
    function: &Function,
    command: &crate::ir::Command,
    values: &mut HashMap<ValueId, Value>,
    vars: &mut HashMap<String, Value>,
    sink: &mut impl PrintSink,
    prints: &mut usize,
    steps: &mut usize,
    max_steps: usize,
    depth: usize,
) -> Result<Flow, ExecError> {
    // Shared call resolver: zero-arg helpers with fresh scope.
    let mut call = |name: &str| -> Result<Value, ExprFail> {
        if name == "main" {
            return Err(ExprFail::Parse(
                "cannot call entry function 'main' from expressions".to_string(),
            ));
        }
        if depth >= MAX_CALL_DEPTH {
            return Err(ExprFail::Callee(Box::new(ExecError::LoopLimit {
                limit: max_steps,
            })));
        }
        let Some(callee) = find_by_name(program, name) else {
            return Err(ExprFail::UnknownFunction(name.to_string()));
        };
        match run_func(program, callee, sink, steps, prints, max_steps, depth + 1) {
            Ok(Some(value)) => Ok(value),
            Ok(None) => Err(ExprFail::MissingReturn(name.to_string())),
            Err(e) => Err(ExprFail::Callee(Box::new(e))),
        }
    };

    match &command.op {
        Op::Compute { expr } => {
            if !command.inputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 inputs".to_string(),
                    found: command.inputs.len(),
                });
            }
            if command.outputs.len() != 1 {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "1 output".to_string(),
                    found: command.outputs.len(),
                });
            }
            let out =
                eval_expr_with(expr, vars, &mut call).map_err(|e| map_expr_fail(e, command.id))?;
            values.insert(command.outputs[0], out);
            Ok(None)
        }
        Op::Return { expr } => {
            if !command.inputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 inputs".to_string(),
                    found: command.inputs.len(),
                });
            }
            if !command.outputs.is_empty() {
                return Err(ExecError::Arity {
                    command: command.id,
                    expected: "0 outputs".to_string(),
                    found: command.outputs.len(),
                });
            }
            let out =
                eval_expr_with(expr, vars, &mut call).map_err(|e| map_expr_fail(e, command.id))?;
            Ok(Some(out))
        }
        Op::If {
            condition,
            then_body,
            else_body,
        } => {
            let body = select_if_body(
                read_bool_condition(values, command.id, condition)?,
                then_body,
                else_body,
            );
            let body_set: HashSet<CommandId> = body.iter().copied().collect();
            let mut body_current = body.first().copied();
            while let Some(body_id) = body_current {
                if !body_set.contains(&body_id) {
                    break;
                }
                if *steps >= max_steps {
                    return Err(ExecError::LoopLimit { limit: max_steps });
                }
                let body_cmd = function
                    .find_command(body_id)
                    .ok_or(ExecError::UnknownCommand { command: body_id })?;
                *steps += 1;
                let flow = run_command_with_calls(
                    program, function, body_cmd, values, vars, sink, prints, steps, max_steps,
                    depth,
                )?;
                if let Some(value) = flow {
                    return Ok(Some(value));
                }
                body_current = body_cmd.next;
            }
            Ok(None)
        }
        // Non-expression ops behave exactly as the single-function path.
        _ => run_command(
            function, command, values, vars, sink, prints, steps, max_steps,
        ),
    }
}
