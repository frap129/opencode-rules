# rule-discovery Specification

## Purpose

This specification defines how the opencode-rules plugin discovers, loads, and delivers markdown-based rule files to OpenCode sessions. The plugin supports both unconditional and conditional rules (via glob patterns), and delivers them as silent messages to sessions when they are created or compacted.
## Requirements
### Requirement: Rule File Formats

The system MUST support rule definitions in both `.md` and `.mdc` file formats with optional `globs`, `keywords`, and `tools` frontmatter fields. Rules without conditional frontmatter are injected unconditionally. Conditional rules are injected when ANY condition dimension matches (OR logic across globs, keywords, and tools). Rules are delivered via system prompt transformation on every LLM call.

#### Scenario: Loading a standard markdown rule

- Given a rule file named `my-rule.md`
- When the system discovers rules
- Then the rule `my-rule` should be loaded and sent via system prompt on every LLM call.

#### Scenario: Loading a markdown with globs metadata rule

- Given a rule file named `my-rule.mdc` with the following content:

  ```
  ---
  globs:
    - "src/components/**/*.ts"
  ---

  This is a rule for TypeScript components.
  ```

- When the system discovers rules
- And a file at `src/components/button.ts` is in the session context
- Then the rule `my-rule` should be applied via system prompt.

#### Scenario: Loading a markdown with globs metadata rule that does not apply

- Given a rule file named `my-rule.mdc` with the following content:

  ```
  ---
  globs:
    - "src/components/**/*.ts"
  ---

  This is a rule for TypeScript components.
  ```

- When the system discovers rules
- And a file at `src/utils/helpers.js` is in the session context
- Then the rule `my-rule` should NOT be applied.

#### Scenario: Loading a rule with no metadata

- Given a rule file named `another-rule.mdc` with the following content:
  ```
  This rule should always apply.
  ```
- When the system discovers rules
- Then the rule `another-rule` should be loaded and injected unconditionally on every LLM call.

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
- **THEN** the rule `testing-rule` should be applied

#### Scenario: Loading a rule with tools metadata

- **GIVEN** a rule file named `github-rule.mdc` with the following content:

  ```
  ---
  tools:
    - "mcp_github"
  ---

  Use GitHub best practices.
  ```

- **AND** the MCP client `github` is connected
- **WHEN** the system evaluates rules for injection
- **THEN** the rule `github-rule` should be applied

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

### Requirement: Debug Logging for Rule Discovery

The system SHALL provide debug logging capabilities controlled by the `OPENCODE_RULES_DEBUG` environment variable. When set to any truthy value (any non-empty string), debug logging SHALL be enabled. When unset or empty, debug logging SHALL be disabled. Logs SHALL display discovered rule files and directory operations. Logs SHALL NOT include sensitive data such as full prompt content or absolute file paths outside the project.

#### Scenario: Debug logging enabled for global rules

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- And global rules directory contains `global-rule.md` and `another-rule.mdc`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: global-rule.md"
- And the system SHALL log "Discovered global rule: another-rule.mdc"

#### Scenario: Debug logging enabled for project rules

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- And project rules directory contains `project-rule.md`
- When the system discovers rules
- Then the system SHALL log "Discovered project rule: project-rule.md"

#### Scenario: Debug logging for nested rules

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- And global rules directory contains `frontend/react.md`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: frontend/react.md"

#### Scenario: Debug logging disabled by default

- Given `OPENCODE_RULES_DEBUG` is not set or is empty
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging with no rules found

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- And no rule files exist in the searched directories
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging redacts sensitive content

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- When the system logs rule matching information
- Then the system SHALL NOT log full prompt content
- And the system SHALL log prompt length or keyword match counts instead

### Requirement: System Prompt Rule Injection

The system SHALL inject formatted rules directly into the system prompt using the `experimental.chat.system.transform` hook, ensuring rules are present for every LLM call. The system SHALL skip injection when the session is in a compacting state within the TTL window. The system SHALL pass available tool IDs (including MCP capabilities) to the rule matching logic.

#### Scenario: Rules injected on every LLM call

- **GIVEN** rule files have been discovered
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **AND** the session is not in a compacting state
- **THEN** the system SHALL append formatted rules to `output.system`
- **AND** the rules SHALL be formatted with headers and separators

