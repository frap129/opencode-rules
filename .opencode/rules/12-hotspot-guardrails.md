---
globs:
  - 'src/utils.ts'
  - 'src/runtime.ts'
  - 'src/index.test.ts'
---

# Hotspot Guardrails

- In `src/utils.ts`, do not add new unrelated responsibilities. Prefer splitting by domain (discovery, metadata, matching, message paths).
- In `src/runtime.ts`, extract shared helpers before adding additional inline transformation logic.
- In `src/index.test.ts`, prefer creating or expanding module-focused test files instead of growing the monolithic suite.
