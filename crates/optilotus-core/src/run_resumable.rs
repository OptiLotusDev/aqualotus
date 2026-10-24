use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use crate::error::ExecError;
use crate::exec::{find_main, map_expr_fail_pub, MAX_CALL_DEPTH, MAX_STEPS};
use crate::expr::{eval_expr_with, ExprFail};
use crate::ir::{CommandId, Function, Program, ValueId};
use crate::ops::{parse_input_line, Op};
use crate::sink::{VecSink, VecSource};
use crate::types::Type;
use crate::value::Value;

thread_local! {
    static ACTIVE: RefCell<Option<RunSession>> = const { RefCell::new(None) };
}

#[derive(Debug, Clone, PartialEq)]
pub struct PendingInput {
    pub command: CommandId,
    pub ty: Type,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RunStatus {
    WaitingInput {
        command: CommandId,
        ty: Type,
    },
    Finished {
        steps: usize,
        prints: usize,
        printed: Vec<String>,
        returned: Option<Value>,
    },
    Error(ExecError),
}

#[derive(Debug, Clone)]
pub struct BodyContext {
    pub set: HashSet<CommandId>,
    pub return_to: Option<CommandId>,
}

#[derive(Debug, Clone)]
pub struct Frame {
    pub function: Function,
    pub values: HashMap<ValueId, Value>,
    pub vars: HashMap<String, Value>,
    pub current: Option<CommandId>,
    pub body: Option<BodyContext>,
    pub depth: usize,
    pub running: Option<CommandId>,
}

#[derive(Debug)]
pub struct RunSession {
    pub program: Program,
    pub sink: VecSink,
    pub frames: Vec<Frame>,
    pub pending: Option<PendingInput>,
    pub input_cache: std::collections::HashMap<CommandId, Value>,
    pub global_steps: usize,
    pub global_prints: usize,
    pub max_steps: usize,
    pub result: Option<Value>,
    pub error: Option<ExecError>,
    pub call_result: Option<Value>,
}

impl RunSession {
    pub fn new(program: Program) -> Self {
        let mut run = Self {
            program,
            sink: VecSink::default(),
            frames: Vec::new(),
            pending: None,
            input_cache: std::collections::HashMap::new(),
            global_steps: 0,
            global_prints: 0,
            max_steps: MAX_STEPS,
            result: None,
            error: None,
            call_result: None,
        };
        match find_main(&run.program) {
            Some(main) => {
                run.frames.push(Frame {
                    function: main.clone(),
                    values: HashMap::new(),
                    vars: HashMap::new(),
                    current: main.entry,
                    body: None,
                    depth: 0,
                    running: None,
                });
            }
            None => {
                run.error = Some(ExecError::UnknownFunction {
                    command: CommandId(0),
                    name: "main".to_string(),
                });
            }
        }
        run
    }

    pub fn start(program: Program) -> Self {
        let mut run = Self::new(program);
        run.drive();
        run
    }

    pub fn status(&self) -> RunStatus {
        if let Some(p) = &self.pending {
            return RunStatus::WaitingInput {
                command: p.command,
                ty: p.ty,
            };
        }
        if let Some(err) = &self.error {
            return RunStatus::Error(err.clone());
        }
        if self.frames.is_empty() {
            return RunStatus::Finished {
                steps: self.global_steps,
                prints: self.global_prints,
                printed: self.sink.lines.clone(),
                returned: self.result.clone(),
            };
        }
        // Should not normally happen; treat as waiting on void.
        RunStatus::WaitingInput {
            command: CommandId(0),
            ty: Type::Void,
        }
    }

    pub fn provide_input(&mut self, value: &str) -> RunStatus {
        let pending = match self.pending.take() {
            Some(p) => p,
            None => {
                let e = ExecError::InvalidState;
                self.error = Some(e.clone());
                return RunStatus::Error(e);
            }
        };
        match parse_input_line(value, pending.ty) {
            Ok(v) => {
                self.input_cache.insert(pending.command, v.clone());
                if let Some(frame) = self.frames.last_mut() {
                    if let Some(cmd) = frame.function.find_command(pending.command) {
                        if let Some(out) = cmd.outputs.first() {
                            frame.values.insert(*out, v);
                        }
                        frame.running = None;
                        frame.current = cmd.next;
                    }
                }
                self.drive();
                self.status()
            }
            Err(detail) => {
                let e = ExecError::InputParse {
                    command: pending.command,
                    detail,
                };
                self.error = Some(e.clone());
                RunStatus::Error(e)
            }
        }
    }

    /// Peek at the pending input without consuming it.
    /// Returns `Some` when the run is paused waiting for input, `None` otherwise.
    pub fn peek_pending(&self) -> Option<&PendingInput> {
        self.pending.as_ref()
    }

    pub fn cancel(&mut self) {
        self.frames.clear();
        self.pending = None;
        self.error = None;
        self.result = None;
    }

