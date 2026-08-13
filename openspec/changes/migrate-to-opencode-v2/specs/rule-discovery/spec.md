# rule-discovery Spec Delta

## MODIFIED Requirements

### Requirement: Rule File Formats

The system MUST support rule definitions in both `.md` and `.mdc` file formats with optional frontmatter fields: `globs`, `keywords`, `tools`, `model`, `agent`, `command`, `project`, `branch`, `os`, `ci`, and `match`. Rules without conditional frontmatter are injected unconditionally. For conditional rules, `match: any` (default) applies the rule when at least one declared condition dimension matches, and `match: all` applies the rule only when every declared condition dimension matches. Rules are delivered via the session `context` hook on every dispatch.

#### Scenario: Loading a standard markdown rule

- **GIVEN** a rule file named `my-rule.md`
- **WHEN** the system discovers rules
- **THEN** the rule `my-rule` SHALL be loaded and injected into the system prompt

#### Scenario: Loading a markdown with globs metadata rule

- **GIVEN** a rule file named `my-rule.mdc` with the following content:

  ```
  ---
  globs:
    - "src/components/**/*.ts"
  ---

  This is a rule for TypeScript components.
  ```

- **WHEN** the system discovers rules
- **AND** a file at `src/components/button.ts` is in the session context
- **THEN** the rule `my-rule` SHALL be applied via the system prompt

#### Scenario: Loading a markdown with globs metadata rule that does not apply

- **GIVEN** a rule file named `my-rule.mdc` with the following content:

  ```
  ---
  globs:
    - "src/components/**/*.ts"
  ---

  This is a rule for TypeScript components.
  ```

- **WHEN** the system discovers rules
- **AND** a file at `src/utils/helpers.js` is in the session context
- **THEN** the rule `my-rule` SHALL NOT be applied

#### Scenario: Loading a rule with no metadata

- **GIVEN** a rule file named `another-rule.mdc` with the following content:
  ```
  This rule should always apply.
  ```
- **WHEN** the system discovers rules
- **THEN** the rule `another-rule` SHALL be loaded and injected unconditionally

#### Scenario: Loading a rule with keywords metadata

- **GIVEN** a rule file named `testing-rule.mdc` with the following content:

  ```
  ---
  keywords:
    - "test"
    - "jest"
  ---

  Follow these testing best practices.
  ```

- **WHEN** the user's prompt contains "help me write a test"
- **THEN** the rule `testing-rule` SHALL be applied

#### Scenario: Loading a rule with tools metadata

- **GIVEN** a rule file named `github-rule.mdc` with the following content:

  ```
  ---
  tools:
    - "mcp_github"
  ---

  Use GitHub best practices.
  ```

- **AND** the context tools record contains a key `github_list_repos` (deriving the candidate `mcp_github`)
- **WHEN** the system evaluates rules for injection
- **THEN** the rule `github-rule` SHALL be applied

#### Scenario: Loading a rule with both globs and keywords (OR logic)

- **GIVEN** a rule file with:
  ```yaml
  ---
  globs:
    - '**/*.test.ts'
  keywords:
    - 'testing'
  ---
  ```
- **WHEN** the user's prompt contains "testing" but no test files are in context
- **THEN** the rule SHALL be applied (keywords match)

#### Scenario: Rule with both globs and keywords - globs match only

- **GIVEN** a rule file with:
  ```yaml
  ---
  globs:
    - '**/*.test.ts'
  keywords:
    - 'testing'
  ---
  ```
- **WHEN** a file `src/utils.test.ts` is in context but user prompt is "fix the import"
- **THEN** the rule SHALL be applied (globs match)

#### Scenario: Rule with both globs and keywords - neither match

- **GIVEN** a rule file with:
  ```yaml
  ---
  globs:
    - '**/*.test.ts'
  keywords:
    - 'testing'
  ---
  ```
- **WHEN** no test files are in context AND user prompt is "update the readme"
- **THEN** the rule SHALL NOT be applied

#### Scenario: Rule with globs, keywords, and tools (OR across all)

- **GIVEN** a rule file with:
  ```yaml
  ---
  globs:
    - '**/*.test.ts'
  keywords:
    - 'testing'
  tools:
    - 'mcp_jest'
  ---
  ```
- **WHEN** no test files are in context AND prompt is "update readme" AND `mcp_jest` is available
- **THEN** the rule SHALL be applied (tools match)

