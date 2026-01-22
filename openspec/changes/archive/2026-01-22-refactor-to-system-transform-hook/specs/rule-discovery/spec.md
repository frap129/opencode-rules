## REMOVED Requirements

### Requirement: Silent Message Rule Injection

**Reason**: Replaced by `System Prompt Rule Injection`. Rules are now injected directly into the system prompt instead of being sent as silent messages.

**Migration**: No user action required. Rules will automatically be injected via the new mechanism.

### Requirement: Event-Driven Architecture

**Reason**: The `event` hook for `session.created` and `session.compacted` is no longer needed. The `experimental.chat.system.transform` hook fires before every LLM call, automatically handling both new sessions and post-compaction scenarios.

**Migration**: No user action required. The new hook-based architecture handles all cases automatically.

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Rule File Formats

The system MUST support rule definitions in both `.md` and `.mdc` file formats and inject them into the system prompt.

#### Scenario: Loading a standard markdown rule

- **GIVEN** a rule file named `my-rule.md`
- **WHEN** the system discovers rules
- **THEN** the rule `my-rule` SHALL be loaded and injected via system prompt on every LLM call

#### Scenario: Loading a markdown with metadata rule

- **GIVEN** a rule file named `my-rule.mdc` with glob patterns
- **AND** the conversation references a file matching those patterns
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the rule `my-rule` SHALL be included in the system prompt

#### Scenario: Loading a markdown with metadata rule that does not apply

- **GIVEN** a rule file named `my-rule.mdc` with glob pattern `src/components/**/*.ts`
- **AND** the conversation only references files in `src/utils/`
- **WHEN** the `experimental.chat.system.transform` hook is triggered
- **THEN** the rule `my-rule` SHALL NOT be included in the system prompt

#### Scenario: Loading a rule with no metadata

- **GIVEN** a rule file named `another-rule.mdc` with no frontmatter
- **WHEN** the system discovers rules
- **THEN** the rule `another-rule` SHALL be loaded and injected unconditionally

### Requirement: Debug Logging for Rule Discovery

The system SHALL provide debug logging capabilities to display discovered rule files during the discovery process.

#### Scenario: Debug logging enabled for global rules

- **GIVEN** debug logging is enabled
- **AND** global rules directory contains `global-rule.md` and `another-rule.mdc`
- **WHEN** the system discovers rules
- **THEN** the system SHALL log "Discovered global rule: global-rule.md"
- **AND** the system SHALL log "Discovered global rule: another-rule.mdc"

#### Scenario: Debug logging enabled for project rules

- **GIVEN** debug logging is enabled
- **AND** project rules directory contains `project-rule.md`
- **WHEN** the system discovers rules
- **THEN** the system SHALL log "Discovered project rule: project-rule.md"

#### Scenario: Debug logging for injected rules

- **GIVEN** debug logging is enabled
- **WHEN** rules are injected via `experimental.chat.system.transform`
- **THEN** the system SHALL log which rules are being injected
- **AND** the system SHALL log the number of context file paths discovered

## REMOVED Requirements

### Requirement: Silent Message Rule Injection

**Reason**: Replaced by `System Prompt Rule Injection`. Rules are now injected directly into the system prompt instead of being sent as silent messages.

**Migration**: No user action required. Rules will automatically be injected via the new mechanism.

### Requirement: Event-Driven Architecture

**Reason**: The `event` hook for `session.created` and `session.compacted` is no longer needed. The `experimental.chat.system.transform` hook fires before every LLM call, automatically handling both new sessions and post-compaction scenarios.

**Migration**: No user action required. The new hook-based architecture handles all cases automatically.
