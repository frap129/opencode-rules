## Why

A code review identified multiple quality issues in the opencode-rules plugin including unbounded memory growth in session context storage, type safety gaps using `any`, silent error swallowing, fragile regex-based YAML parsing, missing test coverage, and documentation drift. These issues impact reliability, maintainability, and developer experience.

## What Changes

### Critical

- **Session context cleanup**: Add delete-on-use mechanism for `sessionContextMap` to prevent unbounded memory growth

### High Priority

- **Type safety**: Replace `any` types with proper interfaces matching the `@opencode-ai/plugin` Hooks API
- **Error visibility**: Replace empty `catch {}` blocks with warning logs for directory read failures

### Medium Priority

- **Debug logging control**: Gate debug output behind `OPENCODE_RULES_DEBUG` env var with sensitive data redaction
- **YAML parsing**: Replace fragile regex frontmatter parsing with `yaml` package for proper inline array support
- **Rule heading uniqueness**: Include relative paths in rule headings to prevent collisions
- **Documentation**: Fix README claims about WeakMap and async operations to match implementation

### Lower Priority

- **Performance caching**: Add mtime-based caching for parsed rules and compiled glob/keyword matchers
- **Test improvements**: Fix portability (replace `/tmp` hardcode), add missing test coverage

## Impact

- Affected specs: `rule-discovery`, `package-setup`
- Affected code: `src/index.ts`, `src/utils.ts`, `src/index.test.ts`, `README.md`, `package.json`
- New dependency: `yaml: ^2.7.0`
- Breaking changes: None - all changes are backward compatible