#### Scenario: No rules when no files discovered

- **GIVEN** no rule files were discovered during initialization
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the system SHALL NOT modify `output.system`

#### Scenario: Conditional rules filtered by message context

- **GIVEN** a rule file `component-rules.mdc` with glob pattern `src/components/**/*.ts`
- **AND** the session context contains a reference to `src/components/Button.tsx`
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the rule SHALL be included in the system prompt

#### Scenario: Conditional rules excluded when no matching context

- **GIVEN** a rule file `component-rules.mdc` with glob pattern `src/components/**/*.ts`
- **AND** the session context contains no references to matching file paths
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the rule SHALL NOT be included in the system prompt

#### Scenario: Injection skipped during session compaction

- **GIVEN** the session is marked as compacting within the 30-second TTL
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the system SHALL NOT modify `output.system`

#### Scenario: Available tool IDs passed to rule matching

- **GIVEN** the system has queried `client.tool.ids` and `client.mcp.status`
- **WHEN** the `experimental.chat.system.transform` hook evaluates conditional rules
- **THEN** rules with `tools` frontmatter SHALL be matched against the combined set of available tool IDs and MCP capability IDs

### Requirement: Message Context Extraction

The system SHALL use the `experimental.chat.messages.transform` hook to seed session context by extracting file paths from conversation message history and capturing the latest user prompt. This seeding occurs once per session and is supplemented by real-time capture from `tool.execute.before` and `chat.message` hooks.

#### Scenario: Extract paths from tool call arguments

- **GIVEN** a message contains a tool call to `read` with path `/src/utils/helper.ts`
- **WHEN** the `experimental.chat.messages.transform` hook is triggered
- **THEN** the path `/src/utils/helper.ts` SHALL be extracted and stored in the session context

#### Scenario: Extract paths from message content

- **GIVEN** a user message contains text "please check the file src/index.ts"
- **WHEN** the `experimental.chat.messages.transform` hook is triggered
- **THEN** the path `src/index.ts` SHALL be extracted and stored in the session context

#### Scenario: No mutation of messages

- **GIVEN** the `experimental.chat.messages.transform` hook is triggered
- **WHEN** file paths are extracted from messages
- **THEN** the `output.messages` array SHALL NOT be modified
- **AND** the hook SHALL only read message content

#### Scenario: History seeding occurs once per session

- **GIVEN** a session has already been seeded from message history
- **WHEN** the `experimental.chat.messages.transform` hook fires again
- **THEN** the system SHALL skip re-extracting paths from history
- **AND** the `seededFromHistory` flag SHALL prevent redundant scanning

#### Scenario: User prompt captured during seeding

- **GIVEN** the message history contains user messages
- **WHEN** the `experimental.chat.messages.transform` hook seeds the session
- **THEN** the latest user prompt text SHALL be extracted and stored

### Requirement: Keyword-Based Rule Matching

The system SHALL support a `keywords` field in rule frontmatter that matches against the user's prompt text using case-insensitive word-boundary matching.

#### Scenario: Rule with keywords matches user prompt

- **GIVEN** a rule file with the following frontmatter:
  ```yaml
  ---
  keywords:
    - 'testing'
    - 'unit test'
  ---
  ```
- **WHEN** the user's prompt contains "I need help testing this function"
- **THEN** the rule SHALL be applied

#### Scenario: Keyword matching is case-insensitive

- **GIVEN** a rule file with keywords `["Testing"]`
- **WHEN** the user's prompt contains "testing" (lowercase)
- **THEN** the rule SHALL be applied

#### Scenario: Keyword matching uses word boundaries

- **GIVEN** a rule file with keywords `["test"]`
- **WHEN** the user's prompt contains "testing"
- **THEN** the rule SHALL be applied (word-boundary match at start)

#### Scenario: Keyword does not match mid-word

- **GIVEN** a rule file with keywords `["test"]`
- **WHEN** the user's prompt contains "contest"
- **THEN** the rule SHALL NOT be applied

#### Scenario: Rule with keywords but no matching prompt

- **GIVEN** a rule file with keywords `["testing", "jest"]`
- **WHEN** the user's prompt contains "help me with the database"
- **THEN** the rule SHALL NOT be applied

#### Scenario: Rule with no keywords or globs always applies

