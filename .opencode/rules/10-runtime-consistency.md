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
- Keep warning channels consistent: user-actionable rule-file problems may use `console.warn`; internal operational failures should go through debug logging.
