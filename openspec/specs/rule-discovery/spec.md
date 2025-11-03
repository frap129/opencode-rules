# rule-discovery Specification

## Purpose
TBD - created by archiving change cursor-style-rules. Update Purpose after archive.
## Requirements
### Requirement: Rule File Formats

The system MUST support rule definitions in both `.md` and `.mdc` file formats and inject them into the first message of every session.

#### Scenario: Loading a standard markdown rule

- Given a rule file named `my-rule.md`
- When the system discovers rules
- Then the rule `my-rule` should be loaded and appended to the first message.

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
- Then the rule `my-rule` should be applied and appended to the first message.

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
- Then the rule `another-rule` should be loaded and appended to the first message unconditionally.

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

### Requirement: First Message Rule Injection

The system SHALL append formatted rules to the first user message text content in every session using the `chat.message` hook.

#### Scenario: Rules appended to first message

- **GIVEN** a new session is created
- **AND** the user sends their first message "hello"
- **WHEN** the `chat.message` hook is invoked
- **THEN** the system SHALL append the formatted rules to the message text
- **AND** the message text SHALL contain both the original user input and the formatted rules

#### Scenario: Rules not appended to subsequent messages

- **GIVEN** a session has already received its first message
- **AND** the user sends a subsequent message "how are you?"
- **WHEN** the `chat.message` hook is invoked
- **THEN** the system SHALL NOT append rules to the message text
- **AND** the message text SHALL contain only the original user input

#### Scenario: Empty first message handling

- **GIVEN** a new session is created
- **AND** the first message has empty text content
- **WHEN** the `chat.message` hook is invoked
- **THEN** the system SHALL still append the formatted rules
- **AND** the message SHALL contain only the formatted rules

