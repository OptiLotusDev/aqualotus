# Optilotus Bridge API (P5)

Reference for the UI ↔ runtime boundary. Normative rules live in
`design-principles.md`; this file documents the interface only.

Read this before touching anything that crosses the boundary. The
contract has three layers, and it matters which one you are changing:

```
crates/optilotus/src/wire.rs     ← the wire format, declared once (Rust)
        │  ts-rs (feature `ts-bindings`)
        ▼
apps/aqualotus-ui/src/wasm/optilotus/bindings/   ← generated TS types
        │  re-exported by
        ▼
apps/aqualotus-ui/src/lib/optilotus.ts           ← typed wrappers (UI entry)
```

## Ownership and direction (P10/P11)

- Owner of language/runtime logic: `crates/optilotus` (Rust).
- Owner of the wire format: `crates/optilotus/src/wire.rs`.
- Owner of WASM init state: `apps/aqualotus-ui/src/lib/optilotus.ts`.
- Owner of layout state: `useIsMobile`; owner of bridge status: `useOptilotus`.
- The UI depends on the runtime. The runtime never depends on the UI,
  Tauri, Capacitor, React, or a browser (`cargo test` runs headless).

## The wire format (`crates/optilotus/src/wire.rs`)

Every value that crosses the bridge is a declared Rust type. The bridge
does **not** build responses with ad-hoc `serde_json::json!` literals —
that was the old design and it let the TypeScript types drift from the
engine, because the format existed only as scattered inline JSON.

### Response envelopes

One type per response shape. Each carries a `status` discriminant.

| Type | Shape | Used by |
|---|---|---|
| `OkResponse` | `{status:"ok"}` | `setEntry`, `setNext` |
| `IdleResponse` | `{status:"idle"}` | run queries with no session |
| `CommandIdResponse` | `{status:"ok", id}` | command builders |
| `DeletedResponse` | `{status:"ok", deleted}` | `deleteFunction`, `deleteCommand` |
| `ClearedResponse` | `{status:"ok", cleared}` | `clearPackage` |
| `FunctionRow` | `{id, name, isMain}` | rows inside `listFunctions` |
| `ListFunctionsResponse` | `{status:"ok", functions: FunctionRow[]}` | `listFunctions` |
| `FunctionResponse` | `{status:"ok", id, name, isMain}` | `createFunction`, `renameFunction` |
| `FunctionInfoResponse` | `{status:"ok", id, name, isMain, entry, commandCount}` | `getFunction` |
| `ListCommandsResponse` | `{status:"ok", commands: CommandSummary[]}` | `listCommands` |
| `RunOkResponse` | `{status:"ok", steps, prints, printed, returned}` | `runProgram` and friends |
| `WaitingInputResponse` | `{status:"waiting_input", command, ty}` | resumable run |
| `ErrorResponse` | see below | every failure |

### Error envelope

```rust
pub struct ErrorResponse {
    pub status: &'static str,   // "error"
    pub kind: String,           // "PackageError", "TypeMismatch", "NoRun", ...
    pub command: Option<u32>,   // responsible command, null when unattributed
    pub message: String,
    pub detail: Option<String>, // kind-specific extra information
    pub value: Option<u32>,     // MissingValue: the offending value id
    pub expected: Option<String>, // Arity: expected parameter shape
    pub found: Option<usize>,     // Arity: arguments actually supplied
    pub limit: Option<usize>,     // LoopLimit: the step budget
    pub var: Option<String>,      // UnknownVariable: the name
    pub function: Option<String>, // UnknownFunction / MissingReturn: the name
}
```

Optional fields are **omitted** when not applicable, so an error only
carries the fields that mean something for its `kind`. The
`ExecError` → envelope mapping lives in `wire::exec_error_response` — one
owner (P1). Add a variant to `ExecError` and the compiler will make you
handle it there.

### Compatibility rule (P18)

The wire format is a **stable interface**. Serialized output may grow
(optional fields may be added) but must not shrink or change meaning:
a consumer reading a field must keep finding it.

`tests/wire_compat.rs` and `tests/wire_compat_mechanical.rs` enforce
this. The mechanical test extracts the pre-refactor field set from git
history and asserts the current envelope is a superset, so removing a
field fails the build rather than silently breaking a consumer.

If you must change the format incompatibly, that is a deliberate
architectural change: version it and provide a migration (P18).

### Why responses are JSON strings

The bridge returns JSON **text**, not `JsValue`. This is deliberate: a
malformed response can then never throw across the wasm boundary — every
call yields a parseable envelope and the UI discriminates on `status`.
`bridge::to_json` is the single place that knows responses travel as
text, and it degrades to a typed error envelope rather than panicking if
serialization ever fails (P22).

