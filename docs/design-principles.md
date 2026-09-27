# design principles

## Definitions

### Honest function

An honest function is a function whose observable behavior is completely determined by its explicit inputs and explicitly declared read-only context.

It must:

- Not depend on mutable external/global state.
  - It may depend on immutable/read-only state if that state is explicitly available to the function.
  
- Not mutate its inputs or shared state.
  - Input parameters must remain stable for the entire execution. This is particularly important when functions may execute concurrently.
  
- Not mutate or depend on hidden state.
  - No static mutable variables, hidden caches, implicit singletons, etc.
  
- Produce deterministic outputs.
  - Given the same inputs and same immutable context, it produces the same  observable output.
  
- Not perform uncontrolled side effects.
  - No filesystem, network, console, database, clock, environment-variable, UI, or similar effects unless those effects are explicitly represented as outputs/dependencies.
  
- Have explicit dependencies.
  - Anything required to calculate the result should be represented by its parameters or declared immutable context rather than obtained implicitly.
  
- Be independently unit-testable.
  - It should be possible to execute and verify the function without initializing the application, UI, runtime environment, or unrelated functions.
  
- Have no dependency on execution order.
  - Its result should not change merely because another independent function happened to execute before or after it.
  
## Principle 1: Separation of concerns

A single function should only do one thing, a single class should be made for one responsibility, a single folder should only be for one purpose.

if a function does multiple things and its not possible for otherwise, use multiple helper functions and combine them, ensuring each helper does exactly one thing

## Principle 2: Shallow structuring

Folder nesting should be minimized. Ideally, folders should be at most one level deep unless deeper nesting represents a meaningful architectural or organizational boundary.

## Principle 3: Honesty

All functions should be honest whenever it's feasible, dishonest functions should be minimized

## Principle 4: Favoring Immutability

Immutable data should be used a lot, mutability can lead to unexpected problems, so Mutable data should be minimized and only be used when absolutely needed

## Principle 5: Documentation

Each function and class should document its use case, and if needed, explain where to get the inputs, while API documentation should always be in the docs/ folder and should be mentioned inside the INDEX.md file inside the folder

## Principle 6: Testing

Honest functions should normally have unit tests. Exceptions should be made when the test provides little value relative to its maintenance cost.

## Principle 7: Depth over width

Always prefer more lines of code than less longer lines

general rule is Prefer readable vertical structure over compressed expressions.

## Principle 8: Name Minimization

Names of classes, functions, folders, and data should be concise while remaining understandable without requiring excessive external documentation.

Avoid unnecessarily verbose names when a shorter name communicates the same meaning. However, names should not be shortened to the point where they become cryptic or require the reader to mentally decode abbreviations.

There is a line between a name being unnecessarily long and a name being unnecessarily short.

Examples:

* Prefer `initWorld` over `initializeECSWorld`, but not `intWrld`.
* Prefer `resCtx` over `resultContext` when `res` and `Ctx` are well-established within the project, but not `rCtx`.
* Prefer `moveSys` over `EntityMovementSystem`, but not `mSys`.

The goal is not to minimize the number of characters. The goal is to find the shortest name that remains immediately understandable to someone familiar with the project.

Names should not rely on comments to explain an otherwise cryptic abbreviation. Documentation may provide additional context, but the name itself should still communicate its purpose.

## Principle 9: Conventions

Language-specific casing conventions should be followed whenever practical.

Because JavaScript/TypeScript are multi-paradigm languages, the conventions below should be used to keep naming consistent across the project for all languages used in it.

The goal is not to make each language idiomatic in isolation. The goal is to make the TypeScript and Rust codebases feel like they belong to the same system.

### General

* Prefer single-word package/module names whenever possible.
* If a package/module requires multiple words, use `kebab-case`.
* Package/module names should not contain capital letters.
* `snake_case` should be avoided unless explicitly required by a language, library, API, or convention defined here.

### Types

Classes, enums, structs, interfaces, type aliases, and other object/type definitions should use `PascalCase`.

Examples:

```
ExecutionTask
MethodDefinition
RuntimeContext
```

### Functions, methods, and variables

Functions, methods, and variables should use `camelCase`.

Examples:

```
initWorld
executeMethod
resultContext
```

if a `prefix_` is used the convention should be `prefix_camelCase`

should only be applied to typescript, rust can retain its function/variables naming conventions


### Accessors

If a type has a field named `size`, its getter should simply be named `size()` rather than `get_size()` or `getSize()`.