#### Scenario: Rule with new filter dimensions uses default `match: any`

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model:
    - gpt-5.3-codex
  agent:
    - programmer
  ---
  ```
- **AND** the runtime model is `gpt-5.3-codex`
- **AND** the runtime agent is `code-reviewer`
- **WHEN** the system evaluates conditional rules
- **THEN** the rule SHALL be applied (one declared dimension matches)

#### Scenario: Rule with `match: all` requires all declared dimensions

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model:
    - gpt-5.3-codex
  agent:
    - programmer
  match: all
  ---
  ```
- **AND** the runtime model is `gpt-5.3-codex`
- **AND** the runtime agent is `code-reviewer`
- **WHEN** the system evaluates conditional rules
- **THEN** the rule SHALL NOT be applied

#### Scenario: Existing unconditional rules remain unconditional

- **GIVEN** a rule file with no frontmatter
- **WHEN** the system evaluates rules
- **THEN** the rule SHALL be injected unconditionally

### Requirement: Frontmatter Parsing

The system SHALL parse rule frontmatter using a YAML parser supporting standard YAML syntax including inline arrays, quoted strings, and multiline arrays. Recognized frontmatter keys are `globs`, `keywords`, `tools`, `model`, `agent`, `command`, `project`, `branch`, `os`, `ci`, and `match`; key matching is case-sensitive. The `ci` key SHALL be parsed as a boolean when provided; non-boolean values SHALL be ignored. The `match` key SHALL accept `any` and `all`, and invalid or missing `match` values SHALL be treated as `any`. Unrecognized frontmatter keys SHALL be ignored.

#### Scenario: Inline array syntax for globs

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  globs: ['*.ts', '*.tsx']
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the globs array SHALL contain `["*.ts", "*.tsx"]`

#### Scenario: Mixed array syntax

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  keywords:
    - testing
    - 'unit test'
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the keywords array SHALL contain `["testing", "unit test"]`

#### Scenario: Tools frontmatter field

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  tools:
    - 'mcp_github'
    - 'mcp_slack'
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the tools array SHALL contain `["mcp_github", "mcp_slack"]`

#### Scenario: Unrecognized frontmatter keys ignored

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  globs:
    - '*.md'
  author: someone
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the globs SHALL be extracted
- **AND** the `author` field SHALL be ignored

#### Scenario: Block list syntax for new string-array filters

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model:
    - gpt-5.3-codex
  agent:
    - programmer
  command:
    - /plan
  project:
    - node
  branch:
    - feature/specs
  os:
    - linux
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** all listed fields SHALL be extracted as string arrays

#### Scenario: Inline list syntax remains supported

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model: ['gpt-5.3-codex']
  agent: ['programmer']
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** `model` and `agent` SHALL be extracted as arrays

#### Scenario: Boolean `ci` value is parsed

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  ci: true
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** `ci` SHALL be extracted as boolean `true`

