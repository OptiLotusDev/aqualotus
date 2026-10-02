use std::collections::HashMap;

use crate::error::ExecError;
use crate::expr::{check_var_name, eval_expr, render_template, ExprFail};
use crate::ir::{CommandId, Function, ValueId};
use crate::ops::{print_text, Op};
use crate::sink::PrintSink;
use crate::types::Type;
use crate::value::Value;

/// Default step cap: cycles are allowed but bounded.
pub const MAX_STEPS: usize = 10_000;

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
    let mut values: HashMap<ValueId, Value> = HashMap::new();
    // Function scope: fresh variables per run, never shared between
    // functions or runs.
    let mut vars: HashMap<String, Value> = HashMap::new();
    let mut current = function.entry;
    let mut steps: usize = 0;
    let mut prints: usize = 0;

    while let Some(id) = current {
        if steps >= max_steps {
            return Err(ExecError::LoopLimit { limit: max_steps });
        }
        let command = function
            .find_command(id)
            .ok_or(ExecError::UnknownCommand { command: id })?;
        run_command(command, &mut values, &mut vars, sink, &mut prints)?;
        current = command.next;
        steps += 1;
    }

    Ok(ExecReport { steps, prints })
}

fn run_command(
    command: &crate::ir::Command,
    values: &mut HashMap<ValueId, Value>,
    vars: &mut HashMap<String, Value>,
    sink: &mut impl PrintSink,
    prints: &mut usize,
) -> Result<(), ExecError> {
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
            Ok(())
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
            Ok(())
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
            Ok(())
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
            Ok(())
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
            Ok(())
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

fn map_expr_fail(err: ExprFail, command: CommandId) -> ExecError {
    match err {
        ExprFail::Parse(detail) => ExecError::ExprError { command, detail },
        ExprFail::UnknownVariable(var) => ExecError::UnknownVariable { command, var },
        ExprFail::TypeMismatch(detail) => ExecError::TypeMismatch { command, detail },
        ExprFail::Overflow => ExecError::Overflow { command },
        ExprFail::DivByZero => ExecError::DivByZero { command },
    }
}