## Type generation (ts-rs)

The TypeScript types are **generated from Rust**, so they cannot drift.

```bash
npm run build:bindings     # cargo test -p optilotus --lib --features ts-bindings
npm run build:wasm:all     # wasm + bindings (what every build path uses)
```

Output lands in `apps/aqualotus-ui/src/wasm/optilotus/bindings/`, which
is git-ignored along with the rest of `src/wasm/`. Never edit those files
by hand.

### How it is wired

- `ts-rs` is an **optional** dependency behind the `ts-bindings` cargo
  feature. It must stay optional: a codegen tool has no business in the
  shipped wasm binary (P11/P12). Verified with `cargo tree` — the default
  build and the `wasm32` target both link zero `ts-rs`.
- Output directory is configured once in `.cargo/config.toml`
  (`TS_RS_EXPORT_DIR`, relative to the workspace root). Do not add
  per-attribute `export_to` paths: they resolve against
  `CARGO_MANIFEST_DIR` and scatter files into `crates/`.
- `TS_RS_LARGE_INT = "number"` is required. Without it `i64`/`u64`/
  `i128`/`u128` generate as `bigint`, which `JSON.parse` cannot produce.
- Export runs as a generated `#[test]`, so it happens on
  `cargo test --features ts-bindings`.

### Attributes that matter

| Attribute | Why |
|---|---|
| `#[serde(rename = "isMain")]` | Rust stays `snake_case`, the wire is `camelCase` |
| `#[serde(skip_serializing_if = "Option::is_none")]` | field is **omitted** when absent |
| `#[ts(optional)]` | pairs with the above so TS gets `field?: T`, not `T \| null` |
| `#[ts(type = "\"ok\"")]` | makes `status` a literal so TS discriminated unions narrow |

`optional` and `| null` are **not** interchangeable. A field that is
omitted must be `optional`; a field that serializes as `null` (like
`CommandSummary.next` and `FunctionInfoResponse.entry`) must not be.

### Adding a command kind

1. Add the variant to `CommandKind` in `crates/optilotus/src/package.rs`.
2. `cargo build -p optilotus` — the compiler reports every non-exhaustive
   match in the engine.
3. `npm run build:bindings` — the generated TS union gains the variant.
4. `npx tsc -b` in `apps/aqualotus-ui` — the compiler reports every UI
   switch that does not handle it.

Step 2 fires first, so the TS can never see a stale union.

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
    `print(fid, template)`, `input(fid, ty)`, `cast(fid, name, to, expr)`,
    `return_(fid, expr)`, `list_commands(fid)`,
    `set_entry(fid, entry?)`, `set_next(fid, cmd, next?)`,
    `delete_command(fid, cmd)`.
  - Branching (`Op::If`, nestable): `eval_cond(fid, expr)` evaluates an
    expression into a hidden `ValueId` for use as a condition;
    `if_(fid, condition, then_body, else_body?)` owns ordered child
    command bodies; `if_with_expr(fid, cond_expr, then_specs, else_specs?)`
    is the frontend-friendly one-call form; `add_raw_command(fid, command)`
    stages body commands outside the main chain.
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
- Resumable run (`run_resumable` module): `RunSession::start(program)`,
  `status()`, `provide_input(value)`, `peek_pending()`, `cancel()`;
  module-level `peek()` and `reset()`.

### Value display

`Value`'s `Display` is the single formatting path for `print` output and
error messages. Floats keep their decimal point on whole values, so a
float is never mistaken for an integer:

| Value | Prints |
|---|---|
| `Int32(2)` | `2` |
| `Float64(2.0)` | `2.0` |
| `Float64(2.5)` | `2.5` |
| `Float32(3.14159)` | `3.14159` |
| `Float64(INFINITY)` | `inf` |
| `Float64(NAN)` | `NaN` |

`f32` and `f64` are formatted separately: widening an `f32` to `f64`
first would expose its binary expansion (`3.14159` →
`3.141590118408203`), so each keeps its own shortest round-trip form.
Pinned by `tests/float_display.rs`.

## Naming rule

Every function in the UI that originates from the Optilotus API layer
carries the `optilotus_` prefix with a **PascalCase** remainder
(`optilotus_runProgram`, `optilotus_listFunctions`), so Optilotus origin
is visible at the call site. This deliberately takes precedence over the
generic camelCase rule (P9/P24) for the bridge boundary.

Rust internals stay `snake_case` as required by the Rust compiler.

