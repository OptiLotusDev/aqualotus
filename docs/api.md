# Optilotus Bridge API (P5)

Reference for the UI ↔ runtime boundary. Normative rules live in
`design-principles.md`; this file documents the interface only.

## Ownership and direction (P10/P11)

- Owner of language/runtime logic: `crates/optilotus` (Rust).
- Owner of WASM init state: `apps/aqualotus-ui/src/lib/optilotus.ts`.
- Owner of layout state: `useIsMobile`; owner of bridge status: `useOptilotus`.
- The UI depends on the runtime. The runtime never depends on the UI,
  Tauri, Capacitor, React, or a browser (`cargo test` runs headless).

## Rust core (`crates/optilotus/src/lib.rs`)

Pure, headless, unit-tested (`cargo test -p optilotus`):

- `version() -> &str` — crate version (`VERSION`).
- `health_check() -> &str` — `"ok"` when linked and running.
- Package registry (`Package`, one package, many functions, stable `main`):
  - `list_functions()`, `create_function(name)`, `get_function(id)`,
    `delete_function(id)` (`main` protected), `try_rename(id, new_name)`
    (name only; stable id untouched), `clear_package()`.
  - Command builders (expand onto existing IR; `return` is `Op::Return`):
    `declare(fid, name, ty, init?)`, `assign(fid, name, expr)`,
    `print(fid, template)`, `input(fid, ty)`, `return_(fid, expr)`, `list_commands(fid)`,
    `set_entry(fid, entry?)`, `set_next(fid, cmd, next?)`,
    `delete_command(fid, cmd)`.
  - Branching (`Op::If`, nestable): `eval_cond(fid, expr)` evaluates an
    expression into a hidden `ValueId` for use as a condition;
    `if_(fid, condition, then_body, else_body?)` owns ordered child
    command bodies; `add_raw_command(fid, command)` stages body commands
    outside the main chain.
  - `run_main(sink)` / `run_main_with_limit(sink, limit)` — runs `main`
    by id only, with `name()` calls + `Return` shared over one step budget.
- Expression evaluator (`expr` module):
  - `eval_expr(expr, vars)` — evaluate arithmetic + comparison expression
    with `{variable}` references. Comparisons (`== != < <= > >=`) and the
    `true`/`false` literals produce `Bool`; `3 > "hello"` is a `TypeError`.
  - `eval_expr_with(expr, vars, call)` — evaluate with `name()` call support.
  - `render_template(template, vars)` — render print template with `{variable}` interpolation
    and arithmetic expression evaluation.
  - `check_var_name(raw)` — validate variable names (trimmed, no `{}"` chars).
  - `MAX_EXPR_DEPTH` — maximum parenthesis nesting (64).

Naming rule: every function in the UI that originates from the Optilotus
API layer carries the `optilotus_` prefix with a camelCase remainder
(e.g. `optilotus_runProgram`), so Optilotus origin is visible at the
call site. This deliberately takes precedence over the generic camelCase
rule (P9/P24) for the bridge boundary. Rust internals stay `snake_case`
as required by the Rust compiler.

## WASM exports (generated, do not hand-edit)

Built with `npm run build:wasm` into `src/wasm/optilotus/`:

**Core**
- `optilotus_version(): string`
- `optilotus_health(): string`

**Package CRUD**
- `optilotus_listFunctions(): string`
- `optilotus_createFunction(name: string): string`
- `optilotus_getFunction(id: number): string`
- `optilotus_deleteFunction(id: number): string`
- `optilotus_renameFunction(id: number, name: string): string`
- `optilotus_clearPackage(): string`

**Command builders** (all take `fid: number`)
- `optilotus_declare(fid, name, ty: string, init?: string): string`
- `optilotus_assign(fid, name, expr: string): string`
- `optilotus_print(fid, template: string): string`
- `optilotus_input(fid, ty: string): string`
- `optilotus_cast(fid, name, to: string, expr: string): string`
- `optilotus_return(fid, expr: string): string`
- `optilotus_listCommands(fid): string`
- `optilotus_setEntry(fid, cmd?: number): string` (`null`/omitted clears)
- `optilotus_setNext(fid, cmd, next?: number): string`
- `optilotus_deleteCommand(fid, cmd): string`

