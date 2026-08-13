# Proposal: migrate-to-opencode-v2

## Why

opencode-rules must move to the OpenCode v2 plugin API. The V1 hooks it uses
(`experimental.chat.system.transform`, `experimental.chat.messages.transform`,
`chat.message`, `experimental.session.compacting`) no longer exist in v2.

## What Changes

- **BREAKING**: Plugin targets OpenCode 2 only; V1 support removed. V1 users stay on `0.7.0-beta.x`.
- **BREAKING**: Compaction-context injection removed (no v2 equivalent).
- Server entrypoint rewritten to `Plugin.define` with the `session context` + `tool.execute.before/after` hooks.
- MCP `tools:` conditions now match derived `mcp_<server>` candidates from the context hook's tools record.
- TUI entrypoint rewritten against `@opencode-ai/plugin/tui` (`ui.slot`, `data`, `theme`).
- Package manifest: `1.0.0-beta.1`, compiled exports, `@opencode-ai/plugin@0.0.0-next-17335` pinned.

## Impact

- Affected specs: `package-setup`, `rule-discovery`
- Affected code: `src/index.ts`, `src/runtime.ts`, `src/runtime-chat.ts` (deleted), `src/v2-types.ts` (new), `src/v2-messages.ts` (new), `src/tool-ids.ts` (new), `src/mcp-tools.ts` (deleted), `tui/index.tsx`, `tui/slots/sidebar-content.tsx`, `package.json`, `.opencode/`
