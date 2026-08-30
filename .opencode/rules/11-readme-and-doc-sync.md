---
globs:
  - 'README.md'
  - 'AGENTS.md'
  - 'CONTEXT.md'
  - 'docs/**/*.md'
keywords:
  - 'readme'
  - 'architecture'
  - 'project structure'
  - 'documentation'
match: any
---

# README and Documentation Sync

- When adding, removing, or renaming production modules, update the README Project Structure section in the same change.
- Keep `AGENTS.md` and `CONTEXT.md` aligned with the module layout and runtime behavior they describe.
- Keep architecture docs aligned with current hook/runtime behavior and supported rule filters.
- Remove stale references to deprecated behavior (including dead directory listings like `openspec/`) as part of the same PR that changes behavior.
