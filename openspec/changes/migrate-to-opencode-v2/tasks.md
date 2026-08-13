# Tasks: migrate-to-opencode-v2

## 1. Manifest and entrypoint

- [x] 1.1 Align package.json with v2 pins and compiled exports
- [x] 1.2 Rewrite server entrypoint to Plugin.define
- [x] 1.3 Rewrite TUI entrypoint against @opencode-ai/plugin/tui

## 2. Runtime

- [x] 2.1 Rewrite runtime hooks on the v2 surface
- [x] 2.2 Per-session directory resolution and project-rule discovery
- [x] 2.3 MCP candidate derivation from the tools record
- [x] 2.4 Remove compaction support

## 3. Docs and release

- [x] 3.1 Update README and delete compaction docs
- [x] 3.2 Dogfood config under .opencode/plugins
- [x] 3.3 Release 1.0.0-beta.1 via the beta channel