Examples:

```
size()
name()
context()
```

### Setters

Setters should use the `set_` prefix.

Examples:

```
set_size()
set_name()
set_context()
```


### Conversions

`as_` should be used for non-fallible data-type conversions or views.

Examples:

```
as_str()
as_slice()
as_bytes()
```

Conversions that can fail should use an appropriate fallible convention rather than `as_`.

### `try_` functions

`try_` should be used for operations that may fail under normal circumstances and whose failure is expected to be handled by the caller.

Examples:

```
try_initWorld()
try_loadProject()
try_parseMethod()
```

A `try_` function must provide an explicit failure mechanism, such as a result or error value. The caller is responsible for handling the possible failure.

Functions without the `try_` prefix should represent operations where failure is considered unrecoverable at the call site. Such functions may panic, terminate, or otherwise propagate the failure according to the language and runtime conventions.

Examples:

```
initWorld()
loadProject()
parseMethod()
```

The `try_` prefix should therefore communicate **recoverable fallibility**, not merely the possibility that an operation could technically fail.

`must_` should not be used. The absence of `try_` already indicates that failure is not expected to be recoverable at the call site.

### Boolean queries

`is_` and `has_` should be used for query methods that return a boolean.

### `optilotus_` functions

inside aqualotus, any functions inside of it that originate from optilotus' API layer should be prefixed with `optilotus_`

Examples:

```
is_empty()
is_valid()
has_children()
has_value()
```

### Constants

Global, static, read-only constants should use `SCREAMING_SNAKE_CASE`.

Examples:

```
MAX_METHOD_COUNT
DEFAULT_STACK_SIZE
VERSION
```

### Error and absence handling

Prefer explicit `Result` and `Option` (or equivalent) styles over throwing exceptions or returning `null`/`undefined`.

Examples:

```ts
try_parse(input: string): Result<Ast, ParseError>
find_node(id: NodeId): Option<Node>
```

Throwing and null returns should be avoided in new code unless interfacing with an external API that requires them.

### Immutability

Prefer immutable data by default.

In TypeScript, use `readonly` and `Readonly<T>` aggressively. Mutable fields and structures should be the exception and must have a clear owner.

### TypeScript-specific restrictions

* `any` is forbidden. `unknown` is allowed only when narrowed in the same scope.
* Explicit return types are required on all non-trivial functions, especially those that cross module boundaries.
* TypeScript `enum` should be avoided. Prefer discriminated unions (tagged unions).
* Parameter properties in constructors should be avoided. Assign fields explicitly in the constructor body.
* Prefer plain functions and modules over classes when there is no clear identity or owned mutable state.

### Private fields

Do not use a leading underscore for private fields.

Use the language’s native privacy mechanism:

* TypeScript: `private` or `#`
* Rust: normal private fields

### Language-specific conventions

When a language or ecosystem has an established convention that conflicts with a general project convention, the guide's convention should normally take precedence unless this document explicitly mentions it.

The goal of these conventions is consistency and readability across a project with potentially multiple paradigms, not enforcing a particular casing style for its own sake.

## Principle 10: Explicit Ownership

Every piece of mutable state should have one clearly defined owner.

Other systems may read owned state or request changes to it, but they should not independently mutate the same state.

State ownership should be obvious from the architecture rather than inferred from usage.

Examples:

* The UI owns editor interaction state.
* The project model owns persistent program data.
* The runtime owns execution state.
* The ECS owns runtime entities and components used for execution.

Multiple representations of the same information should not independently own that information.

When ownership is unclear, establish a single owner before adding additional state or synchronization.

## Principle 11: Dependency Direction

Dependencies should flow in one direction toward lower-level and more fundamental layers.

Higher-level systems may depend on lower-level systems, but lower-level systems should not depend on higher-level systems.

The runtime must not depend on the UI.

The compiler must not depend on React Flow.

The runtime must not depend on Tauri.

The language implementation must not require the IDE to exist.

A typical dependency direction is:

```
UI
 ↓
Project / IR
 ↓
Compiler / Validator
 ↓
Runtime
 ↓
Platform / Effects
```

The exact layers may change as the project develops, but dependencies should remain directed and architectural boundaries should be preserved.

## Principle 12: Headless Runtime

The runtime should be usable without the graphical IDE.

The runtime must not require:

* React
* React Flow
* Tauri
* a browser
* graphical rendering
* other UI-specific systems