**Run**
- `optilotus_runProgram(): string` (JSON report, no JSON input)
- `optilotus_runProgramWithInputs(inputs_json: string): string`

**Resumable run lifecycle** (one active run at a time)
- `optilotus_runProgramStart(): string`
- `optilotus_runProgramProvideInput(value: string): string`
- `optilotus_runProgramProvideInputs(inputs_json: string): string`
- `optilotus_runProgramProvideInputTyped(value_json: string): string`
- `optilotus_runProgramStatus(): string`
- `optilotus_runProgramPeekPending(): string`
- `optilotus_runProgramCancel(): void`
- `optilotus_runProgramReset(): string`

**if-branching** (native types, no JSON)
- `optilotus_if(fid, cond_expr: string, then_specs: any[], else_specs?: any[] | null): number`

**Debug**
- `optilotus_debugMode(enable: boolean): void`
- `optilotus_lastError(): string`

## TypeScript bridge (`src/lib/optilotus.ts`)

Single UI entry point. Await `optilotus_tryEnsure()` once; sync
wrappers throw an explicit error before init (P22). Package wrappers are
typed (JSON is parsed once inside); UI call sites never build or pass IR
JSON:

- `optilus_tryEnsure(): Promise<void>` — fallible load (`try_`, P9).
- `optilus_version(): string`
- `optilus_health(): string`
- Types: `FunctionId`, `CommandId`, `FunctionSummary`, `FunctionInfo`,
  `CommandSummary`, `RunResult` (`RunOk | RunErr`), `OptilotusError`,
  `CommandSpec`, `optilotus_type` (`optilotus_type.int32`, …) + `OptilotusType`.
  Wire JSON uses `camelCase` (`isMain`, `commandCount`); Rust fields stay
  `snake_case`.
- `optilus_listFunctions(): {status:"ok",functions: FunctionSummary[]}`
- `optilus_createFunction(name): {status:"ok",id,name,isMain} | OptilotusError`
- `optilus_getFunction(id): ({status:"ok"} & FunctionInfo) | OptilotusError`
- `optilus_deleteFunction(id): {status:"ok",deleted} | OptilotusError`
- `optilus_renameFunction(id, name): {status:"ok",id,name,isMain} | OptilotusError`
- `CommandSummary` gains kind `"if"` with optional `condition`,
  `then_body`, `else_body` fields.
- `optilus_clearPackage(): {status:"ok",cleared}`
- `optilus_declare(fid, name, ty: OptilotusType, init?): {status:"ok",id} | OptilotusError`
- `optilus_assign(fid, name, expr): {status:"ok",id} | OptilotusError`
- `optilus_print(fid, template): {status:"ok",id} | OptilotusError`
- `optilus_input(fid, ty): {status:"ok",id} | OptilotusError`
- `optilus_cast(fid, name, to, expr): {status:"ok",id} | OptilotusError`
- `optilus_return(fid, expr): {status:"ok",id} | OptilotusError`
- `optilus_listCommands(fid): {status:"ok",commands: CommandSummary[]} | OptilotusError`
- `optilus_setEntry(fid, cmd: number | null): {status:"ok"} | OptilotusError`
- `optilus_setNext(fid, cmd, next?): {status:"ok"} | OptilotusError`
- `optilus_deleteCommand(fid, cmd): {status:"ok",deleted} | OptilotusError`
- `optilus_runProgram(): RunResult` — runs `main` by id only.
- `optilus_runProgramWithInputs(inputs: string[]): RunResult` — runs `main`
  consuming the supplied lines in order.
- `optilus_if(fid, condition, thenBody: CommandSpec[], elseBody?): {status:"ok",id} | OptilotusError`
  — creates an `if` in one call; body specs cross as native JS objects.