- **GIVEN** a rule file with no frontmatter
- **WHEN** any user prompt is processed
- **THEN** the rule SHALL be applied unconditionally

### Requirement: Directory Scan Error Visibility

The system SHALL log warnings when directory read operations fail, providing visibility into file system errors without crashing the plugin.

#### Scenario: Permission denied on directory

- **GIVEN** a rules directory exists but is not readable
- **WHEN** the system attempts to scan the directory
- **THEN** the system SHALL log a warning including the directory path and error type
- **AND** the system SHALL continue scanning other directories

#### Scenario: Broken symlink in rules directory

- **GIVEN** a rules directory contains a broken symbolic link
- **WHEN** the system attempts to read the linked file
- **THEN** the system SHALL log a warning for the failed read
- **AND** the system SHALL continue processing other rule files

#### Scenario: Directory disappears during scan

- **GIVEN** a rules directory is deleted while being scanned
- **WHEN** the system encounters the missing directory
- **THEN** the system SHALL log a warning
- **AND** the system SHALL not throw an unhandled exception

### Requirement: Rule Heading Uniqueness

The system SHALL generate unique rule headings by including the relative path from the rules directory root, preventing collisions when multiple rules have the same filename.

#### Scenario: Same filename in different directories

- **GIVEN** global rules contain `frontend/style.md` and `backend/style.md`
- **WHEN** the system formats rules for injection
- **THEN** the heading for the first rule SHALL include "frontend/style"
- **AND** the heading for the second rule SHALL include "backend/style"

#### Scenario: Unique filenames use relative path

- **GIVEN** a rule file exists at `conventions/naming.md`
- **WHEN** the system formats the rule for injection
- **THEN** the heading SHALL include "conventions/naming"

### Requirement: Session Context Lifecycle

The system SHALL manage session context using a bounded in-memory store with LRU eviction. The store SHALL persist session state across hook invocations within a session and evict least-recently-used entries when capacity is exceeded.

#### Scenario: Session state persists across hooks

- **GIVEN** context paths were captured for session "abc123" during `tool.execute.before`
- **WHEN** the `experimental.chat.system.transform` hook fires for "abc123"
- **THEN** the captured context paths SHALL be available for rule filtering

#### Scenario: LRU eviction under capacity pressure

- **GIVEN** the session store has a maximum capacity of 100
- **AND** 100 sessions are stored
- **WHEN** a new session "session-101" is upserted
- **THEN** the least-recently-used session SHALL be evicted
- **AND** the store size SHALL not exceed 100

#### Scenario: Session state tracks compacting status

- **GIVEN** a session is marked as compacting
- **WHEN** the system queries whether to skip injection
- **THEN** the compacting status and timestamp SHALL be available
- **AND** a 30-second TTL SHALL determine whether to skip

#### Scenario: Memory bounded under repeated sessions

- **GIVEN** 10,000 sessions have been processed over time
- **WHEN** the store is inspected
- **THEN** the store SHALL contain at most 100 entries
- **AND** memory usage SHALL be bounded

### Requirement: Frontmatter Parsing

The system SHALL parse rule frontmatter using a YAML parser supporting standard YAML syntax including inline arrays, quoted strings, and multiline arrays. Recognized frontmatter keys are `globs`, `keywords`, and `tools`; key matching is case-sensitive.

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

### Requirement: Rule Content Caching

The system SHALL cache parsed rule content with modification-time-based invalidation to avoid redundant file reads.

#### Scenario: Cached rule returned when unchanged

- **GIVEN** a rule file was read and cached
- **AND** the file has not been modified since caching
- **WHEN** the system needs the rule content
- **THEN** the cached content SHALL be returned
- **AND** no file read operation SHALL occur

#### Scenario: Cache invalidated on file modification

- **GIVEN** a rule file was read and cached
- **AND** the file is subsequently modified
- **WHEN** the system needs the rule content
- **THEN** the file SHALL be re-read from disk
- **AND** the cache SHALL be updated with the new content

### Requirement: Tool-Based Rule Matching

The system SHALL support a `tools` field in rule frontmatter that matches against available tool and MCP capability IDs. When a rule declares `tools`, the rule SHALL be applied if any listed tool ID is present in the current set of available tool IDs. Tool matching participates in OR logic with `globs` and `keywords`: a conditional rule is applied when ANY condition dimension matches.