The same program should be capable of being validated, compiled, tested, and executed without initializing the IDE.

UI functionality should be an interface to the runtime, not a requirement of the runtime.

This allows the runtime to be used for automated testing, command-line execution, server-side execution, and other environments where no graphical interface exists.

## Principle 13: Explicit Effect Boundaries

Pure computation and external effects should be separated.

External effects should occur at explicit boundaries rather than being hidden inside otherwise computational code.

Examples of effects include:

* filesystem access
* networking
* database access
* console output
* UI operations
* environment access
* clock access
* external processes

A computation should receive the information it needs explicitly rather than secretly obtaining it from an external source.

Effects are allowed when they are required by the system. They should simply be isolated from code that is expected to be honest and deterministic.

For example:

```
readFile
 ↓
parse
 ↓
validate
 ↓
calculate
 ↓
writeFile
```

The `calculate` step should not secretly read files or modify external state.

## Principle 14: No Hidden Coupling

Components should not depend on undocumented assumptions about other components.

Dependencies should not be hidden through:

* global mutable state
* implicit initialization order
* undocumented side effects
* naming assumptions
* shared state with unclear ownership
* execution order that is not represented explicitly

If one component requires another component to execute first, that dependency should be represented explicitly.

If a component requires particular state to exist, that requirement should be represented through its interface or ownership structure.

Code should not appear independent while secretly depending on another component.

## Principle 15: Determinism

Deterministic code should produce the same observable result when given the same inputs and immutable context.

Deterministic behavior must not depend on:

* thread scheduling
* execution order
* memory layout
* unrelated system state
* timing
* hidden mutable state
* other nondeterministic implementation details

Nondeterministic behavior is allowed when required, but it should be explicit.

For example, randomness or the current time should be represented as an explicit input or effect rather than being silently accessed by deterministic code.

At the runtime level, a deterministic program should not produce different results merely because independent operations happened to execute in a different order.

## Principle 16: Concurrency

Concurrency should be based on explicit data dependencies rather than simply the availability of threads.

Code may execute concurrently when its dependencies and shared-state requirements allow it to do so safely.

Shared mutable state must not be accessed concurrently without an explicit ownership, synchronization, or other safety mechanism.

If two operations do not depend on one another, the runtime should be free to execute them concurrently when appropriate.

For example:

```
A -> C
B -> C
```

means that `A` and `B` may execute concurrently, while `C` must wait for both of them.

Concurrency must not introduce observable nondeterminism into code that is required to be deterministic.

## Principle 17: Stable Program Representation

The editor representation of a program must not be the authoritative representation of the program itself.

Editor-specific structures may exist for:

* visualization
* interaction
* layout
* selection
* temporary editing state
* UI-specific metadata

The language should have its own program representation independent of the editor implementation.

For example:

```
React Flow
    ↓
Project / IR
    ↓
Compiler
    ↓
Runtime Representation
    ↓
ECS Execution State
```

Replacing the visual editor should not require redesigning the language or runtime.

Likewise, changing the runtime implementation should not require changing how the editor represents visual layout.

## Principle 18: Serialization Is a Contract

Serialized project data represents the project and language format, not the internal implementation of the editor or runtime.

Internal data structures may change without requiring the serialized format to change.

Serialized formats should therefore be treated as stable interfaces.

When the serialized format must change, the format should have an explicit version and an appropriate migration mechanism should be provided when compatibility is required.

Internal implementation details should not be serialized merely because they currently exist in an internal data structure.

## Principle 19: Stable Identity

Program entities should have stable identities independent of their human-readable names.

Examples of entities that may require stable identity include:

* classes
* methods
* nodes
* blocks
* parameters
* variables
* connections
* execution tasks

Names are human-readable properties. IDs define identity.

Renaming an entity should not change its identity.

Copying, moving, or modifying an entity should preserve its identity when the operation represents modification rather than creation of a new entity.

Stable identity should be used when tracking references, serialization, undo/redo, dependency relationships, and runtime state.

## Principle 20: Presentation Does Not Define Semantics

Presentation data should not affect program semantics unless the language explicitly defines it as semantic.

Program behavior should not depend on:

* node position
* node size
* node color
* UI layout
* which panel is open
* selection state
* editor zoom
* other purely visual properties

For example, moving a node from one location to another should not change what the program does.

Visual structure should communicate program semantics without accidentally becoming part of them.

## Principle 21: Validate Before Execution

Invalid programs should be rejected before execution whenever the error can be detected before runtime.