#### Scenario: Invalid `match` value falls back to `any`

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model:
    - gpt-5.3-codex
  agent:
    - programmer
  match: maybe
  ---
  ```
- **WHEN** the system parses and evaluates the rule
- **THEN** `match` SHALL be treated as `any`

### Requirement: System Prompt Rule Injection

The system SHALL inject formatted rules into the system prompt through the session `context` hook by appending a text `SystemPart` to the mutable `system` array. Rules SHALL be injected once per user turn (on the first dispatch after a new user prompt) and re-injected when a new user prompt arrives; subsequent dispatches within the same turn SHALL NOT re-append. The system SHALL retain a defensive gate that skips injection while the session store reports an active compacting window (the v2 runtime never sets the flag; the gate is kept for safety). The system SHALL pass available tool IDs (derived from the context payload's tools record, including MCP-derived candidates) to the rule matching logic.

#### Scenario: Rules injected on the first dispatch of a user turn

- **GIVEN** rule files have been discovered
- **WHEN** the session `context` hook is triggered for a turn where rules have not yet been injected
- **AND** the session is not in a compacting state
- **THEN** the system SHALL append a text `SystemPart` containing formatted rules to `system`
- **AND** the rules SHALL be formatted with headers and separators

#### Scenario: No rules when no files discovered

- **GIVEN** no rule files were discovered during initialization
- **WHEN** the session `context` hook is triggered
- **THEN** the system SHALL NOT modify `system`

#### Scenario: Conditional rules filtered by message context

- **GIVEN** a rule file `component-rules.mdc` with glob pattern `src/components/**/*.ts`
- **AND** the session context contains a reference to `src/components/Button.tsx`
- **WHEN** the session `context` hook is triggered
- **THEN** the rule SHALL be included in the system prompt

#### Scenario: Conditional rules excluded when no matching context

- **GIVEN** a rule file `component-rules.mdc` with glob pattern `src/components/**/*.ts`
- **AND** the session context contains no references to matching file paths
- **WHEN** the session `context` hook is triggered
- **THEN** the rule SHALL NOT be included in the system prompt

#### Scenario: Available tool IDs passed to rule matching

- **GIVEN** the context payload provides a tools record
- **WHEN** the session `context` hook evaluates conditional rules
- **THEN** rules with `tools` frontmatter SHALL be matched against the tool keys plus derived `mcp_` capability-ID candidates

#### Scenario: Rules injected on every LLM call

- **GIVEN** rule files have been discovered
- **AND** rules were appended on the first dispatch of the current user turn
- **WHEN** the session `context` hook is triggered on a subsequent dispatch of the same turn
- **THEN** the system SHALL NOT re-append rules

#### Scenario: Injection skipped during session compaction

- **GIVEN** the session store reports the session as compacting within the 30-second TTL
- **AND** the v2 runtime never sets this flag (the gate is retained defensively)
- **WHEN** the session `context` hook is triggered
- **THEN** the system SHALL NOT modify `system`

### Requirement: Message Context Extraction

The system SHALL seed session context by extracting file paths and the latest user prompt from the session `context` hook payload's messages during the first invocation for a session. The v2 payloads SHALL be mapped with `toV1Messages` (converting `text` and `tool-call` parts; dropping `tool-result`, `media`, and `reasoning` parts) without mutating `ctx.messages`. Seeding SHALL occur once per session; the `seededFromHistory` flag SHALL prevent redundant scanning. The seed SHALL be supplemented by real-time capture: file paths from `tool.execute.before` and the latest user prompt, model ID, and agent from subsequent `context` payloads.

#### Scenario: Extract paths from tool call arguments

- **GIVEN** the context payload messages contain a tool-call part for tool `read` with input `{ filePath: "/src/utils/helper.ts" }`
- **WHEN** the session `context` hook seeds the session
- **THEN** the path `/src/utils/helper.ts` SHALL be extracted, normalized to the project directory, and stored in the session context

#### Scenario: Extract paths from message content

- **GIVEN** a user message in the context payload contains text "please check the file src/index.ts"
- **WHEN** the session `context` hook seeds the session
- **THEN** the path `src/index.ts` SHALL be extracted and stored in the session context

#### Scenario: No mutation of messages

- **GIVEN** the session `context` hook is triggered
- **WHEN** `toV1Messages` maps the payload messages for extraction
- **THEN** the `ctx.messages` array SHALL NOT be modified
- **AND** the adapter SHALL only read message content

#### Scenario: History seeding occurs once per session

- **GIVEN** a session has already been seeded from message history
- **WHEN** the session `context` hook fires again
- **THEN** the system SHALL skip re-extracting paths from history
- **AND** the `seededFromHistory` flag SHALL prevent redundant scanning

#### Scenario: User prompt captured during seeding

- **GIVEN** the context payload messages contain user messages
- **WHEN** the session `context` hook seeds the session
- **THEN** the latest user prompt text SHALL be extracted and stored

### Requirement: Session Context Lifecycle

The system SHALL manage session context using a bounded in-memory store with LRU eviction. The store SHALL persist session state across hook invocations within a session and evict least-recently-used entries when capacity is exceeded.

#### Scenario: Session state persists across hooks

- **GIVEN** context paths were captured for session "abc123" during `tool.execute.before`
- **WHEN** the session `context` hook fires for "abc123"
- **THEN** the captured context paths SHALL be available for rule filtering

#### Scenario: LRU eviction under capacity pressure

- **GIVEN** the session store has a maximum capacity of 100
- **AND** 100 sessions are stored
- **WHEN** a new session "session-101" is upserted
- **THEN** the least-recently-used session SHALL be evicted
- **AND** the store size SHALL not exceed 100

#### Scenario: Memory bounded under repeated sessions

- **GIVEN** 10,000 sessions have been processed over time
- **WHEN** the store is inspected
- **THEN** the store SHALL contain at most 100 entries
- **AND** memory usage SHALL be bounded

#### Scenario: Session state tracks compacting status

- **GIVEN** a session is marked as compacting
- **WHEN** the system queries whether to skip injection
- **THEN** the compacting status and timestamp SHALL be available
- **AND** a 30-second TTL SHALL determine whether to skip

### Requirement: Tool-Based Rule Matching

The system SHALL support a `tools` field in rule frontmatter that matches against tool keys from the session context tools record and derived MCP capability-ID candidates. When a rule declares `tools`, the rule SHALL be applied if any listed tool ID is present in the current set of available tool IDs. Tool matching participates in OR logic with `globs` and `keywords`: a conditional rule is applied when ANY condition dimension matches.

#### Scenario: Rule with tools matches a derived MCP capability ID

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  tools:
    - 'mcp_github'
  ---
  ```
