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

The system SHALL provide debug logging capabilities to display discovered rule files during the discovery process, including their relative path from the rules directory root.

#### Scenario: Debug logging enabled for global rules

- Given debug logging is enabled
- And global rules directory contains `global-rule.md` and `another-rule.mdc`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: global-rule.md"
- And the system SHALL log "Discovered global rule: another-rule.mdc"

#### Scenario: Debug logging enabled for project rules

- Given debug logging is enabled
- And project rules directory contains `project-rule.md`
- When the system discovers rules
- Then the system SHALL log "Discovered project rule: project-rule.md"

#### Scenario: Debug logging for nested rules

- Given debug logging is enabled
- And global rules directory contains `frontend/react.md`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: frontend/react.md"

#### Scenario: Debug logging disabled

- Given debug logging is disabled
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging with no rules found

- Given debug logging is enabled
- And no rule files exist in the searched directories
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

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