> Note: earlier revisions of this file wrote `optilus_` (missing the `t`).
> That prefix does not exist in the codebase; the correct spelling is
> `optilotus_`.

## WASM exports (generated, do not hand-edit)

Built with `npm run build:wasm` into `src/wasm/optilotus/`. Every
response-returning export returns a **JSON string** whose shape is one of
the wire types above.

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
- `optilotus_declareWithAccess(fid, name, ty: string, access: string, init?: string): string`
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

**if-branching** (native types, no JSON — the one exception)
- `optilotus_if(fid, cond_expr: string, then_specs: CommandSpec[], else_specs?: CommandSpec[] | null): number`

`optilotus_if` is the only export that takes and returns native JS values
rather than JSON text: body specs cross as objects and the return is the
new command id. The TypeScript wrapper normalizes this into the same
`{status:"ok", id} | OptilotusError` shape as every other builder, so UI
call sites see one convention.

**Debug**
- `optilotus_debugMode(enable: boolean): void`
- `optilotus_lastError(): string`

## TypeScript bridge (`src/lib/optilotus.ts`)

Single UI entry point. Await `optilotus_tryEnsure()` once; sync wrappers
throw an explicit error before init (P22).

The types are **re-exports of the generated bindings** — this module no
longer declares them, so they cannot drift from the engine:

- `FunctionId`, `CommandId`, `ValueId`, `Access`, `CommandKind`, `CommandSpec`,
  `CommandSummary`, `FunctionInfo`, `FunctionSummary`, `OptilotusType`,
  `Value`, `PendingInput`, `OptilotusError` (the generated `ErrorResponse`),
  `RunOk` (the generated `RunOkResponse`).
- `optilotus_type` keeps its object form for call-site ergonomics
  (`optilotus_type.int32`) and carries `satisfies Record<string,
  OptilotusType>`, so a missing or extra tag is a compile error.
- `RunErr` is `OptilotusError`; `RunResult` is `RunOk | RunErr`.

Call sites never parse JSON — `JSON.parse` exists only inside this module:

- `optilotus_tryEnsure(): Promise<void>` — fallible load (`try_`, P9).
- `optilotus_version(): string`
- `optilotus_health(): string`
- `optilotus_listFunctions(): {status:"ok",functions: FunctionSummary[]}`
- `optilotus_createFunction(name): {status:"ok",id,name,isMain} | OptilotusError`
- `optilotus_getFunction(id): ({status:"ok"} & FunctionInfo) | OptilotusError`
- `optilotus_deleteFunction(id): {status:"ok",deleted} | OptilotusError`
- `optilotus_renameFunction(id, name): {status:"ok",id,name,isMain} | OptilotusError`
- `optilotus_clearPackage(): {status:"ok",cleared}`
- `optilotus_declare(fid, name, ty: OptilotusType, init?): {status:"ok",id} | OptilotusError`
- `optilotus_declareWithAccess(fid, name, ty: OptilotusType, access: Access, init?): {status:"ok",id} | OptilotusError`
- `optilotus_assign(fid, name, expr): {status:"ok",id} | OptilotusError`
- `optilotus_print(fid, template): {status:"ok",id} | OptilotusError`
- `optilotus_input(fid, ty): {status:"ok",id} | OptilotusError`
- `optilotus_cast(fid, name, to, expr): {status:"ok",id} | OptilotusError`
- `optilotus_return(fid, expr): {status:"ok",id} | OptilotusError`
- `optilotus_listCommands(fid): {status:"ok",commands: CommandSummary[]} | OptilotusError`
- `optilotus_setEntry(fid, cmd: number | null): {status:"ok"} | OptilotusError`
- `optilotus_setNext(fid, cmd, next?): {status:"ok"} | OptilotusError`
- `optilotus_deleteCommand(fid, cmd): {status:"ok",deleted} | OptilotusError`
- `optilotus_if(fid, condition, thenBody: CommandSpec[], elseBody?): {status:"ok",id} | OptilotusError`
- `optilotus_runProgram(): RunResult` — runs `main` by id only.
- `optilotus_runProgramWithInputs(inputs: string[]): RunResult`
- `optilotus_runProgramStart(): RunStatus`
- `optilotus_runProgramProvideInput(value): RunStatus`
- `optilotus_runProgramProvideInputs(inputs): RunStatus`
- `optilotus_runProgramProvideInputTyped(value): RunStatus`
- `optilotus_runProgramStatus(): RunStatus | RunIdle`
- `optilotus_peekPendingInput(): PendingInput | RunIdle` — non-consuming
- `optilotus_runProgramCancel(): void`
- `optilotus_runProgramReset(): RunIdle`
- `optilotus_lastError(): OptilotusError | RunIdle`
- `optilotus_debugMode(enable): void`

