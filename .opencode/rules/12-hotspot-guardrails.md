---
globs:
  - 'src/utils.ts'
  - 'src/runtime.ts'
  - 'src/index.test.ts'
---

# Hotspot Guardrails

- Keep `src/utils.ts` a compatibility re-export facade; add new logic to domain modules instead. `src/api-surface.typecheck.ts` enforces intentional exports.
- In `src/runtime.ts`, extract shared helpers before adding additional inline transformation logic.
- In `src/index.test.ts`, prefer creating or expanding module-focused test files instead of growing the monolithic suite.
