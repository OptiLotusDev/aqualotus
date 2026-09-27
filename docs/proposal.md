# Aqualotus / Optilotus
**Visual Programming Language & Environment**  
Graduation Project Presentation

### Team
- [Abdallah Elbeheiry](https://github.com/abdallah-elbeheiry) — Student code: 2327220
- [Mohammed Helmy](https://github.com/helmy9999) — Student code: 2328158
- [Ahmed Reda](https://github.com/areda04) — Student code: 2327492

---

## 1. The Problem

Traditional programming has a high barrier to entry:

- Syntax and tooling complexity discourage many potential creators
- Existing visual tools are often either too limited (Scratch-like) or locked into proprietary ecosystems
- Most visual languages tightly couple the editor with the runtime

```
Typical situation today:

Editor  =  Language  =  Runtime
```

**Consequence:**  
The language becomes difficult to reuse, test, or embed independently of its graphical environment.  
Developers lack a modern visual language with a reusable, independently testable headless runtime.

---

## 2. Our Proposal

**Optilotus** — a cross-platform visual programming language  
**Aqualotus** — the development environment that surrounds it

Core idea:

> Separate the language and runtime from the visual editor so that each can evolve independently.

```
Aqualotus (editor)
       │
       │ explicit interface
       ▼
Optilotus (language + runtime)
```

Users build programs from:

- **Packages** — namespaces and containers
- **Structs** — user-definable data
- **Functions** — ordered lists of command blocks

Each command block maps to a single, explicit command executed by the Optilotus scheduler.

---

## 3. What Makes Optilotus a Language?

Optilotus is not merely a visual representation of some internal system. It defines:

- Its own program representation
- Its own values and data model
- Commands and their semantics
- How commands exchange values
- Validation rules
- Execution semantics

**Programs can exist and run independently of Aqualotus.**

Aqualotus is an environment *for* Optilotus, not Optilotus itself.

---

## 4. Target Audience

| Audience             | Role                                     |
| -------------------- | ---------------------------------------- |
| Students & educators | **Primary** — learning and teaching      |
| Prototypers          | Rapid construction of program logic      |
| Developers           | Headless runtime, embedding, and tooling |

We are not attempting to replace professional text-based languages.  
We are creating a serious visual language that remains usable both with and without the graphical environment.

---

## 5. Key Design Decisions

### 5.1 Language Surface (v1)

```
Package
 ├── Struct
 └── Function
      ├── Command
      ├── Command
      └── Command
```

Classes are deliberately deferred.  
We first prove the execution and data model before adding object-oriented ergonomics.

### 5.2 Explicit Value Flow

Commands communicate only through explicit values identified by `ValueId`.

```
Command A
   │
   │ produces ValueId 17
   ▼
ValueId 17
   │
   ▼
Command B
```

There is no hidden stack, global state, or implicit data passing between commands.

**Why this matters:**
- Dependencies become visible
- Enables later dependency-graph scheduling
- Simplifies error reporting and “see the code behind”

### 5.3 Headless Runtime First

The first major milestone is deliberately UI-free:

```
IR
 ↓
serialize
 ↓
deserialize
 ↓
validate
 ↓
execute
 ↓
predictable result
```

This proves the central architectural claim:  
**Optilotus does not depend on Aqualotus.**

### 5.4 Stable Identity

Every significant entity has a stable ID independent of its name:

- PackageId
- StructId
- FunctionId
- CommandId
- ValueId

Stable IDs allow renaming without changing entity identity, preserving references and enabling reliable undo/redo and error mapping.

### 5.5 One Runtime, Three Targets

```
              One Optilotus (Rust)
                       │
         ┌─────────────┼─────────────┐
         │             │             │
        Web         Desktop        Mobile
```

Platform differences remain at the deployment boundary.  
Language semantics stay identical across all targets.

---

## 6. Technology Choices & Rationale

| Layer                   | Choice                             | Rationale                                                                        |
| ----------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| Core language & runtime | Rust → WASM                        | Safety, performance, strong WASM support, explicit memory/resource management    |
| UI                      | TypeScript + React                 | Mature ecosystem for complex interactive editors                                 |
| Visual canvas           | React Flow                         | Mature node-based editor foundation with a large ecosystem                       |
| Desktop                 | Tauri 2                            | Lightweight, Rust-native, strong security model                                  |
| Mobile                  | Same web frontend + native wrapper | Reuses the entire UI and Optilotus; concrete wrapper is an implementation detail |
| Architecture            | Explicit IR + command scheduler    | Clear ownership, testability, path to concurrency                                |

**Guiding principle:**  
UI lives in TypeScript.  
All language semantics and execution live in Rust and execute locally through the appropriate platform boundary, primarily via WASM on the Web.

---

## 7. Development Approach

- Phased delivery over months
- Architecture before UI — the headless vertical slice is the first real milestone
- Strong written invariants that both humans and AI agents must follow
- Incremental language growth: start with packages, structs, functions, and sequential execution
- Continuous testing of the core runtime independently of the editor

This directly addresses a common failure mode of visual-language projects: building a polished editor on top of an unclear or tightly coupled runtime.

---

## 8. Expected Outcomes

By the end of the project we will deliver:

1. A working headless Optilotus runtime with serialization, validation, and predictable execution
2. A usable visual editor (Aqualotus) for creating, editing, and running programs
3. Deployments on Web, Desktop, and Mobile
4. Clear documentation of the intermediate representation, identity model, and error model
5. A codebase whose architectural boundaries are explicit and enforceable

---

## 9. Project Value

- Delivers a complete visual programming language with a cleanly separated, independently executable runtime
- Demonstrates a practical architecture in which the editor is a projection of the language rather than its definition
- Produces a reusable headless runtime that can be tested, embedded, and deployed without any graphical interface
- Establishes explicit contracts (intermediate representation, stable identity, value flow, error model) that keep the system coherent across Web, Desktop, and Mobile
- Shows that a non-trivial language and runtime can be designed with deliberate scope control and verifiable milestones rather than as an open-ended UI prototype

---

## 10. Closing

**Aqualotus / Optilotus**

A visual programming language that does not force the editor to own the language.

- Explicit intermediate representation  
- Headless, independently testable runtime  
- One implementation → Web, Desktop, Mobile  
- Built for long-term maintainability by humans and AI agents  

**We are building the foundation first, then the experience around it.**

---

### Suggested Presentation Flow (12–15 minutes)

1. **Problem** (1.5 min) — Show the “Editor = Language = Runtime” coupling  
2. **Proposal** (1.5 min) — Introduce the separation + what Optilotus actually is  
3. **What makes it a language** (1 min)  
4. **Target audience** (1 min)  
5. **Key design decisions** (3–3.5 min) — Value flow diagram + headless pipeline are the highlights  
6. **Technology & rationale** (1.5 min)  
7. **Development approach & outcomes** (1.5 min)  
8. **Project value + closing** (1 min) — End on “Build the foundation first”

---