`CommandSummary` kind `"if"` carries optional `condition`, `then_body`,
`else_body` fields; kind `"declare"` carries an optional `access`
(`public` | `protected` | `private`).

## Package API (the only API)

One package, many functions, permanent `main` (`FunctionId(0)`).
Frontend surface is IDs + typed results:

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
// {status:"ok", steps: 6, prints: 1, printed: ["42"], returned: null}
```

### if-branching

`optilotus_if` creates an `Op::If` in one call. The condition expression
is evaluated into a hidden `ValueId` appended to the main chain; each body
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
optilotus_setNext(0, prevTailId, ifCmd.id);
// or make it the entry: optilotus_setEntry(0, ifCmd.id);
```

`CommandSpec` is a tagged union (generated from Rust, native JS object):

```ts
type CommandSpec = {
  kind: CommandKind;
  var?: string;
  ty?: Type;
  init?: string;
  expr?: string;
  template?: string;
  to?: Type;
};
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
- Delete an if with `optilotus_deleteCommand(fid, ifCmd.id)`; this removes
  the if command but leaves its body commands as orphans (they are no
  longer reachable).

### Resumable run workflow

The resumable API runs `main` with interactive input. One active run at a
time (the WASM bridge holds a single global session).

```ts
const status = optilotus_runProgramStart();
// {status:"waiting_input", command: 5, ty:"int32"}  — paused at an input

const peek = optilotus_peekPendingInput();
// {status:"waiting_input", command: 5, ty:"int32"}  — same, non-consuming

const next = optilotus_runProgramProvideInput("42");
// {status:"ok", steps: 8, prints: 2, printed: [...]}  — finished

optilotus_runProgramCancel();   // discard the active run
optilotus_runProgramReset();    // same as cancel
```

- `optilotus_runProgramStatus()` — poll without providing input.
- `optilotus_runProgramProvideInputs(["1","2"])` — batch; stops at the
  first `waiting_input`.
- `optilotus_runProgramProvideInputTyped('42')` — provide a JSON-encoded
  value matched to the pending command's type.
- `optilotus_lastError()` — the last execution error as a typed object.
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

### Variable access modifiers

`declare` accepts an optional visibility: `public`, `protected` or
`private`. It is recorded on the command summary and surfaced in the UI.

```ts
optilotus_declare(0, "x", optilotus_type.int32, "41");
// defaults to `private`

optilotus_declareWithAccess(0, "y", optilotus_type.int32, "public", "1");
// {status:"ok", id: 3}  — the user-facing head id, not a raw command id

optilotus_listCommands(0);
// {status:"ok", commands: [
//   {id, kind:"declare", var:"y", ty:"int32", access:"public", expr:"1", ...},
// ]}
```

| Modifier | Intended scope | Scope today |
|---|---|---|
| `public` | every package (global) | same as `protected` |
| `protected` | the declaring package | same as `public` |
| `private` | the declaring scope (function, or class once classes exist) | the declaring function — the default |

**Access is recorded and surfaced, but not yet enforced.** There is
exactly one package and there are no classes, so `public` and `protected`
currently mean the same thing (every function is in the same package),
and `private` matches the runtime's existing behaviour: each call gets a
fresh variable scope, so a variable is never visible outside the function
that declares it. The distinction exists so the language has a place for
it; enforcement becomes observable when classes and multiple packages
land.

Rules:
- The default is `private`, which preserves the behaviour of programs
  written before access existed. A summary with no `access` field reads
  as `private`.
- Only `declare` carries access. Every other kind omits the field.
- An unknown modifier is a typed `UnknownAccess` error, never a silent
  fallback to the default.
- A non-default modifier on an **if-body** declare is rejected: a body
  variable is branch-scoped and never appears in `listCommands`, so a
  wider visibility would have nothing to mean yet.
- Access does not affect execution today. `tests/access.rs` pins that
  explicitly, so the test that must change when enforcement lands is
  obvious.

### Package rules

- `create_function("main")` and duplicate names are rejected; `main`
  cannot be deleted; `clear_package()` wipes helpers and re-creates an
  empty `main`.
- `declare` needs an unused name + `optilotus_type` tag; `assign` needs a
  declared name (type is taken from the declaration); `print` takes a
  template; `return` takes an expression and stops the function.
- `list_commands` returns user kinds (`declare` | `assign` | `print` |
  `input` | `cast` | `return` | `if`), never raw `Lit`/`Get`/`Compute`.
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
