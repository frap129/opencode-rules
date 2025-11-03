# rule-discovery Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