    pub fn drive(&mut self) {
        loop {
            if self.pending.is_some() {
                return;
            }
            if self.error.is_some() {
                return;
            }
            if self.frames.is_empty() {
                return;
            }
            if self.global_steps >= self.max_steps {
                self.error = Some(ExecError::LoopLimit {
                    limit: self.max_steps,
                });
                return;
            }

            // Body context handling.
            {
                let frame = self.frames.last_mut().unwrap();
                if let Some(ctx) = frame.body.clone() {
                    let cur = frame.current;
                    let in_body = cur.map(|c| ctx.set.contains(&c)).unwrap_or(false);
                    if !in_body {
                        let ret = ctx.return_to;
                        frame.body = None;
                        frame.current = ret;
                        continue;
                    }
                }
            }

            // Pop completed frames.
            {
                let frame = self.frames.last().unwrap();
                if frame.current.is_none() {
                    self.frames.pop();
                    continue;
                }
            }
            // If the current command is already being evaluated (nested call),
            // do not re-enter it.
            {
                let frame = self.frames.last().unwrap();
                if frame.running.is_some() && frame.running == frame.current {
                    return;
                }
            }

            let frame_idx = self.frames.len() - 1;
            let cmd_id = self.frames[frame_idx].current.unwrap();
            let cmd = match self.frames[frame_idx].function.find_command(cmd_id) {
                Some(c) => c.clone(),
                None => {
                    self.error = Some(ExecError::UnknownCommand { command: cmd_id });
                    return;
                }
            };

            self.global_steps += 1;
            if let Some(frame) = self.frames.get_mut(frame_idx) {
                frame.running = Some(cmd.id);
            }

            match &cmd.op {
                Op::Input { ty } => {
                    if let Some(cached) = self.input_cache.get(&cmd.id).cloned() {
                        if let Some(out) = cmd.outputs.first() {
                            let frame = &mut self.frames[frame_idx];
                            frame.values.insert(*out, cached);
                        }
                        let frame = &mut self.frames[frame_idx];
                        frame.running = None;
                        frame.current = cmd.next;
                        continue;
                    }
                    self.pending = Some(PendingInput {
                        command: cmd.id,
                        ty: *ty,
                    });
                    return;
                }
                Op::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    let cond = {
                        let frame = &self.frames[frame_idx];
                        let v = frame.values.get(condition).cloned();
                        match v {
                            Some(Value::Bool(true)) => true,
                            Some(Value::Bool(false)) => false,
                            Some(_) => {
                                self.error = Some(ExecError::TypeMismatch {
                                    command: cmd.id,
                                    detail: "if condition must be bool".to_string(),
                                });
                                return;
                            }
                            None => {
                                self.error = Some(ExecError::MissingValue {
                                    command: cmd.id,
                                    value: *condition,
                                });
                                return;
                            }
                        }
                    };
                    let body = if cond {
                        then_body.clone()
                    } else {
                        else_body.clone().unwrap_or_default()
                    };
                    let frame = &mut self.frames[frame_idx];
                    if body.is_empty() {
                        frame.running = None;
                        frame.current = cmd.next;
                    } else {
                        frame.body = Some(BodyContext {
                            set: body.iter().copied().collect(),
                            return_to: cmd.next,
                        });
                        frame.current = Some(body[0]);
                    }
                    frame.running = None;
                    continue;
                }
                Op::Return { expr } => {
                    let expr = expr.clone();
                    let vars = self.frames[frame_idx].vars.clone();
                    let depth = self.frames[frame_idx].depth;
                    let mut call =
                        |name: &str| -> Result<Value, ExprFail> { self.call_helper(name, depth) };
                    match eval_expr_with(&expr, &vars, &mut call) {
                        Ok(v) => {
                            let is_main = self.frames.len() == 1;
                            self.frames.pop();
                            if is_main {
                                self.result = Some(v);
                            } else {
                                self.call_result = Some(v);
                            }
                        }
                        Err(ExprFail::Paused) => {
                            if let Some(frame) = self.frames.get_mut(frame_idx) {
                                frame.running = None;
                            }
                            return;
                        }
                        Err(e) => {
                            let ee = map_expr_fail_pub(e, cmd.id);
                            if let Some(frame) = self.frames.get_mut(frame_idx) {
                                frame.running = None;
                            }
                            self.error = Some(ee);
                            return;
                        }
                    }
                    continue;
                }
                Op::Compute { expr } => {
                    let expr = expr.clone();
                    let cmd_id = cmd.id;
                    let inputs = cmd.inputs.clone();
                    let outputs = cmd.outputs.clone();
                    if !inputs.is_empty() {
                        self.error = Some(ExecError::Arity {
                            command: cmd_id,
                            expected: "0 inputs".to_string(),
                            found: inputs.len(),
                        });
                        return;
                    }
                    if outputs.len() != 1 {
                        self.error = Some(ExecError::Arity {
                            command: cmd_id,
                            expected: "1 output".to_string(),
                            found: outputs.len(),
                        });
                        return;
                    }
                    let vars = self.frames[frame_idx].vars.clone();
                    let depth = self.frames[frame_idx].depth;
                    let mut call =
                        |name: &str| -> Result<Value, ExprFail> { self.call_helper(name, depth) };
                    match eval_expr_with(&expr, &vars, &mut call) {
                        Ok(v) => {
                            let frame = &mut self.frames[frame_idx];
                            frame.values.insert(outputs[0], v);
                        }
                        Err(ExprFail::Paused) => {
                            if let Some(frame) = self.frames.get_mut(frame_idx) {
                                frame.running = None;
                            }
                            return;
                        }
                        Err(e) => {
                            let ee = map_expr_fail_pub(e, cmd_id);
                            self.error = Some(ee);
                            return;
                        }
                    }
                    let frame = &mut self.frames[frame_idx];
                    frame.running = None;
                    frame.current = cmd.next;
                    continue;
                }
                _ => {
                    let flow = {
                        let frame = self.frames.last_mut().unwrap();
                        let mut dummy_input = VecSource::default();
                        crate::exec::run_command(
                            &frame.function,
                            &cmd,
                            &mut frame.values,
                            &mut frame.vars,
                            &mut self.sink,
                            &mut dummy_input,
                            &mut self.global_prints,
                            &mut self.global_steps,
                            self.max_steps,
                        )
                    };
                    match flow {
                        Ok(Some(v)) => {
                            let is_main = self.frames.len() == 1;
                            self.frames.pop();
                            if is_main {
                                self.result = Some(v);
                            } else {
                                self.call_result = Some(v);
                            }
                        }
                        Ok(None) => {}
                        Err(ExecError::Paused) => {
                            if let Some(frame) = self.frames.get_mut(frame_idx) {
                                frame.running = None;
                            }
                            if let Some((pc, pty)) = crate::exec::take_pending_input() {
                                self.pending = Some(PendingInput {
                                    command: pc,
                                    ty: pty,
                                });
                            }
                            return;
                        }
                        Err(e) => {
                            if let Some(frame) = self.frames.get_mut(frame_idx) {
                                frame.running = None;
                            }
                            self.error = Some(e);
                            return;
                        }
                    }
                    if let Some(frame) = self.frames.last_mut() {
                        if frame.current == Some(cmd.id) {
                            frame.current = cmd.next;
                        }
                    }
                    continue;
                }
            }
        }
    }

