# rule-discovery Specification

## Purpose

This specification defines how the opencode-rules plugin discovers, loads, and delivers markdown-based rule files to OpenCode sessions. The plugin supports both unconditional and conditional rules (via glob patterns), and delivers them as silent messages to sessions when they are created or compacted.
## Requirements
### Requirement: Rule File Formats

The system MUST support rule definitions in both `.md` and `.mdc` file formats with optional `globs` and `keywords` frontmatter fields, and send them as silent messages when sessions are created or compacted.

#### Scenario: Loading a standard markdown rule

- Given a rule file named `my-rule.md`
- When the system discovers rules
- Then the rule `my-rule` should be loaded and sent via silent message when a session is created.

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
- And a file at `src/components/button.ts` is being processed
- Then the rule `my-rule` should be applied and sent via silent message when a session is created.

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
- And a file at `src/utils/helpers.js` is being processed
- Then the rule `my-rule` should NOT be applied.

#### Scenario: Loading a rule with no metadata

- Given a rule file named `another-rule.mdc` with the following content:
  ```
  This rule should always apply.
  ```
- When the system discovers rules
- Then the rule `another-rule` should be loaded and sent via silent message when a session is created unconditionally.

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

### Requirement: Debug Logging for Rule Discovery

The system SHALL provide debug logging capabilities controlled by the `OPENCODE_RULES_DEBUG` environment variable. When enabled, logs SHALL display discovered rule files and directory operations. Logs SHALL NOT include sensitive data such as full prompt content or absolute file paths outside the project.

#### Scenario: Debug logging enabled for global rules

- Given `OPENCODE_RULES_DEBUG=true` is set
- And global rules directory contains `global-rule.md` and `another-rule.mdc`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: global-rule.md"
- And the system SHALL log "Discovered global rule: another-rule.mdc"

#### Scenario: Debug logging enabled for project rules

- Given `OPENCODE_RULES_DEBUG=true` is set
- And project rules directory contains `project-rule.md`
- When the system discovers rules
- Then the system SHALL log "Discovered project rule: project-rule.md"

#### Scenario: Debug logging for nested rules

- Given `OPENCODE_RULES_DEBUG=true` is set
- And global rules directory contains `frontend/react.md`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: frontend/react.md"

#### Scenario: Debug logging disabled by default

- Given `OPENCODE_RULES_DEBUG` is not set or set to any value other than "true"
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging with no rules found

- Given `OPENCODE_RULES_DEBUG=true` is set
- And no rule files exist in the searched directories
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging redacts sensitive content

- Given `OPENCODE_RULES_DEBUG=true` is set
- When the system logs rule matching information
- Then the system SHALL NOT log full prompt content
- And the system SHALL log prompt length or keyword match counts instead

### Requirement: System Prompt Rule Injection

The system SHALL inject formatted rules directly into the system prompt using the `experimental.chat.system.transform` hook, ensuring rules are present for every LLM call.

#### Scenario: Rules injected on every LLM call

- **GIVEN** rule files have been discovered
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the system SHALL append formatted rules to `output.system`
- **AND** the rules SHALL be formatted with headers and separators

#### Scenario: No rules when no files discovered

- **GIVEN** no rule files were discovered during initialization
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the system SHALL NOT modify `output.system`

#### Scenario: Conditional rules filtered by message context

- **GIVEN** a rule file `component-rules.mdc` with glob pattern `src/components/**/*.ts`
- **AND** the conversation contains references to `src/components/Button.tsx`
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the rule SHALL be included in the system prompt

#### Scenario: Conditional rules excluded when no matching context

- **GIVEN** a rule file `component-rules.mdc` with glob pattern `src/components/**/*.ts`
- **AND** the conversation contains no references to matching file paths
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the rule SHALL NOT be included in the system prompt

### Requirement: Message Context Extraction

The system SHALL use the `experimental.chat.messages.transform` hook to extract file path context from conversation messages for conditional rule filtering.

#### Scenario: Extract paths from tool call arguments

- **GIVEN** a message contains a tool call to `read` with path `/src/utils/helper.ts`
- **WHEN** the `experimental.chat.messages.transform` hook is triggered
- **THEN** the path `/src/utils/helper.ts` SHALL be extracted and stored for rule filtering

#### Scenario: Extract paths from message content

- **GIVEN** a user message contains text "please check the file src/index.ts"
- **WHEN** the `experimental.chat.messages.transform` hook is triggered
- **THEN** the path `src/index.ts` SHALL be extracted and stored for rule filtering

#### Scenario: No mutation of messages

- **GIVEN** the `experimental.chat.messages.transform` hook is triggered
- **WHEN** file paths are extracted from messages
- **THEN** the `output.messages` array SHALL NOT be modified
- **AND** the hook SHALL only read message content

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

The system SHALL manage session context with bounded memory growth by cleaning up context entries after they are consumed.

#### Scenario: Context deleted after system transform

- **GIVEN** context was stored for sessionID "abc123" during messages.transform
- **WHEN** the system.transform hook reads the context for "abc123"
- **THEN** the context entry SHALL be deleted from storage
- **AND** subsequent reads for "abc123" SHALL return undefined

#### Scenario: Memory bounded under repeated sessions

- **GIVEN** 1000 sessions have been processed
- **WHEN** each session completes its system.transform hook
- **THEN** the session context storage SHALL contain 0 entries
- **AND** memory usage SHALL not grow proportionally to session count

### Requirement: Frontmatter Parsing

The system SHALL parse rule frontmatter using a YAML parser supporting standard YAML syntax including inline arrays, quoted strings, and case-insensitive keys.

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

#### Scenario: Uppercase frontmatter keys

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  Globs:
    - '*.md'
  Keywords:
    - documentation
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the globs and keywords SHALL be extracted correctly (case-insensitive key matching)

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

