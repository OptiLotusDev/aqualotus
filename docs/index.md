# Docs Index (AI Reference)

This file tells human teammates and AI agents what each document in `docs/` is for and in what order to read them.

## Files

- **`roadmap.md`** — Living engineering specification. Phases, milestones, and build order. Read this first when planning work or deciding what to implement next.
- **`design-principles.md`** — Normative design rules (e.g. honest functions, invariants). Constraints that all implementation must satisfy. Read before writing language, runtime, or UI logic.
- **`proposal.md`** — Project presentation / graduation proposal. Background, motivation, and scope for stakeholders. Context only; not a build spec.

## Reading order for agents

1. `index.md` (this file) — orientation
2. `roadmap.md` — what to build and in what order
3. `design-principles.md` — rules the build must follow
4. `proposal.md` — background context if needed

## Notes

- `roadmap.md` is the source of truth for sequencing. If it conflicts with older notes, follow the roadmap.
- `design-principles.md` overrides implementation convenience. If a shortcut violates a principle, do not take it.
- Do not add new top-level docs without updating this index.