    fn call_helper(&mut self, name: &str, depth: usize) -> Result<Value, ExprFail> {
        if name == "main" {
            return Err(ExprFail::Parse(
                "cannot call entry function 'main' from expressions".to_string(),
            ));
        }
        if depth >= MAX_CALL_DEPTH {
            return Err(ExprFail::Callee(Box::new(ExecError::LoopLimit {
                limit: self.max_steps,
            })));
        }
        let callee = self
            .program
            .functions
            .iter()
            .find(|f| f.name == name)
            .cloned();
        let Some(callee) = callee else {
            return Err(ExprFail::UnknownFunction(name.to_string()));
        };
        let entry = callee.entry;
        self.call_result = None;
        self.frames.push(Frame {
            function: callee,
            values: HashMap::new(),
            vars: HashMap::new(),
            current: entry,
            body: None,
            depth: depth + 1,
            running: None,
        });
        self.drive();
        if self.pending.is_some() {
            return Err(ExprFail::Paused);
        }
        if let Some(err) = self.error.clone() {
            return Err(ExprFail::Callee(Box::new(err)));
        }
        match self.call_result.take() {
            Some(v) => Ok(v),
            None => Err(ExprFail::MissingReturn(name.to_string())),
        }
    }
}

// Free-function global API (mirrors bridge thread_local) for direct Rust use.
pub fn start(program: Program) -> RunStatus {
    let run = RunSession::start(program);
    let status = run.status();
    ACTIVE.with(|cell| {
        *cell.borrow_mut() = Some(run);
    });
    status
}

pub fn provide_input(value: &str) -> RunStatus {
    ACTIVE.with(|cell| {
        let mut cell = cell.borrow_mut();
        if let Some(run) = cell.as_mut() {
            run.provide_input(value)
        } else {
            let e = ExecError::InvalidState;
            RunStatus::Error(e)
        }
    })
}

pub fn cancel() {
    ACTIVE.with(|cell| {
        *cell.borrow_mut() = None;
    });
}

pub fn status() -> RunStatus {
    ACTIVE.with(|cell| {
        if let Some(run) = cell.borrow().as_ref() {
            run.status()
        } else {
            RunStatus::Error(ExecError::InvalidState)
        }
    })
}

/// Peek at the pending input without consuming it.
pub fn peek() -> Option<PendingInput> {
    ACTIVE.with(|cell| {
        cell.borrow()
            .as_ref()
            .and_then(|run| run.peek_pending().cloned())
    })
}

/// Clear the active run session entirely (reset).
pub fn reset() {
    ACTIVE.with(|cell| {
        *cell.borrow_mut() = None;
    });
}
