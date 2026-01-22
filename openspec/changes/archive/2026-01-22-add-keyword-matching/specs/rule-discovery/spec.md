## ADDED Requirements

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

## MODIFIED Requirements

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
