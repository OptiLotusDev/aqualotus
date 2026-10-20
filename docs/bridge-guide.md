# Bridge Development Guide (P5)

Task-oriented guide for changing the UI ↔ engine boundary. `api.md`
documents *what* the interface is; this file documents *how to change it*
safely.

Read `api.md` first if you have not. The short version:

```
crates/optilotus/src/wire.rs          the wire format (declared once)
        │  ts-rs, feature `ts-bindings`
        ▼
src/wasm/optilotus/bindings/          generated TS types (git-ignored)
        │  re-exported by
        ▼
src/lib/optilotus.ts                  typed wrappers (UI entry point)
```

## The one rule

**Never declare a boundary type twice.** If a shape crosses the bridge,
it is declared in Rust and generated into TypeScript. Hand-writing a
matching TS type is what let the two drift apart in the past — the
engine grew `cast` and `if` while the UI types stayed at four command
kinds, and the mismatch was invisible until something broke.

## Recipes

### Add a command kind

Worked example: adding `CommandKind::Loop`.

1. **Add the variant** in `crates/optilotus/src/package.rs`:

   ```rust
   pub enum CommandKind {
       Declare, Assign, Print, Input, Cast, Return, If,
       Loop,   // new
   }
   ```

2. **Build the engine.** The compiler lists every non-exhaustive match:

   ```bash
   cargo build -p optilotus
   # error[E0004]: non-exhaustive patterns: `CommandKind::Loop` not covered
   ```

   Handle each one. This is the important step: the engine refuses to
   compile until every match is updated, so the TS can never see a
   half-migrated union.

3. **Regenerate the bindings** (also rebuilds WASM):

   ```bash
   cd apps/aqualotus-ui && npm run build:wasm:all
   ```

   `bindings/CommandKind.ts` now includes `"loop"`.

4. **Typecheck the UI.** Every `switch` on a command kind that does not
   handle `loop` is now an error:

   ```bash
   npx tsc -b
   ```

   The UI has six such switches: `summaryToDraft`, `commandMainLine`,
   `commandSubLine`, `commandDraftEqual`, `runBuilder`, and `KindFields`.
   Each needs a real case, not a `default` that silently does nothing.

5. **Add tests.** At minimum, one engine test that the new kind builds and
   runs, and one UI test that its draft round-trips through
   `summaryToDraft` (that function is the undo path — a kind missing from
   it silently loses the user's block on undo).

### Change a response shape

1. **Edit the type** in `crates/optilotus/src/wire.rs`.
2. **Update `tests/wire_format.rs`**, which pins the exact JSON of every
   envelope. If your change is intentional, update the expectation; if
   the test fails unexpectedly, you changed the contract by accident.
3. **Check compatibility.** Adding an optional field is fine. Removing or
   renaming a field is a break — see below.
4. Regenerate and typecheck as above.

### Add a new response type

1. Declare it in `wire.rs` with the standard derives:

   ```rust
   #[derive(Debug, Clone, Serialize)]
   #[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
   #[cfg_attr(feature = "ts-bindings", ts(export))]
   #[serde(rename_all = "camelCase")]
   pub struct MyResponse {
       #[cfg_attr(feature = "ts-bindings", ts(type = "\"ok\""))]
       pub status: &'static str,
       pub thing: u32,
   }
   ```

   The `ts(export)` attribute is what generates the binding. The
   `ts(type = "\"ok\"")` on `status` is what makes the generated TS a
   discriminated union that narrows.

2. Return it from the bridge via `to_json(&response)`.
3. Regenerate, typecheck, and add a `wire_format.rs` case.

### Add a variable access modifier

Access levels are a closed set (`public`/`protected`/`private`), so this
is rarer than adding a command kind. The pattern:

1. Add the variant to `Access` in `crates/optilotus/src/package.rs`.
2. Update `Access::parse_tag` and `Access::tag` — the compiler will not
   force this, so both need a deliberate edit.
3. Regenerate and typecheck. The generated `Access` union gains the
   variant, and any UI `switch` over it must handle it.
4. Decide whether the new level is enforceable. If not, document it as
   recorded-but-not-enforced in `docs/api.md` rather than implying
   behaviour that does not exist.

Note the current state: access is **stored and surfaced but not
enforced**, because there is one package and no classes. `tests/access.rs`
pins `access_does_not_change_execution` so the test that must change when
enforcement lands is obvious.

## Compatibility (P18)

The wire format is a stable interface. **Serialized output may grow but
must not shrink.**

| Change | Allowed? |
|---|---|
| Add an optional field | Yes — additive |
| Add a new response type | Yes |
| Add a variant to an enum the UI switches on | Yes, but the UI must handle it |
| Remove a field | **No** — breaks consumers |
| Rename a field | **No** — breaks consumers |
| Change a field's meaning or type | **No** — version it instead |

Two tests enforce this:

- `tests/wire_compat.rs` — pins the field set per error kind, written
  from the pre-refactor source.
- `tests/wire_compat_mechanical.rs` — extracts the old field set from git
  history and asserts the current envelope is a superset.

If you must break compatibility, treat it as a deliberate architectural
change: version the format and provide a migration.

## Pitfalls

These are real mistakes made while building this boundary. Each one
shipped past a green test suite at least once.

### `optional` is not `| null`

`#[serde(skip_serializing_if = "Option::is_none")]` **omits** a field.
The generated TS must then be `field?: T`, which needs `#[ts(optional)]`.
Without it you get `field: T | null`, and `"field" in obj` behaves
differently.

A field with no `skip_serializing_if` genuinely serializes as `null`
(`CommandSummary.next`, `FunctionInfoResponse.entry`) and must **not** be
marked optional.

### `bigint` breaks JSON

`i64`/`u64`/`i128`/`u128` generate as `bigint` by default, which
`JSON.parse` cannot produce. `.cargo/config.toml` sets
`TS_RS_LARGE_INT = "number"`. Do not remove it.

### `export_to` resolves against the crate, not the repo root

Per-attribute `export_to = "../../apps/..."` resolves against
`CARGO_MANIFEST_DIR` (`crates/optilotus/`) and creates stray directories
like `crates/apps/`. The output path is configured once in
`.cargo/config.toml` via `TS_RS_EXPORT_DIR`. Use bare `ts(export)`.

### `ts-rs` must stay an optional dependency

It is behind the `ts-bindings` feature so the codegen tool never enters
the shipped wasm binary (P11/P12). Verify with:

```bash
cargo tree -p optilotus --target wasm32-unknown-unknown -e normal | grep ts-rs
# must print nothing
```

### Tests that assert your assumption are not tests

When refactoring the wire format, the first attempt at "prove it is
byte-for-byte compatible" wrote expectations from the *new* code and
passed — while the output had actually lost five fields. Extract the old
behaviour from git history (`git show <rev>:path`) and assert against
that. A test that encodes your belief proves only that you are
consistent.

## Verifying a boundary change

```bash
# engine
cargo test -p optilotus

# bindings + wasm
cd apps/aqualotus-ui && npm run build:wasm:all

# UI
npx tsc -b && npm run lint && npx vitest run

# full production build (from a clean tree, to catch missing generation)
rm -rf src/wasm && npm run build
```

The last one matters: `src/wasm/` is git-ignored, so a fresh clone has no
bindings until a build generates them. If a build path forgets to run
`build:bindings`, only a clean-tree build will catch it.