Validation should occur as early as reasonably possible.

Examples of errors that should normally be detected before execution include:

* invalid connections
* incompatible types
* nonexistent methods
* invalid parameter counts
* malformed blocks
* invalid graph structures
* references to nonexistent program entities

Runtime validation is still required for conditions that cannot be known statically.

The goal is to prevent errors that could have been identified before execution from becoming runtime failures.

## Principle 22: Fail Explicitly

Errors should be detected as close as possible to their source and communicated explicitly.

An error should not be allowed to silently corrupt state and cause an unrelated failure later.

Prefer:

```
invalid connection
    ↓
validation error
    ↓
node + port + reason
```

over:

```
invalid connection
    ↓
corrupted state
    ↓
unrelated failure
    ↓
unhelpful error
```

Functions should communicate failure through the established error-handling conventions of the project.

Errors should contain enough information to identify the source and reason for the failure whenever practical.

## Principle 23: Stable Interfaces

Code should depend on stable interfaces rather than internal implementation details.

Internal implementations may change without requiring unrelated systems to change.

Systems should interact through well-defined APIs, interfaces, or other explicit boundaries.

Avoid allowing unrelated systems to directly manipulate internal data structures merely because those structures are currently accessible.

For example, prefer:

```
scheduler.schedule(task)
runtime.execute(method)
project.addClass(...)
```

over allowing every subsystem to directly modify internal runtime or ECS structures.

The purpose of an interface is to define what a component provides without unnecessarily exposing how it provides it.

## Principle 24: AI Agent Compliance

AI agents modifying the project must follow the architectural rules defined in this document.

Before modifying code, an agent should identify:

* the relevant architectural boundary
* the authoritative source of truth
* the owner of any state being modified
* the existing conventions
* the interfaces through which the relevant systems communicate

An agent should integrate with the existing architecture rather than introducing an alternative pattern without justification.

An agent must not introduce a new architectural pattern merely because that pattern is common in the language, framework, or another project.

Existing project conventions take precedence over generic language or framework conventions unless this document explicitly allows otherwise.

When an architectural change is necessary, the change should be made deliberately rather than silently bypassing an existing principle.

An agent should prefer modifying the existing design over creating a parallel system that performs the same responsibility.


# System Invariants

The following invariants are fundamental architectural requirements of the project.

A change that violates one of these invariants should be considered an architectural change and must be deliberate rather than accidental.

## Architecture

* The UI must not be a dependency of the runtime.
* The runtime must remain headless and executable without the IDE.
* The language and runtime must not depend on React Flow, Monaco, Tauri, or other editor-specific technologies.
* Dependencies must flow toward lower-level and more fundamental systems rather than creating circular architectural dependencies.

## State and Ownership

* Every piece of mutable state must have one clearly defined owner.
* Persistent program data must have one authoritative source of truth.
* Multiple representations of the same information must derive from the authoritative representation rather than becoming independent sources of truth.
* Runtime execution state must be owned by the runtime rather than by the UI.

## Honest Code

* Honest functions must not depend on hidden mutable state.
* Honest functions must not mutate their inputs or shared external state.
* Honest functions must produce deterministic results from their explicit inputs and immutable context.
* External effects must not be hidden inside code that is expected to be honest.

## Program Representation

* The editor representation must not be the authoritative representation of the program.
* Presentation data must not alter program semantics unless explicitly defined by the language.
* Program entities must have stable identities independent of their human-readable names.
* Serialized project data must represent the project format rather than internal runtime or editor implementation details.

## Execution

* Invalid programs should be rejected before execution whenever the error can be detected beforehand.
* Concurrent execution must respect explicit data dependencies and ownership rules.
* Deterministic execution must not depend on thread scheduling or accidental execution order.
* Hidden execution-order dependencies are not allowed.
* Runtime errors must be communicated explicitly rather than silently producing corrupted or ambiguous state.

## Interfaces

* Systems should communicate through explicit interfaces rather than relying on hidden coupling.
* Internal implementation details should not become dependencies of unrelated systems.
* Internal representations may change without requiring unrelated systems to change, provided their stable interfaces remain compatible.

## Project Consistency

* Project-specific conventions take precedence over generic language or framework conventions unless this document explicitly states otherwise.
* New systems should not duplicate an existing responsibility without a deliberate architectural reason.
* AI agents must preserve these invariants when modifying the project.
* An AI agent must not silently bypass an invariant because an alternative implementation appears simpler or more conventional.
