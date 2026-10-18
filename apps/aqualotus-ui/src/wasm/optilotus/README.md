# Optilotus

A small, headless, deterministic programming language and runtime.

Optilotus has no UI dependencies. The same core compiles to WASM for the
web and to a native library for desktop/mobile.

## Architecture

```text
Program IR ──▶ Validation ──▶ Scheduler ──▶ Runtime
```

The IR is the single source of truth. The editor (Aqualotus) is a
projection; it never owns program semantics.

## Module layout

| Module | Responsibility |
|--------|---------------|
| `bridge` | UI/runtime boundary (version, health, JSON helpers, WASM exports) |
| `types` | Scalar type tags (`Type` enum, parsing) |
| `value` | Runtime values (`Value` enum, one variant per type) |
| `ir` | Authoritative program model (`Program`/`Function`/`Command`, `entry`/`next`) |
| `ops` | Primitive operations (`Op` enum) and pure arithmetic helpers |
| `expr` | Expression/template mini-language (compute, print templates) |
| `exec` | Sequential executor over `next` edges |
| `sink` | Explicit effect boundary for `Print` |
| `error` | Typed execution failures with source identity |
| `package` | Owned single-package registry (many functions, stable `main`) |

## Expression language

Expressions use `{variable}` references and support `+ - * / %` with
standard precedence, parentheses, and unary minus. Integer literals are
untyped until combined with a typed value, which they adopt (checked).
Variable-vs-variable operations are strict same-type-only.

### Print templates

Print templates are quoted strings with `{variable}` interpolation. When a
template is a single quoted string that forms a valid arithmetic expression
after interpolation, the expression is evaluated and the result is printed:

```rust
// x = 10, y = 5
print("\"{x} + {y}\"");  // prints "15", not "10 + 5"
```

If the interpolated string is not a valid expression (e.g. `"Sum: {x} + {y}"`),
the literal interpolated string is printed.

## Example

```rust
use optilotus::{Package, VecSink, MAIN_ID};

let mut pkg = Package::new();
pkg.declare(MAIN_ID, "x", "int32", Some("10")).unwrap();
pkg.declare(MAIN_ID, "y", "int32", Some("5")).unwrap();
pkg.declare(MAIN_ID, "z", "int32", None).unwrap();
pkg.assign(MAIN_ID, "z", "{x} + {y}").unwrap();
pkg.print(MAIN_ID, "\"{z}\"").unwrap();

let mut sink = VecSink::default();
pkg.run_main(&mut sink).unwrap();
assert_eq!(sink.lines, vec!["15".to_string()]);
```

## Testing

```bash
export RUST_MIN_STACK=8388608
cargo test -p optilotus
```

All tests run headless with no UI dependencies.