#### Scenario: Rule with tools matches an available tool

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  tools:
    - 'mcp_github'
  ---
  ```
- **AND** the MCP client `github` is connected
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied (tool ID `mcp_github` is available)

#### Scenario: Rule with tools does not match

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  tools:
    - 'mcp_slack'
  ---
  ```
- **AND** no MCP client named `slack` is connected
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
- **AND** the MCP client `github` is connected
- **AND** the user prompt does not contain "deploy"
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied (OR logic; tools match)

#### Scenario: Tool matching uses exact string comparison

- **GIVEN** a rule file with tools `["mcp_github"]`
- **AND** the available tool IDs include `mcp_github_actions`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL NOT be applied (no exact match)

### Requirement: MCP Capability Discovery

The system SHALL query connected MCP clients and derive capability IDs in the format `mcp_<sanitized_name>`, where `<sanitized_name>` replaces non-alphanumeric characters with underscores. Only MCP clients with a connected status SHALL produce capability IDs.

#### Scenario: Connected MCP client produces capability ID

- **GIVEN** an MCP client named `my-github` with status `connected`
- **WHEN** the system queries available tool IDs
- **THEN** the capability ID `mcp_my_github` SHALL be included

#### Scenario: Disconnected MCP client excluded

- **GIVEN** an MCP client named `slack` with status `disconnected`
- **WHEN** the system queries available tool IDs
- **THEN** no capability ID for `slack` SHALL be included

#### Scenario: Client name sanitization

- **GIVEN** an MCP client named `my.special-tool/v2`
- **WHEN** the system derives the capability ID
- **THEN** the capability ID SHALL be `mcp_my_special_tool_v2`

### Requirement: Real-Time Context Capture

The system SHALL capture file paths and user prompts in real time using the `tool.execute.before` and `chat.message` hooks, supplementing the message-history seed performed during `experimental.chat.messages.transform`.

#### Scenario: File path captured from tool execution

- **GIVEN** a tool call to `read` with argument `filePath: "src/index.ts"`
- **WHEN** the `tool.execute.before` hook fires
- **THEN** the path `src/index.ts` SHALL be added to the session's context paths

#### Scenario: Paths captured from multiple tool types

- **GIVEN** tool calls to `edit` (filePath), `glob` (path), `grep` (path), and `bash` (workdir)
- **WHEN** each `tool.execute.before` hook fires
- **THEN** each extracted path SHALL be added to the session's context paths

#### Scenario: User prompt captured from chat message

- **GIVEN** a user sends a message with text "fix the login bug"
- **WHEN** the `chat.message` hook fires
- **THEN** the session's `lastUserPrompt` SHALL be updated to "fix the login bug"

#### Scenario: Synthetic messages ignored

- **GIVEN** a synthetic (non-user) message arrives
- **WHEN** the `chat.message` hook fires
- **THEN** the session's `lastUserPrompt` SHALL NOT be updated

### Requirement: Session Compacting Support

The system SHALL handle the `experimental.session.compacting` hook by marking the session as compacting, skipping rule injection during the compaction window, and injecting active context paths into the compaction context string.

#### Scenario: Session marked as compacting

- **GIVEN** a session with ID "abc123" is active
- **WHEN** the `experimental.session.compacting` hook fires for "abc123"
- **THEN** the session SHALL be marked as compacting with a timestamp

#### Scenario: Rule injection skipped during compaction

- **GIVEN** a session is marked as compacting within the TTL window (30 seconds)
- **WHEN** the `experimental.chat.system.transform` hook fires
- **THEN** the system SHALL skip rule injection for that session
- **AND** `output.system` SHALL NOT be modified

#### Scenario: Context paths injected into compaction string

- **GIVEN** a session has context paths `["src/index.ts", "src/utils.ts"]`
- **WHEN** the `experimental.session.compacting` hook fires
- **THEN** the compaction output SHALL include the context paths (up to 20)
- **AND** the paths SHALL be formatted for the LLM to preserve context awareness

#### Scenario: Compaction TTL expires

- **GIVEN** a session was marked as compacting more than 30 seconds ago
- **WHEN** the `experimental.chat.system.transform` hook fires
- **THEN** the system SHALL proceed with normal rule injection

