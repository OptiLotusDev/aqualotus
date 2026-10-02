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
- `run_function_json(input: &str) -> String` — execute one serialized
  `Function`, return the run-report JSON (never throws; see below).
- Session API (no IR assembly required; one explicitly-owned session per
  loaded module, reset with `session_clear`):
  - `session_set(name, ty, text) -> String` — declare/assign a variable.
  - `session_get(name) -> String` — read a variable.
  - `session_exec_math(expr) -> String` — maths expression string.
  - `session_print(template) -> String` — print template string.
  - `session_clear() -> String` — drop all session variables.

Naming rule: every function in the UI that originates from the Optilotus
API layer carries the `optilotus_` prefix with a camelCase remainder
(e.g. `optilotus_emptyProgram`), so Optilotus origin is visible at the
call site. This deliberately takes precedence over the generic camelCase
rule (P9/P24) for the bridge boundary. Rust internals stay `snake_case`
as required by the Rust compiler.

## WASM exports (generated, do not hand-edit)

Built with `npm run build:wasm` into `src/wasm/optilotus/`:

- `optilotus_version(): string`
- `optilotus_health(): string`
- `optilotus_runFunction(functionJson: string): string` (JSON report)
- `optilotus_set(name: string, ty: string, value: string): string` (JSON)
- `optilotus_get(name: string): string` (JSON)
- `optilotus_execMath(expr: string): string` (JSON)
- `optilotus_print(template: string): string` (JSON)
- `optilotus_clear(): string` (JSON)

## TypeScript bridge (`src/lib/optilotus.ts`)

Single UI entry point. Await `optilotus_tryEnsure()` once; sync
wrappers throw an explicit error before init (P22):

- `optilotus_tryEnsure(): Promise<void>` — fallible load (`try_`, P9).
- `optilotus_version(): string`
- `optilotus_health(): string`
- `optilotus_runFunction(functionJson: string): string` — run report JSON.
- `optilotus_set(name: string, ty: string, value: string): string`
- `optilotus_get(name: string): string`
- `optilotus_execMath(expr: string): string`
- `optilotus_print(template: string): string`
- `optilotus_clear(): string`

## Session API (start here)

No IR assembly required — plain strings in, JSON out. One session per
loaded module holds the variables; every call returns a JSON string
(parse it, don't string-match it). All five share the error envelope
`{"status":"error","kind","command":null,"message",...}` (`command` is
always null here — no block ran; `kind` is one of `ExprError`,
`UnknownVariable`, `TypeMismatch`, `Overflow`, `DivByZero`).

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
- Maths and templates share the expression language documented under
  "Running functions" below (`{variables}`, operators, precedence).
- `clear` resets the session — call it when starting a fresh user flow
  so stale variables can't leak in.

## Running functions (full-program path)

Prefer the Session API above unless you need multi-command control flow
(`entry`/`next` chains). Input is one serialized `Function`:

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

Ops (maths is always a `Compute` expression string — there are no
`Add`/`Sub`/`Mul`/`Div`/`Mod` commands):

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
  `+ - * / %`, parentheses, unary minus, numbers, `{variables}`.
  Integer literals adopt a combined variable's type (`{int8var} + 2`
  works); variable-vs-variable stays strict same-type-only.

Success report:

```json
{"status": "ok", "steps": 4, "prints": 1, "printed": ["Hello Bob AAA"]}
```

Error report (`command` is the offending block id, `null` for
`LoopLimit`; `kind` is one of `ParseError`, `TypeMismatch`, `Overflow`,
`DivByZero`, `MissingValue`, `Arity`, `UnknownCommand`, `LoopLimit`,
`UnknownVariable`, `ExprError`):

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
