# Docs Index (AI Reference)

This file tells human teammates and AI agents what each document in `docs/` is for and in what order to read them.

## Files

- **`roadmap.md`** — Living engineering specification. Phases, milestones, and build order. Read this first when planning work or deciding what to implement next.
- **`design-principles.md`** — Normative design rules (e.g. honest functions, invariants). Constraints that all implementation must satisfy. Read before writing language, runtime, or UI logic.
- **`api.md`** — Optilotus bridge API reference (wire format, generated types, Rust core, WASM exports, TS bridge, UI state owners). Read before touching the UI ↔ runtime boundary.
- **`bridge-guide.md`** — Task recipes for changing the boundary: add a command kind, change a response shape, keep the wire format compatible. Read alongside `api.md` when actually editing the boundary.
- **`proposal.md`** — Project presentation / graduation proposal. Background, motivation, and scope for stakeholders. Context only; not a build spec.

## Reading order for agents

1. `index.md` (this file) — orientation
2. `roadmap.md` — what to build and in what order
3. `design-principles.md` — rules the build must follow
4. `api.md` — current interface contracts
5. `bridge-guide.md` — how to change those contracts safely (only when editing the boundary)
6. `proposal.md` — background context if needed

## Notes

- `roadmap.md` is the source of truth for sequencing. If it conflicts with older notes, follow the roadmap.
- `design-principles.md` overrides implementation convenience. If a shortcut violates a principle, do not take it.
- Do not add new top-level docs without updating this index.
