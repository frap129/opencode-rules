# Rule Discovery Specification

## Purpose

Define the requirements for discovering markdown rule files from standard directories and injecting them into the OpenCode agent system prompt.

## ADDED Requirements

### Requirement: File Discovery

The plugin SHALL discover markdown rule files from standard XDG and project directories.

#### Scenario: Global rules discovery

- **WHEN** the plugin initializes
- **THEN** it SHALL scan $XDG_CONFIG_HOME/opencode/rules/\*.md for rule files
- **AND** SHALL use fallback ~/.config/opencode/rules/ when XDG_CONFIG_HOME is not set
- **AND** SHALL handle missing directories gracefully without errors

#### Scenario: Project rules discovery

- **WHEN** the plugin initializes in a project directory
- **THEN** it SHALL scan .opencode/rules/\*.md for project-specific rule files
- **AND** SHALL handle missing .opencode directory gracefully
- **AND** SHALL use project-relative paths

#### Scenario: File filtering

- **WHEN** scanning directories
- **THEN** it SHALL only include files with .md extension
- **AND** SHALL exclude hidden files (starting with .)
- **AND** SHALL ignore directories and non-markdown files

### Requirement: Rule Content Processing

The plugin SHALL read and format discovered rule files for system prompt injection.

#### Scenario: File content reading

- **WHEN** a rule file is discovered
- **THEN** the plugin SHALL read the file content using UTF-8 encoding
- **AND** SHALL handle file read errors gracefully by skipping problematic files
- **AND** SHALL log warnings for inaccessible files

#### Scenario: Rule formatting

- **WHEN** formatting rules for system prompt
- **THEN** it SHALL create a clear "OpenCode Rules" section header
- **AND** SHALL include each rule file with its filename as a sub-header
- **AND** SHALL separate individual rules with clear dividers
- **AND** SHALL include instructions to follow the rules

#### Scenario: Empty rules handling

- **WHEN** no rule files are discovered
- **THEN** the plugin SHALL return an empty string
- **AND** SHALL not modify the system prompt
- **AND** SHALL not inject any rules content

### Requirement: System Prompt Integration

The plugin SHALL integrate discovered rules into agent system prompts using the chat.params hook.

#### Scenario: Chat parameter modification

- **WHEN** an agent session starts
- **THEN** the plugin SHALL intercept the chat.params hook
- **AND** SHALL modify the system prompt to include discovered rules using systemPromptSuffix
- **AND** SHALL preserve existing system prompt content

#### Scenario: Plugin interface compliance

- **WHEN** the plugin is loaded by OpenCode
- **THEN** it SHALL export a function compatible with the Plugin type
- **AND** SHALL receive the proper PluginInput context object
- **AND** SHALL return hook implementations for system prompt integration

#### Scenario: Error resilience

- **WHEN** errors occur during rule discovery or processing
- **THEN** the plugin SHALL not crash or prevent OpenCode from starting
- **AND** SHALL log appropriate warnings for debugging
- **AND** SHALL continue operation with available rules
