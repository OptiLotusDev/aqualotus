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
- `empty_program_json() -> String` — versioned skeleton
  `{"version": 1, "package": "main", "functions": []}` (P18).
- `run_empty_program_json() -> String` — trivial run report JSON.
- `add(left: u64, right: u64) -> u64` — arithmetic helper.

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
- `optilotus_emptyProgram(): string` (versioned JSON)
- `optilotus_runEmpty(): string` (JSON)
- `optilotus_add(a: bigint, b: bigint): bigint`

## TypeScript bridge (`src/lib/optilotus.ts`)

Single UI entry point. Await `optilotus_tryEnsure()` once; sync
wrappers throw an explicit error before init (P22):

- `optilotus_tryEnsure(): Promise<void>` — fallible load (`try_`, P9).
- `optilotus_version(): string`
- `optilotus_health(): string`
- `optilotus_emptyProgram(): string`
- `optilotus_runEmpty(): string`
- `optilotus_add(a: number, b: number): number`

## UI state

- `useOptilotus(): OptilotusStatus` (`src/hooks/useOptilotus.ts`) —
  readonly snapshot for `OptilotusPanel`.
- `useIsMobile(): boolean` — viewport/nativeshell layout switch.
- `hasCapacitorBridge(value: unknown)` / `isNativeMobile(value: unknown)`
  (`src/hooks/capacitorBridge.ts`) — pure predicates, tested with
  `npm run test:ui` (P6).
