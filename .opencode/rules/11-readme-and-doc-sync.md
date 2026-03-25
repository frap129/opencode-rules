---
globs:
  - 'README.md'
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
- Keep architecture docs aligned with current hook/runtime behavior and supported rule filters.
- Remove stale references to deprecated behavior as part of the same PR that changes behavior.
