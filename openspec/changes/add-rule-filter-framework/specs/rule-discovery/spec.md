# rule-discovery Spec Delta

## MODIFIED Requirements

### Requirement: Rule File Formats

The system MUST support rule definitions in both `.md` and `.mdc` file formats with optional frontmatter fields: `globs`, `keywords`, `tools`, `model`, `agent`, `command`, `project`, `branch`, `os`, `ci`, and `match`. Rules without conditional frontmatter are injected unconditionally. For conditional rules, `match: any` (default) applies the rule when at least one declared condition dimension matches, and `match: all` applies the rule only when every declared condition dimension matches. Rules are delivered via system prompt transformation on every LLM call.

#### Scenario: Rule with new filter dimensions uses default `match: any`

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model:
    - gpt-5.3-codex
  agent:
    - programmer
  ---
  ```
- **AND** the runtime model is `gpt-5.3-codex`
- **AND** the runtime agent is `code-reviewer`
- **WHEN** the system evaluates conditional rules
- **THEN** the rule SHALL be applied (one declared dimension matches)

#### Scenario: Rule with `match: all` requires all declared dimensions

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model:
    - gpt-5.3-codex
  agent:
    - programmer
  match: all
  ---
  ```
- **AND** the runtime model is `gpt-5.3-codex`
- **AND** the runtime agent is `code-reviewer`
- **WHEN** the system evaluates conditional rules
- **THEN** the rule SHALL NOT be applied

#### Scenario: Existing unconditional rules remain unconditional

- **GIVEN** a rule file with no frontmatter
- **WHEN** the system evaluates rules
- **THEN** the rule SHALL be injected unconditionally

### Requirement: Frontmatter Parsing

The system SHALL parse rule frontmatter using a YAML parser supporting standard YAML syntax including inline arrays, quoted strings, and multiline arrays. Recognized frontmatter keys are `globs`, `keywords`, `tools`, `model`, `agent`, `command`, `project`, `branch`, `os`, `ci`, and `match`; key matching is case-sensitive. The `ci` key SHALL be parsed as a boolean when provided. The `match` key SHALL accept `any` and `all`, and invalid or missing `match` values SHALL be treated as `any`. Unrecognized frontmatter keys SHALL be ignored.

#### Scenario: Block list syntax for new string-array filters

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model:
    - gpt-5.3-codex
  agent:
    - programmer
  command:
    - /plan
  project:
    - node
  branch:
    - feature/specs
  os:
    - linux
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** all listed fields SHALL be extracted as string arrays

#### Scenario: Inline list syntax remains supported

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model: ['gpt-5.3-codex']
  agent: ['programmer']
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** `model` and `agent` SHALL be extracted as arrays

#### Scenario: Boolean `ci` value is parsed

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  ci: true
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** `ci` SHALL be extracted as boolean `true`

#### Scenario: Invalid `match` value falls back to `any`

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  model:
    - gpt-5.3-codex
  agent:
    - programmer
  match: maybe
  ---
  ```
- **WHEN** the system parses and evaluates the rule
- **THEN** `match` SHALL be treated as `any`

### Requirement: System Prompt Rule Injection

The system SHALL inject formatted rules directly into the system prompt using the `experimental.chat.system.transform` hook, ensuring rules are present for every LLM call. The system SHALL skip injection when the session is in a compacting state within the TTL window. The system SHALL pass a complete filter context to rule matching, including available tool IDs, message context, and runtime/environment filter fields.

#### Scenario: Rule evaluation receives extended filter context

- **GIVEN** the `experimental.chat.system.transform` hook is triggered
- **WHEN** conditional rules are evaluated
- **THEN** the system SHALL evaluate rules using available values for `model`, `agent`, `command`, `project`, `branch`, `os`, and `ci` in addition to existing `globs`, `keywords`, and `tools`

#### Scenario: Missing optional runtime fields does not fail injection

- **GIVEN** branch or model information is unavailable for a session
- **WHEN** the system evaluates conditional rules
- **THEN** the system SHALL continue rule injection without throwing
- **AND** unavailable dimensions SHALL evaluate as non-matching

### Requirement: Tool-Based Rule Matching

The system SHALL support a `tools` field in rule frontmatter that matches against available tool and MCP capability IDs. When a rule declares `tools`, the tools dimension SHALL match if any listed tool ID is present in the current set of available tool IDs using exact string comparison. The tools dimension SHALL participate in conditional combination according to `match` (`any` default, `all` when declared).

#### Scenario: Tools participate in `match: all`

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  tools:
    - mcp_github
  keywords:
    - deploy
  match: all
  ---
  ```
- **AND** tool `mcp_github` is available
- **AND** the user prompt does not contain `deploy`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL NOT be applied

## ADDED Requirements

### Requirement: Runtime Context-Based Rule Matching

The system SHALL support runtime and environment dimensions for rule matching:

- `model` (runtime model identifier)
- `agent` (runtime agent type)
- `command` (latest slash command token)
- `project` (derived project tags)
- `branch` (current git branch name)
- `os` (runtime operating system)
- `ci` (runtime CI boolean)

For string-array dimensions (`model`, `agent`, `command`, `project`, `branch`, `os`), a dimension SHALL match when any rule value exactly matches an available runtime value. For `ci`, matching SHALL use boolean equality.

#### Scenario: Command filter matches latest slash command

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  command:
    - /plan
  ---
  ```
- **AND** the latest user prompt starts with `/plan`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

#### Scenario: CI filter matches runtime CI state

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  ci: true
  ---
  ```
- **AND** the runtime is executing in CI
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

#### Scenario: Unavailable runtime dimension does not match

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  branch:
    - main
  ---
  ```
- **AND** the current branch cannot be determined
- **WHEN** the system evaluates rule conditions
- **THEN** the branch dimension SHALL be treated as non-matching

### Requirement: Project Fingerprinting for Rule Matching

The system SHALL derive `project` tags from repository root marker files and use the resulting tags for `project` rule matching.

Minimum marker-to-tag mapping SHALL include:

- `package.json` -> `node`
- `pyproject.toml` -> `python`
- `go.mod` -> `go`
- `Cargo.toml` -> `rust`
- `pnpm-workspace.yaml` or `turbo.json` -> `monorepo`
- browser extension manifest marker -> `browser-extension`

#### Scenario: Multiple markers produce multiple project tags

- **GIVEN** a repository containing `package.json` and `pnpm-workspace.yaml`
- **WHEN** the system derives project tags
- **THEN** the derived tags SHALL include `node` and `monorepo`

#### Scenario: Rule with project filter matches derived tag

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  project:
    - node
  ---
  ```
- **AND** repository fingerprinting derives tag `node`
- **WHEN** the system evaluates rule conditions
- **THEN** the rule SHALL be applied

#### Scenario: No recognized markers yields no project tag matches

- **GIVEN** a repository with no recognized project marker files
- **WHEN** the system derives project tags
- **THEN** the derived project tag set SHALL be empty