- `optilus_runProgramStart(): RunStatus`
- `optilus_runProgramProvideInput(value): RunStatus`
- `optilus_runProgramProvideInputs(inputs): RunStatus`
- `optilus_runProgramProvideInputTyped(value): RunStatus`
- `optilus_runProgramStatus(): RunStatus | RunIdle`
- `optilus_runProgramPeekPending(): PendingInput | RunIdle`
- `optilus_runProgramCancel(): void`
- `optilus_runProgramReset(): RunIdle`
- `optilus_lastError(): OptilotusError | RunIdle`
- `optilus_debugMode(enable): void`

## Package API (the only API)

One package, many functions, permanent `main` (`FunctionId(0)`).
Frontend surface is IDs + typed results; JSON never leaves the bridge:

```ts
const { functions } = optilotus_listFunctions();
// [{id: 0, name: "main", isMain: true}]

const created = optilotus_createFunction("helper");
// {status:"ok", id: 1, name: "helper", isMain: false}

optilotus_declare(0, "n", optilotus_type.int32, "41");
optilotus_assign(0, "n", "{n} + 1");
optilotus_print(0, '"{n}"');

optilotus_listCommands(0);
// {status:"ok", commands: [
//   {id, kind:"declare", next, var:"n", ty:"int32", expr:"41"},
//   {id, kind:"assign", next, var:"n", expr:"{n} + 1"},
//   {id, kind:"print", next:null, template:'"{n}"'},
// ]}
// `next` is the following user head (`null` at the tail); together with
// `getFunction(...).entry` the editor rebuilds the chain from this list.

const result: RunResult = optilotus_runProgram();
// {status:"ok", steps: 6, prints: 1, printed: ["42"]}
```

### if-branching

`optilus_if` creates an `Op::If` in one call. The condition expression is
evaluated into a hidden `ValueId` appended to the main chain; each body
spec is expanded into raw commands linked in order. No raw ids or IR cross
the boundary — you pass expressions and user-level `CommandSpec` objects.

```ts
const thenBody: CommandSpec[] = [
  { kind: "print", template: '"x is big"' },
];
const elseBody: CommandSpec[] = [
  { kind: "print", template: '"x is small"' },
];
const ifCmd = optilotus_if(0, "{x} > 10", thenBody, elseBody);
// {status:"ok", id: 7}  — the if-command's user id

// Link it into the main chain (e.g. after the previous tail):
optilus_setNext(0, prevTailId, ifCmd.id);
// or make it the entry: optilotus_setEntry(0, ifCmd.id);
```

`CommandSpec` is a tagged union (native JS object, no JSON strings):

```ts
type CommandSpec =
  | { kind: "declare"; var: string; ty: OptilotusType; init?: string }
  | { kind: "assign"; var: string; expr: string }
  | { kind: "print"; template: string }
  | { kind: "input"; ty: OptilotusType }
  | { kind: "cast"; var: string; to: OptilotusType; expr: string };
```

Rules:
- The condition expression must produce a `Bool` at runtime (comparisons
  or `true`/`false` literals). A non-bool condition is a typed error.
- Body specs are validated before any mutation: a bad spec (unknown
  variable, bad type, empty expression) returns a `PackageError` and the
  package is left unchanged.
- `declare` and `cast` introduce variables usable by later `assign`/`print`
  specs in the same body and by the main chain after the if.
