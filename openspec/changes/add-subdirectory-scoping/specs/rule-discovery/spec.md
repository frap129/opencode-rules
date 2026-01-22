## MODIFIED Requirements

### Requirement: Rule File Formats

The system MUST support rule definitions in both `.md` and `.mdc` file formats located at any depth within the rules directories, and send them as silent messages when sessions are created or compacted.

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

#### Scenario: Loading rules from subdirectories

- Given a rules directory with the following structure:
  ```
  rules/
  ├── general.md
  ├── frontend/
  │   └── react-rules.mdc
  └── backend/
      └── api-rules.md
  ```
- When the system discovers rules
- Then all three rule files SHALL be discovered: `general.md`, `frontend/react-rules.mdc`, and `backend/api-rules.md`

#### Scenario: Loading rules from deeply nested subdirectories

- Given a rules directory with a file at `frontend/components/forms/validation.md`
- When the system discovers rules
- Then the rule file SHALL be discovered regardless of nesting depth

#### Scenario: Skipping hidden subdirectories

- Given a rules directory with the following structure:
  ```
  rules/
  ├── visible-rule.md
  └── .hidden/
      └── secret-rule.md
  ```
- When the system discovers rules
- Then only `visible-rule.md` SHALL be discovered
- And `secret-rule.md` SHALL NOT be discovered

## MODIFIED Requirements

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
