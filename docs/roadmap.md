# Aqualotus Development Roadmap

**Status:** Living engineering specification  
**Audience:** Human developers and AI agents  
**Last updated:** 2026-09-25

This document is the authoritative development roadmap and architectural guide for Aqualotus / Optilotus. It distinguishes **locked architectural decisions** from **implementation details that may evolve**.

The separate **Design Principles** document remains in force and must be treated as mandatory context alongside this roadmap.

---

## 1. Project Definition

**Aqualotus** is the application layer (visual editor, project management, platform integration).  
**Optilotus** is the language, intermediate representation, validation, and runtime.

Aqualotus provides the environment in which users create, edit, inspect, and execute Optilotus programs. Optilotus remains fully usable without Aqualotus.

### Core Goals

- Visual programming without traditional text syntax
- Packages, structs, and functions as the initial language surface
- Functions expressed as ordered lists of command blocks
- Headless runtime with predictable execution semantics
- Explicit separation of editor, program model, validation, and execution
- Controlled concurrent execution where dependencies and ownership permit it (introduced later)
- Stable, versioned project format independent of internal implementation
- Codebase maintainable by both humans and AI agents
- Required shipping targets: **Web, Desktop, and Mobile**

### Non-Goals (for the graduation scope)

- Full traditional object-oriented class system in early phases
- Highly sophisticated layout or collaboration features
- Running arbitrary external Rust programs from the editor (may be explored later)

---

## 2. Architectural Invariants

These rules are **locked**. They may only be changed deliberately, with explicit updates to this document.

1. The runtime must not depend on the UI.
2. Optilotus owns the authoritative program representation (the IR). The canonical definition of the IR lives in Rust.
3. Aqualotus is a projection of the IR; it is never the source of truth.
4. Mutable state must have a single authoritative owner. Other components may receive immutable views or explicitly synchronized access; they must not perform uncontrolled shared mutation.
5. Honest functions must not depend on hidden mutable state or perform undeclared effects.
6. External effects must cross explicit boundaries.
7. Where deterministic behaviour is required, execution must not depend on accidental ordering or scheduling.
8. Presentation data (position, color, layout, selection) must not affect program semantics.
9. Program entities must have stable identity independent of their names.
10. Serialized project data represents the program model, not internal runtime or editor structures.
11. Dependencies flow toward lower-level systems; the runtime never depends on React, React Flow, Tauri, or any UI technology.
12. One Optilotus implementation serves all deployment targets.
13. AI agents and human developers must preserve these invariants.

---

## 3. System Architecture

### High-level view

```
Aqualotus
TypeScript / React
       │
       │ explicit interface only
       ▼
Optilotus API
       │
       ▼
Optilotus Core (Rust)
```

### Core internals

```
Program IR
    │
    ▼
Validation
    │
    ▼
Scheduler
    │
    ▼
Runtime
```

### Deployment view

```
              One Optilotus (Rust)
                       │
         ┌─────────────┼─────────────┐
         │             │             │
     Native API    Native API     WASM API
         │             │             │
      Desktop        Mobile          Web
```

**Locked decision:** There is a single Optilotus implementation. Platform differences appear only at the deployment interface, never inside language semantics or the core runtime.

**Implementation detail (allowed to evolve):** The concrete mobile wrapper is not part of the architectural specification.

### Source-of-truth hierarchy

```
                Program IR (authoritative)
                       │
          ┌────────────┴────────────┐
          │                         │
   Serialized project data    Aqualotus view
          │                         │
          └────────────┬────────────┘
                       │
                    Runtime
```

**Rule:** If UI state, serialized data, and runtime state disagree, the Program IR is authoritative.

---

## 4. Foundation Models

These four models are defined in Phase 0 and treated as stable contracts.

### 4.1 Program Model

```
Package
 ├── Struct*
 └── Function*
      └── Command[]   (ordered list)
```

- A **Package** is a namespace and spatial container.
- A **Struct** defines data shape (fields). Users may create and extend structs.
- A **Function** is an ordered sequence of commands.
- **Classes** are deferred; they are language ergonomics built on top of the above.

**Locked:** Packages, Structs, and Functions form the initial language surface.  
**Evolvable:** Exact field lists, nesting rules, and visibility semantics.

### 4.2 Value & Data Model

Commands communicate exclusively through explicit values identified by `ValueId`.

```
Command
 ├── inputs:  ValueId[]
 ├── operation
 └── outputs: ValueId[]
```

Rules (locked):

- Commands consume explicit values and produce explicit values.
- No command may secretly read values produced by another command.
- No implicit stack or hidden data-flow between commands.
- Commands may only access state through explicitly declared inputs, owned state, or declared effect contexts.
- The visual editor may provide sugar; the IR always uses explicit `ValueId`s.

This model directly enables later dependency-graph scheduling.