- **AND** the context tools record contains a key `github_list_repos`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied (derived ID `mcp_github` is available)

#### Scenario: Rule with tools does not match

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  tools:
    - 'mcp_slack'
  ---
  ```
- **AND** no tool key has a `slack` prefix
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL NOT be applied

#### Scenario: Rule with tools and keywords - tools match only

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  tools:
    - 'mcp_github'
  keywords:
    - 'deploy'
  ---
  ```
- **AND** the context tools record contains a key `github_list_repos`
- **AND** the user prompt does not contain "deploy"
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied (OR logic; tools match)

#### Scenario: Tool matching uses exact string comparison

- **GIVEN** a rule file with tools `["mcp_github"]`
- **AND** the available tool IDs include `mcp_github_actions`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL NOT be applied (no exact match)

#### Scenario: Rule with tools matches an available tool

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  tools:
    - 'read'
  ---
  ```
- **AND** the context tools record contains the key `read`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied (exact match on the raw tool key)

### Requirement: MCP Capability Discovery

The system SHALL derive MCP capability-ID candidates in the format `mcp_<prefix>` from the underscore-delimited prefixes of tool keys in the session context tools record. Each tool key with at least one underscore SHALL produce a candidate for every proper prefix.

#### Scenario: Simple tool key produces capability ID

- **GIVEN** a tool key `context7_search`
- **WHEN** the system derives capability IDs
- **THEN** the ID `mcp_context7` SHALL be included

#### Scenario: Multi-segment key produces all prefix candidates

- **GIVEN** a tool key `my_server_search`
- **WHEN** the system derives capability IDs
- **THEN** the IDs `mcp_my` and `mcp_my_server` SHALL be included

#### Scenario: Keys without underscore produce no candidates

- **GIVEN** a tool key `read`
- **WHEN** the system derives capability IDs
- **THEN** no `mcp_` candidate SHALL be produced

#### Scenario: Connected MCP client produces capability ID

- **GIVEN** the context tools record contains a tool key `my_github_list_repos`
- **WHEN** the system derives capability IDs
- **THEN** the capability ID `mcp_my_github` SHALL be included

#### Scenario: Disconnected MCP client excluded

- **GIVEN** the context tools record contains no tool key with a `slack` prefix
- **WHEN** the system derives capability IDs
- **THEN** no capability ID for `slack` SHALL be included

#### Scenario: Client name sanitization

- **GIVEN** a tool key `my_special_tool_v2_search`
- **WHEN** the system derives capability IDs
- **THEN** the capability ID `mcp_my_special_tool_v2` SHALL be included

### Requirement: Real-Time Context Capture

The system SHALL capture file paths in real time using the `tool.execute.before` hook, and capture the latest user prompt, model ID, and agent from the session `context` hook payload, supplementing the message-history seed performed during the first `context` hook invocation.

#### Scenario: File path captured from tool execution

- **GIVEN** a tool call to `read` with input `filePath: "src/index.ts"`
- **WHEN** the `tool.execute.before` hook fires
- **THEN** the path `src/index.ts` SHALL be added to the session's context paths

#### Scenario: Paths captured from multiple tool types

- **GIVEN** tool calls to `edit` (filePath), `glob` (path), `grep` (path), and `bash` (workdir)
- **WHEN** each `tool.execute.before` hook fires
- **THEN** each extracted path SHALL be added to the session's context paths

#### Scenario: User prompt captured from the context payload

- **GIVEN** the session `context` hook fires with a user message containing "fix the login bug"
- **WHEN** the hook is handled
- **THEN** the session's `lastUserPrompt` SHALL be updated to "fix the login bug"

#### Scenario: User prompt captured from chat message

- **GIVEN** the session `context` hook fires with a messages array containing a user message "fix the login bug"
- **WHEN** the hook is handled
- **THEN** the session's `lastUserPrompt` SHALL be updated to "fix the login bug"

#### Scenario: Synthetic messages ignored

- **GIVEN** the session `context` hook fires with a messages array containing no new user text
- **WHEN** the hook is handled
- **THEN** the session's `lastUserPrompt` SHALL NOT be updated

## ADDED Requirements

### Requirement: Runtime Context-Based Rule Matching

The system SHALL support runtime and environment dimensions for rule matching: `model` (session model ID captured from the context payload's model reference), `agent` (session agent captured from the context payload), `command` (latest slash command token from the user prompt), `project` (derived project tags), `branch` (current git branch name), `os` (runtime platform), and `ci` (runtime CI boolean). For string-array dimensions (`model`, `agent`, `command`, `project`, `branch`, `os`), a dimension SHALL match when any rule value exactly matches the available runtime value; `branch` SHALL additionally match when a rule value containing glob characters matches the branch via glob matching; `ci` SHALL match by boolean equality. Declared dimensions combine according to `match`: `any` (default) applies the rule when at least one declared dimension matches, `all` applies it only when every declared dimension matches.

#### Scenario: Command filter matches latest slash command

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  command:
    - /plan
  ---
  ```
