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
    `delete_function(id)` (`main` protected), `clear_package()`.
  - Command builders (expand onto existing IR; `return` is `Op::Return`):
    `declare(fid, name, ty, init?)`, `assign(fid, name, expr)`,
    `print(fid, template)`, `return_(fid, expr)`, `list_commands(fid)`,
    `set_entry(fid, entry?)`, `set_next(fid, cmd, next?)`,
    `delete_command(fid, cmd)`.
  - `run_main(sink)` / `run_main_with_limit(sink, limit)` — runs `main`
    by id only, with `name()` calls + `Return` shared over one step budget.
- `run_function_json(input: &str) -> String` — legacy single-function path
  (obsolete as primary; prefer `run_program()` below).
- `run_program() -> String` — runs `main` by id only, no JSON input.
  Same JSON envelope as `run_function_json`, built inside the bridge.
- Session API (no IR assembly required; one explicitly-owned session per
  loaded module, reset with `session_clear`):
  - `session_set(name, ty, text) -> String` — declare/assign a variable.
  - `session_get(name) -> String` — read a variable.
  - `session_exec_math(expr) -> String` — maths expression string.
  - `session_print(template) -> String` — print template string.
  - `session_clear() -> String` — drop all session variables.

Naming rule: every function in the UI that originates from the Optilotus
API layer carries the `optilotus_` prefix with a camelCase remainder
(e.g. `optilotus_runProgram`), so Optilotus origin is visible at the
call site. This deliberately takes precedence over the generic camelCase
rule (P9/P24) for the bridge boundary. Rust internals stay `snake_case`
as required by the Rust compiler.

## WASM exports (generated, do not hand-edit)

Built with `npm run build:wasm` into `src/wasm/optilotus/`:

- `optilotus_version(): string`
- `optilotus_health(): string`
- `optilotus_runFunction(functionJson: string): string` (legacy JSON report;
  obsolete as primary — prefer `optilotus_runProgram()`)
- `optilotus_runProgram(): string` (JSON report, no JSON input)
- `optilotus_listFunctions(): string`
- `optilotus_createFunction(name: string): string`
- `optilotus_getFunction(id: number): string`
- `optilotus_deleteFunction(id: number): string`
- `optilotus_clearPackage(): string`
- `optilotus_declare(fid: number, name: string, ty: string, init?: string): string`
- `optilotus_assign(fid: number, name: string, expr: string): string`
- `optilotus_printCommand(fid: number, template: string): string`
- `optilotus_return(fid: number, expr: string): string`
- `optilotus_listCommands(fid: number): string`
- `optilotus_setEntry(fid: number, cmd: number): string`
- `optilotus_setNext(fid: number, cmd: number, next?: number): string`
- `optilotus_deleteCommand(fid: number, cmd: number): string`
- `optilotus_set(name: string, ty: string, value: string): string` (JSON)
- `optilotus_get(name: string): string` (JSON)
- `optilotus_execMath(expr: string): string` (JSON)
- `optilotus_print(template: string): string` (JSON)
- `optilotus_clear(): string` (JSON)

## TypeScript bridge (`src/lib/optilotus.ts`)

Single UI entry point. Await `optilotus_tryEnsure()` once; sync
wrappers throw an explicit error before init (P22). Package wrappers are
typed (JSON is parsed once inside); UI call sites never build or pass IR
JSON:

- `optilotus_tryEnsure(): Promise<void>` — fallible load (`try_`, P9).
- `optilotus_version(): string`
- `optilotus_health(): string`
- Types: `FunctionId`, `CommandId`, `FunctionSummary`, `FunctionInfo`,
  `CommandSummary`, `RunResult` (`RunOk | RunErr`), `OptilotusError`.