### 4.3 Identity Model

Every significant entity has a stable identity independent of its name:

- `PackageId`
- `StructId`
- `FunctionId`
- `CommandId`
- `ValueId`

**Locked rules:**

- Names are human-readable properties, not identity.
- Renaming must not change identity.
- Copying that represents “new entity” must allocate new IDs; in-place modification preserves IDs.
- All references (including error locations) use IDs.

### 4.4 Error Model

All expected failures are represented as explicit, typed errors that carry source identity sufficient to map back to a visual block.

Suggested categories:

- `ParseError`
- `ValidationError`
- `TypeError`
- `ReferenceError`
- `ExecutionError`
- `SerializationError`
- `InterfaceError`

**Locked rules:**

- Expected program or user errors must never cause an uncontrolled panic.
- Errors must contain enough identity information (`FunctionId`, `CommandId`, etc.) for Aqualotus to highlight the corresponding visual element.
- Recoverable failures are communicated through `Result`-style typed errors (or language equivalent). `Option` is used only when absence is a valid non-error result.
- Recoverable failure follows the project `try_` convention defined in the Design Principles document. `must_` functions are not used.

---

## 5. Command Model

A command is the atomic unit of execution.

**Semantic rules (locked):**

- Explicit inputs and outputs via `ValueId`
- Commands may only access state through explicitly declared inputs, owned state, or declared effect contexts
- Pure commands are deterministic given the same inputs and immutable context
- Effects are declared and cross explicit boundaries

**Distinction (locked early):**

- **Pure commands** — no side effects; result depends only on inputs and immutable context
- **Effectful commands** — may perform I/O, mutate owned state, etc.; they are not assumed to produce identical external outcomes

**Determinism policy:**  
Determinism applies to pure commands and to those parts of execution semantics where deterministic behaviour is required. Effectful operations explicitly declare their effects and are not assumed to be globally deterministic.

**Implementation detail (evolvable):** Exact Rust struct layout, argument encoding, and the concrete set of primitive commands.

The initial set of primitive commands should be kept deliberately small (target ≤ 15 for the first vertical slice).

---

## 6. Execution Model

### 6.1 Sequential Execution (Phase 1)

```
Function = ordered list of commands
                ↓
        Sequential scheduler
                ↓
             Runtime
```

- Predictable and easy to test
- Single-threaded for the first milestone

### 6.2 Future Dependency Scheduling

Later evolution:

```
Ordered command sequence
        ↓
Dependency analysis (from ValueId uses)
        ↓
Execution graph
        ↓
Scheduler (may run independent subgraphs concurrently)
```

**Locked intent:** The authoring representation remains an ordered list. The runtime may derive a richer execution graph. Concurrency must never introduce observable non-determinism into code that is required to be deterministic.

---

## 7. Serialization

Serialization is a **representation** of the Optilotus IR, not an architectural layer.

**Locked rules:**

- The serialized form is a stable, versioned contract.
- Internal runtime or editor structures must not leak into the format.
- Format changes require an explicit version bump and migration path when compatibility is required.

**Implementation detail:** Choice of binary (e.g. Postcard) vs human-readable (JSON) encodings, compression, etc.

---

## 8. Technology & Platform Strategy

| Concern               | Direction                                     | Status        |
| --------------------- | --------------------------------------------- | ------------- |
| UI                    | TypeScript + React                            | Preferred     |
| Visual editing        | React Flow (or successor)                     | Preferred     |
| Core language/runtime | Rust compiled to WASM (+ native where useful) | Locked        |
| Desktop               | Tauri 2                                       | Preferred     |
| Web                   | Same React application                        | Locked        |
| Mobile                | Same frontend + Optilotus; wrapper is detail  | Locked intent |
| Styling               | Tailwind + accessible component library       | Preferred     |

**Locked:** UI in TypeScript, logic in Rust, one Optilotus implementation, three mandatory shipping targets (Web, Desktop, Mobile).  
**Canonical IR:** Defined in Rust. TypeScript holds corresponding API types that are derived or generated from the Rust definition where practical. Two independent definitions of the IR must not exist.  
**Evolvable:** Exact libraries inside the TypeScript UI, concrete mobile wrapper, state-management library, etc.

---

## 9. Development Principles

The full set of engineering principles lives in the separate Design Principles document `design-guide.md`. The most critical ones for day-to-day work are:

- Honest functions wherever feasible
- Explicit ownership of mutable state (authoritative owner + immutable views or synchronized access)
- Dependency direction toward lower layers
- Headless runtime
- Explicit effect boundaries
- Stable identity
- Presentation does not define semantics
- Validate before execution
- Fail explicitly
- Prefer existing project conventions over generic framework conventions
- Recoverable failure follows the `try_` convention; `must_` is not used

---

## 10. Agent Development Rules