- **AND** the latest user prompt starts with `/plan`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

#### Scenario: CI filter matches runtime CI state

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  ci: true
  ---
  ```
- **AND** the runtime is executing in CI (for example `GITHUB_ACTIONS` is set)
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

#### Scenario: Unavailable runtime dimension does not match

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  branch:
    - main
  ---
  ```
- **AND** the current branch cannot be determined
- **WHEN** the system evaluates rule conditions
- **THEN** the branch dimension SHALL be treated as non-matching

#### Scenario: Model filter matches the session model ID

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model:
    - gpt-5.3-codex
  ---
  ```
- **AND** the session `context` hook captured model ID `gpt-5.3-codex` from the payload
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

#### Scenario: Agent filter matches the session agent

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  agent:
    - programmer
  ---
  ```
- **AND** the session `context` hook captured agent `programmer` from the payload
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

#### Scenario: OS filter matches the runtime platform

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  os:
    - linux
  ---
  ```
- **AND** the runtime platform is `linux`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

#### Scenario: Branch filter matches via glob pattern

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  branch:
    - feature/*
  ---
  ```
- **AND** the current git branch is `feature/specs`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

### Requirement: Project Fingerprinting for Rule Matching

The system SHALL derive `project` tags from repository root marker files in the resolved project directory and use the resulting tags for `project` rule matching. Minimum marker-to-tag mapping SHALL include: `package.json` -> `node`, `pyproject.toml` -> `python`, `go.mod` -> `go`, `Cargo.toml` -> `rust`, `pnpm-workspace.yaml` or `turbo.json` -> `monorepo`, and a `manifest.json` with `manifest_version` 2 or 3 plus a browser-extension signal key -> `browser-extension`. Tags SHALL be deduplicated and sorted.

#### Scenario: Multiple markers produce multiple project tags

- **GIVEN** a repository containing `package.json` and `pnpm-workspace.yaml`
- **WHEN** the system derives project tags
- **THEN** the derived tags SHALL include `node` and `monorepo`

#### Scenario: Rule with project filter matches derived tag

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  project:
    - node
  ---
  ```
- **AND** repository fingerprinting derives tag `node`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

#### Scenario: No recognized markers yields no project tag matches

- **GIVEN** a repository with no recognized project marker files
- **WHEN** the system derives project tags
- **THEN** the derived project tag set SHALL be empty

## REMOVED Requirements

### Requirement: Session Compacting Support

**Reason**: OpenCode v2 has no equivalent of `experimental.session.compacting`; compaction-context injection is dropped.
**Migration**: V1 users stay on the last V1 release. `session-store.ts` keeps its compacting/TTL internals; no runtime path sets the flag in v2.
