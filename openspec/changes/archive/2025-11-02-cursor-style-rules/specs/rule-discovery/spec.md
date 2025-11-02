## ADDED Requirements

### Requirement: Rule File Formats

The system MUST support rule definitions in both `.md` and `.mdc` file formats.

#### Scenario: Loading a standard markdown rule

- Given a rule file named `my-rule.md`
- When the system discovers rules
- Then the rule `my-rule` should be loaded and applied unconditionally.

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
- Then the rule `my-rule` should be applied.

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
- Then the rule `another-rule` should be loaded and applied unconditionally.