- Body commands are hidden from `listCommands` (they are reachable only
  through the if's `then_body`/`else_body`).
- `return` and `if` cannot be staged as body commands (a typed error).
- Delete an if with `optilus_deleteCommand(fid, ifCmd.id)`; this removes
  the if command but leaves its body commands as orphans (they are no
  longer reachable).

### Resumable run workflow

The resumable API runs `main` with interactive input. One active run at a
time (the WASM bridge holds a single global session).

```ts
const status = optilotus_runProgramStart();
// {status:"waiting_input", command: 5, ty:"int32"}  — paused at an input

const peek = optilotus_runProgramPeekPending();
// {status:"waiting_input", command: 5, ty:"int32"}  — same, non-consuming

const next = optilotus_runProgramProvideInput("42");
// {status:"ok", steps: 8, prints: 2, printed: [...]}  — finished

optilotus_runProgramCancel();   // discard the active run
optilotus_runProgramReset();    // same as cancel
```

- `optilus_runProgramStatus()` — poll without providing input.
- `optilus_runProgramProvideInputs(["1","2"])` — batch; stops at the
  first `waiting_input`.
- `optilus_runProgramProvideInputTyped('42')` — provide a JSON-encoded
  value matched to the pending command's type.
- `optilus_lastError()` — the last execution error as a typed object.
- Malformed input JSON returns a typed `InvalidInputs` error (never a
  silent empty run).

### Single-package limitation

The WASM bridge exposes one global `Package` per WASM instance. Two tabs,
two runs, or two packages cannot coexist through the bridge. For native
(Rust) consumers needing multiple instances, use the crate API directly:
`Package::new()` and `RunSession` are public and fully owner-based.

### Expression evaluation in templates

When a print template is a single quoted string containing `{variable}`
references and arithmetic operators, the interpolated result is evaluated
as an arithmetic expression before printing:

```ts
optilotus_declare(0, "x", optilotus_type.int32, "10");
optilotus_declare(0, "y", optilotus_type.int32, "5");
optilotus_print(0, '"{x} + {y}"');
// prints "15" (not "10 + 5")
```

Rules:
- The entire quoted string must be a valid arithmetic expression after
  interpolation. If it is not (e.g. `"Sum: {x} + {y}"`), the literal
  interpolated string is printed.
- All arithmetic operators are supported: `+`, `-`, `*`, `/`, `%`.
- Parentheses and unary minus work as expected.
- Variables must be declared before use; unknown variables are a typed error.
- Type rules match `assign`: same-type arithmetic only, literals adopt
  the variable's type.

### Math expressions in assignment

`assign` evaluates the expression and stores the result:

```ts
optilotus_declare(0, "x", optilotus_type.int32, "10");
optilotus_declare(0, "y", optilotus_type.int32, "5");
optilotus_declare(0, "z", optilotus_type.int32);
optilotus_assign(0, "z", "{x} + {y}");
optilotus_print(0, '"{z}"');
// prints "15"
```

- `create_function("main")` and duplicate names are rejected; `main`
  cannot be deleted; `clear_package()` wipes helpers and re-creates an
  empty `main`.
- `declare` needs an unused name + `optilotus_type` tag; `assign` needs a
  declared name (type is taken from the declaration); `print` takes a
  template; `return` takes an expression and stops the function.
- `list_commands` returns user kinds (`declare` | `assign` | `print` |
  `input` | `return`), never raw `Lit`/`Get`/`Compute`.
- Calls live in expression text: `helper()` runs the helper with fresh
  variables, shared steps/prints, and uses its `Return` value. Unknown
  names are `UnknownFunction`, missing `Return` is `MissingReturn`,
  calling `main` is an expression error, recursion hits `LoopLimit`.
- Errors are typed: `PackageError` for CRUD/builders (`command` set for
  `UnknownCommand`), execution failures carry the offending `command`
  (`null` for `LoopLimit`).
- `setEntry(fid, null)` clears the entry (run becomes a no-op; commands
  are kept as orphans).
- The transient `Program` snapshot uses the hardcoded package name `"app"`
  (`PACKAGE_NAME`) — not user-settable until multi-package exists.
- Variables live for one run only — each call starts with an empty scope.

## UI state

- `useOptilotus(): OptilotusStatus` (`src/hooks/useOptilotus.ts`) —
  readonly snapshot for `OptilotusPanel` (demo runs `main` via the
  package API, no session).
- `useIsMobile(): boolean` — viewport/nativeshell layout switch.
- `hasCapacitorBridge(value: unknown)` / `isNativeMobile(value: unknown)`
  (`src/hooks/capacitorBridge.ts`) — pure predicates, tested with
  `npm run test:ui` (P6).