- `optilotus_listFunctions(): {status:"ok",functions: FunctionSummary[]}`
- `optilotus_createFunction(name): {status:"ok",id,name,is_main} | OptilotusError`
- `optilotus_getFunction(id): ({status:"ok"} & FunctionInfo) | OptilotusError`
- `optilotus_deleteFunction(id): {status:"ok",deleted} | OptilotusError`
- `optilotus_clearPackage(): {status:"ok",cleared}`
- `optilotus_declare(fid, name, ty, init?): {status:"ok",id} | OptilotusError`
- `optilotus_assign(fid, name, expr): {status:"ok",id} | OptilotusError`
- `optilotus_printCommand(fid, template): {status:"ok",id} | OptilotusError`
- `optilotus_return(fid, expr): {status:"ok",id} | OptilotusError`
- `optilotus_listCommands(fid): {status:"ok",commands: CommandSummary[]} | OptilotusError`
- `optilotus_setEntry(fid, cmd): {status:"ok"} | OptilotusError`
- `optilotus_setNext(fid, cmd, next?): {status:"ok"} | OptilotusError`
- `optilotus_deleteCommand(fid, cmd): {status:"ok",deleted} | OptilotusError`
- `optilotus_runProgram(): RunResult` — runs `main` by id only.
- Legacy: `optilotus_runFunction(functionJson: string): string`,
  `optilotus_set/get/execMath/print/clear(): string` (JSON strings).

## Package API (start here)

One package, many functions, permanent `main` (`FunctionId(0)`).
Frontend surface is IDs + typed results; JSON never leaves the bridge:

```ts
const { functions } = optilotus_listFunctions();
// [{id: 0, name: "main", is_main: true}]

const created = optilotus_createFunction("helper");
// {status:"ok", id: 1, name: "helper", is_main: false}

optilotus_declare(0, "n", "int32", "41");
optilotus_assign(0, "n", "{n} + 1");
optilotus_printCommand(0, '"{n}"');

optilotus_listCommands(0);
// {status:"ok", commands: [
//   {id, kind:"declare", var:"n", ty:"int32", expr:"41"},
//   {id, kind:"assign", var:"n", expr:"{n} + 1"},
//   {id, kind:"print", template:'"{n}"'},
// ]}

const result: RunResult = optilotus_runProgram();
// {status:"ok", steps: 6, prints: 1, printed: ["42"]}
```

- `create_function("main")` and duplicate names are rejected; `main`
  cannot be deleted; `clear_package()` wipes helpers and re-creates an
  empty `main`.
- `declare` needs an unused name + lowercase `ty` tag; `assign` needs a
  declared name (type is taken from the declaration); `print` takes a
  template; `return` takes an expression and stops the function.
- `list_commands` returns user kinds (`declare` | `assign` | `print` |
  `return`), never raw `Lit`/`Get`/`Compute`.
- Calls live in expression text: `helper()` runs the helper with fresh
  variables, shared steps/prints, and uses its `Return` value. Unknown
  names are `UnknownFunction`, missing `Return` is `MissingReturn`,
  calling `main` is an expression error, recursion hits `LoopLimit`.
- Errors are typed: `PackageError` for CRUD/builders (`command` set for
  `UnknownCommand`), execution failures carry the offending `command`
  (`null` for `LoopLimit`).

## Session API (easy single-operation path)