AI agents modifying the project **must**:

1. Identify the relevant architectural boundary before changing code.
2. Treat the Optilotus IR (defined in Rust) as the source of truth.
3. Respect stable IDs and the error model.
4. Prefer extending existing interfaces over inventing parallel ones.
5. Keep pure and effectful commands distinct.
6. Never introduce hidden mutable state or undeclared effects.
7. Update tests and documentation when changing contracts.
8. Refuse to silently bypass an invariant; if a change requires an architectural exception, the specification must be updated deliberately.

### Agents must not

- Introduce a second source of truth for program semantics
- Put language semantics into React components
- Make Optilotus depend on Aqualotus
- Bypass validation to make the UI work
- Encode editor layout into the semantic IR
- Introduce global mutable state as a shortcut
- Silently change a locked invariant
- Duplicate the runtime or IR semantics in TypeScript

Agents should be given this roadmap + the Design Principles document as mandatory context for any non-trivial task.

---

## 11. Phased Roadmap

### Phase 0 — Foundations
**Goal:** Lock the semantic contracts and the rules of the codebase.

Deliverables:
- Program model, Value & Data model, Identity model, Error model written down
- Canonical IR schema defined in Rust; TypeScript API types derived or generated where practical
- Repository structure, module boundaries, and dependency direction
- Naming, error, and testing conventions established
- CI skeleton
- Agent context pack (this document + Design Principles)

**Exit criteria:** The four foundation models are documented and agreed; codebase conventions are in place.

### Phase 1 — Headless Vertical Slice
**Goal:** Prove Optilotus is independent of Aqualotus.

```
Program definition
      ↓
Optilotus IR
      ↓
serialize
      ↓
deserialize
      ↓
validate
      ↓
execute (sequential scheduler)
      ↓
predictable result
```

No React, no React Flow, no Tauri, no mobile wrapper.

Deliverables:
- Working IR (Rust)
- Serialization round-trip
- Basic validation
- Sequential scheduler
- Minimal set of pure + effectful primitive commands
- Headless test suite

**Exit criteria:** A program can be defined in IR, written to disk, read back, validated, executed, and produces a predictable result with zero UI code involved.

### Phase 2 — Minimal Visual Editor
**Goal:** Bidirectional projection between IR and a usable editor.

- Packages, structs, and functions visible and editable
- Functions shown as ordered command lists (Scratch-like)
- Explicit ValueId model under the hood; visual sugar on top
- Run / inspect / “see the code behind”
- Save / load via the stable serialization format
- Errors mapped back to visual blocks via stable IDs

**Exit criteria:** A user can create a small program entirely in the UI, save it, reload it, and execute it correctly.

### Phase 3 — Language Depth & Platforms
**Goal:** Make the language useful and ship on all three targets.

- Richer primitive commands and struct capabilities
- Function calls (including across packages)
- Desktop shell (Tauri)
- Mobile deployment (same frontend + Optilotus)
- Basic project management

**Exit criteria:** Working applications on Web, Desktop, and Mobile.

### Phase 4 — Concurrency & Hardening
**Goal:** Advanced execution and production quality.

- Dependency analysis and concurrent scheduling where dependencies and ownership permit it
- Stronger validation and diagnostics
- Performance, large-program handling
- Polish, examples, documentation
- Optional later features (classes as ergonomics, etc.)

---

## 12. Milestones & Acceptance Criteria

| Milestone                    | Acceptance Criteria                                                          |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Foundation models locked     | Four models documented and reviewed; codebase conventions established        |
| Headless vertical slice      | IR → serialize → deserialize → validate → execute works with tests           |
| Minimal editor               | Create / edit / save / load / run a program visually                         |
| Three-platform presence      | Same program runs on Web, Desktop, and Mobile                                |
| Dependency scheduler (later) | Independent commands may run concurrently; required determinism is preserved |

---

## 13. Project Invariants (Summary)

- One Optilotus implementation
- IR (Rust) is the source of truth
- Editor is a projection
- Stable identity for all significant entities
- Explicit value flow via `ValueId`
- Typed errors with source identity
- Sequential scheduler first
- Three mandatory targets (Web, Desktop, Mobile)
- Architecture before UI
- Agents must obey the invariants and the explicit prohibitions

---

## 14. Deferred Decisions

The following are deliberately left open and must not be treated as locked:

- Exact set of primitive commands beyond the initial vertical slice
- Concrete mobile wrapper technology
- Whether and when to introduce classes
- Binary vs JSON primary project format (or dual support)
- UI state-management library
- Exact concurrency primitives and scheduling policy (beyond the high-level dependency-graph intent)
- Advanced editor features (collaborative editing, sophisticated auto-layout, etc.)

Any promotion of a deferred decision into a locked invariant requires an explicit update to this document.

---

**End of Roadmap**