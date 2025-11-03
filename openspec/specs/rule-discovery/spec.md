# rule-discovery Specification

## Purpose

This specification defines how the opencode-rules plugin discovers, loads, and delivers markdown-based rule files to OpenCode sessions. The plugin supports both unconditional and conditional rules (via glob patterns), and delivers them as silent messages to sessions when they are created or compacted.

## Requirements

### Requirement: Rule File Formats

The system MUST support rule definitions in both `.md` and `.mdc` file formats and send them as silent messages when sessions are created or compacted.

#### Scenario: Loading a standard markdown rule

- Given a rule file named `my-rule.md`
- When the system discovers rules
- Then the rule `my-rule` should be loaded and sent via silent message when a session is created.

#### Scenario: Loading a markdown with metadata rule

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

#### Scenario: Loading a markdown with metadata rule that does not apply

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

### Requirement: Debug Logging for Rule Discovery

The system SHALL provide debug logging capabilities to display discovered rule files during the discovery process.

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

#### Scenario: Debug logging disabled

- Given debug logging is disabled
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging with no rules found

- Given debug logging is enabled
- And no rule files exist in the searched directories
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

### Requirement: Silent Message Rule Injection

The system SHALL send formatted rules as silent messages (using `noReply: true`) when sessions are created or compacted, using the `event` hook and `client.session.prompt()` API.

#### Scenario: Rules sent on session creation

- **GIVEN** a new session is created
- **WHEN** the `session.created` event is received
- **THEN** the system SHALL call `client.session.prompt()` with `noReply: true`
- **AND** the message SHALL contain the formatted rules
- **AND** the session ID SHALL be added to the tracking set

#### Scenario: Rules not sent twice to same session

- **GIVEN** a session has already received rules
- **WHEN** another `session.created` event is received for the same session ID
- **THEN** the system SHALL NOT send rules again
- **AND** the `client.session.prompt()` method SHALL NOT be called

#### Scenario: Rules re-sent on session compaction

- **GIVEN** a session exists and has received rules
- **WHEN** a `session.compacted` event is received
- **THEN** the session ID SHALL be removed from the tracking set
- **AND** the system SHALL immediately call `client.session.prompt()` with `noReply: true`
- **AND** the message SHALL contain the formatted rules
- **AND** the session ID SHALL be added back to the tracking set

#### Scenario: Compaction for unknown session

- **GIVEN** a `session.compacted` event is received for a session not in the tracking set
- **WHEN** the event is processed
- **THEN** the system SHALL send rules to that session
- **AND** the session ID SHALL be added to the tracking set

#### Scenario: Silent message format

- **GIVEN** rules are being sent to a session
- **WHEN** the system calls `client.session.prompt()`
- **THEN** the request body SHALL include `noReply: true`
- **AND** the request body SHALL include a parts array with a single text part
- **AND** the text part SHALL contain the formatted rules

#### Scenario: Error handling during message send

- **GIVEN** rules are being sent to a session
- **WHEN** the `client.session.prompt()` call fails
- **THEN** the error SHALL be logged with context
- **AND** the session SHALL NOT be added to the tracking set
- **AND** the system SHALL continue operating normally

### Requirement: Event-Driven Architecture

The system SHALL use the `event` hook to listen for session lifecycle events rather than the `chat.message` hook.

#### Scenario: Event hook registered

- **GIVEN** the plugin is initialized
- **WHEN** hooks are returned from the plugin
- **THEN** an `event` hook function SHALL be present
- **AND** the `event` hook SHALL handle `session.created` events
- **AND** the `event` hook SHALL handle `session.compacted` events

#### Scenario: No rules when formattedRules is empty

- **GIVEN** no rule files were discovered
- **WHEN** any session event is received
- **THEN** the system SHALL NOT send any messages
- **AND** the system SHALL return early from the event handler