No IR assembly required — plain strings in, JSON out. One session per
loaded module holds the variables; every call returns a JSON string
(parse it, don't string-match it). All five share the error envelope
`{"status":"error","kind","command":null,"message",...}` (`command` is
always null here — no block ran; `kind` is one of `ExprError`,
`UnknownVariable`, `TypeMismatch`, `Overflow`, `DivByZero`,
`UnknownFunction`, `MissingReturn`).

```ts
optilotus_set("n", "int32", "3");
// {"status":"ok","var":"n","type":"int32"}

optilotus_execMath("({n} + 4) % 2");
// {"status":"ok","value":{"Int32":1},"type":"int32","display":"1"}

optilotus_set("name", "string", "Bob");
optilotus_print('"Hello {name}" + " AAA"');
// {"status":"ok","printed":"Hello Bob AAA"}

optilotus_get("n");
// {"status":"ok","value":{"Int32":3},"type":"int32","display":"3"}

optilotus_clear();
// {"status":"ok","cleared":2}
```

- `ty` is a lowercase tag (`int8`…`uint128`, `float32`, `float64`,
  `bool`, `char`, `string`). Unknown tags are an error naming the fix.
- The value text is parsed into `ty` (`string` kept verbatim,
  `" 41 "` trims for numerics). Out-of-range integers are `Overflow`,
  malformed text names the expected shape.
- `set` enforces the declared type and freezes it: re-declaring `n`
  as another type is `TypeMismatch`. Same type re-assigns.
- `clear` resets the session — call it when starting a fresh user flow
  so stale variables can't leak in.

## Running functions (legacy full-program path, obsolete as primary)

Prefer the Package API above (`optilotus_runProgram()` runs `main` by id
only). The old path below passes a serialized `Function` and remains
only for compatibility:

```json
{
  "id": 1,
  "name": "main",
  "entry": 1,
  "commands": [
    {"id": 1, "op": {"Lit": {"String": "Bob"}}, "inputs": [], "outputs": [1], "next": 2},
    {"id": 2, "op": {"Set": {"var": "name", "ty": "string"}}, "inputs": [1], "outputs": [], "next": 3},
    {"id": 3, "op": {"Compute": {"expr": "({n} + 4) % 2"}}, "inputs": [], "outputs": [2], "next": 4},
    {"id": 4, "op": "Print", "inputs": [2], "outputs": [], "next": null}
  ]
}
```

Ops (maths is usually a `Compute` expression string — there are no
`Add`/`Sub`/`Mul`/`Div`/`Mod` commands; `Return` evaluates an expression
and stops with a value for callers):

- `{"Lit": <value>}` — constant. Values use tagged shapes:
  `{"Int32": 41}`, `{"String": "hi"}`, `{"Bool": true}`, `"Void"`.
  Type tags in `Set` are lowercase: `"ty": "string"`.
- `"Print"` — 1 input, 0 outputs. `String` inputs are templates:
  quoted literals joined by `+` with `{variable}` interpolation
  (`"\"Hello {name}\" + \" AAA\""`); other values print as-is.
- `{"Set": {"var": "<name>", "ty": "<Tag>"}}` — 1 input, 0 outputs.
  Declares/assigns a function-scoped variable; the value must match `ty`.
- `{"Get": {"var": "<name>"}}` — 0 inputs, 1 output. Inline variable read.
- `{"Compute": {"expr": "<expression>"}}` — 0 inputs, 1 output.
  `+ - * / %`, parentheses, unary minus, numbers, `{variables}`,
  `"string"` literals, `name()` zero-arg calls.
  Integer literals adopt a combined variable's type (`{int8var} + 2`
  works); variable-vs-variable stays strict same-type-only.
- `{"Return": {"expr": "<expression>"}}` — 0 inputs, 0 outputs.
  Same expression language as `Compute`; stops the function with the value.

Success report:

```json
{"status": "ok", "steps": 4, "prints": 1, "printed": ["Hello Bob AAA"]}
```

Error report (`command` is the offending block id, `null` for
`LoopLimit`; `kind` is one of `ParseError`, `TypeMismatch`, `Overflow`,
`DivByZero`, `MissingValue`, `Arity`, `UnknownCommand`, `LoopLimit`,
`UnknownVariable`, `ExprError`, `UnknownFunction`, `MissingReturn`):

```json
{"status": "error", "kind": "UnknownVariable", "command": 1, "var": "ghost", "message": "unknown variable \"ghost\" at 1"}
```

Variables live for one run only — each call starts with an empty scope.

## UI state

- `useOptilotus(): OptilotusStatus` (`src/hooks/useOptilotus.ts`) —
  readonly snapshot for `OptilotusPanel`.
- `useIsMobile(): boolean` — viewport/nativeshell layout switch.
- `hasCapacitorBridge(value: unknown)` / `isNativeMobile(value: unknown)`
  (`src/hooks/capacitorBridge.ts`) — pure predicates, tested with
  `npm run test:ui` (P6).
