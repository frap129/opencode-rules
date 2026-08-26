---
globs:
  - 'src/runtime.ts'
  - 'src/utils.ts'
  - 'src/message-context.ts'
  - 'src/mcp-tools.ts'
---

# Runtime Consistency

- Use shared message-context helpers for prompt and part extraction. Do not duplicate extraction loops in runtime hooks.
- Keep CI/env boolean detection on one parser path (`parseEnvBoolean` / `isTruthyEnvValue`) across all provider checks.
- Route all plugin console output through the gated helpers in `src/debug.ts`; use UI state or intentional thrown errors for user-visible behavior that must remain available when debug logging is disabled.
