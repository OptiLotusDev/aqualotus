# Dev Notes — OptiLotus Engine Changes (2026-11)

## Engine (optilotus-core)

- **Nested `If` in branches.** `if_append` now accepts `Op::If` (still rejects `Op::Return`). Moving an `If` also moves its hidden condition compute and updates `function.entry`.
- **Condition replacement.** `if_set_condition` orphans the previous condition compute so it no longer sits on the live chain.
- **`raw_group` isolation.** Walking a user command's raw group stops before hidden condition computes of other `if`s.
- **Command location metadata.** `CommandSummary` carries optional `x`, `y` (opaque UI metadata). `Package::set_location` / `optilotus_setLocation` update them and are undoable (`LocationChanged` commit).
- **Undo/redo completeness.** `FunctionCreated`, `FunctionRenamed`, `EntryChanged`, `FunctionDeleted`, `CommandDeleted`, `LocationChanged` now have forward/inverse apply and are recorded. `CommandDeleted` uses before/after snapshots so deleted commands keep their IDs on undo/redo.
- **Incremental console output.** `WaitingInputResponse` and `ErrorResponse` carry optional `printed: Vec<String>` (accumulated sink lines). `RunStatus::WaitingInput` now includes `printed`.
- **Expression templates.** Quoted templates stay literal unless they contain `{variable}` interpolation, in which case the interpolated result is evaluated as arithmetic. Brace-delimited expressions (`{2 + 3}`) are evaluated directly. Literal-only quoted strings (e.g. `"2 + 3"`) stay literal.
- **Cast robustness.** `cast_value`'s unreachable arm replaced with an error.

## Frontend notes

- Prefer engine undo/redo over the UI stack; the engine now records all data-affecting actions, including entry, location, function create/rename/delete, and command delete. UI history can be simplified to engine calls.
- Call `optilotus_setLocation(fid, cmd, x, y)` whenever a block moves; the engine stores it for save files and undo correctness.
- `waiting_input` and `error` envelopes now carry `printed`; `applyRunStatus` already replaces the console transcript with whatever array a status carries, so no UI changes are needed.
- Mixed-width arithmetic is rejected by the engine; use matching widths.
- `main`/entry: use `optilotus_setEntry` (now in the public API) to mark a standalone command as the run head.
- Nested `if` in branches is supported by the engine (`if_append` with an `If` target).
