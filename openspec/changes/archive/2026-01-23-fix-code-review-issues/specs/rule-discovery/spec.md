## MODIFIED Requirements

### Requirement: Debug Logging for Rule Discovery

The system SHALL provide debug logging capabilities controlled by the `OPENCODE_RULES_DEBUG` environment variable. When enabled, logs SHALL display discovered rule files and directory operations. Logs SHALL NOT include sensitive data such as full prompt content or absolute file paths outside the project.

#### Scenario: Debug logging enabled for global rules

- Given `OPENCODE_RULES_DEBUG=true` is set
- And global rules directory contains `global-rule.md` and `another-rule.mdc`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: global-rule.md"
- And the system SHALL log "Discovered global rule: another-rule.mdc"

#### Scenario: Debug logging enabled for project rules

- Given `OPENCODE_RULES_DEBUG=true` is set
- And project rules directory contains `project-rule.md`
- When the system discovers rules
- Then the system SHALL log "Discovered project rule: project-rule.md"

#### Scenario: Debug logging for nested rules

- Given `OPENCODE_RULES_DEBUG=true` is set
- And global rules directory contains `frontend/react.md`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: frontend/react.md"

#### Scenario: Debug logging disabled by default

- Given `OPENCODE_RULES_DEBUG` is not set or set to any value other than "true"
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging with no rules found

- Given `OPENCODE_RULES_DEBUG=true` is set
- And no rule files exist in the searched directories
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging redacts sensitive content

- Given `OPENCODE_RULES_DEBUG=true` is set
- When the system logs rule matching information
- Then the system SHALL NOT log full prompt content
- And the system SHALL log prompt length or keyword match counts instead

## ADDED Requirements

### Requirement: Directory Scan Error Visibility

The system SHALL log warnings when directory read operations fail, providing visibility into file system errors without crashing the plugin.

#### Scenario: Permission denied on directory

- **GIVEN** a rules directory exists but is not readable
- **WHEN** the system attempts to scan the directory
- **THEN** the system SHALL log a warning including the directory path and error type
- **AND** the system SHALL continue scanning other directories

#### Scenario: Broken symlink in rules directory

- **GIVEN** a rules directory contains a broken symbolic link
- **WHEN** the system attempts to read the linked file
- **THEN** the system SHALL log a warning for the failed read
- **AND** the system SHALL continue processing other rule files

#### Scenario: Directory disappears during scan

- **GIVEN** a rules directory is deleted while being scanned
- **WHEN** the system encounters the missing directory
- **THEN** the system SHALL log a warning
- **AND** the system SHALL not throw an unhandled exception

### Requirement: Rule Heading Uniqueness

The system SHALL generate unique rule headings by including the relative path from the rules directory root, preventing collisions when multiple rules have the same filename.

#### Scenario: Same filename in different directories

- **GIVEN** global rules contain `frontend/style.md` and `backend/style.md`
- **WHEN** the system formats rules for injection
- **THEN** the heading for the first rule SHALL include "frontend/style"
- **AND** the heading for the second rule SHALL include "backend/style"

#### Scenario: Unique filenames use relative path

- **GIVEN** a rule file exists at `conventions/naming.md`
- **WHEN** the system formats the rule for injection
- **THEN** the heading SHALL include "conventions/naming"

### Requirement: Session Context Lifecycle

The system SHALL manage session context with bounded memory growth by cleaning up context entries after they are consumed.

#### Scenario: Context deleted after system transform

- **GIVEN** context was stored for sessionID "abc123" during messages.transform
- **WHEN** the system.transform hook reads the context for "abc123"
- **THEN** the context entry SHALL be deleted from storage
- **AND** subsequent reads for "abc123" SHALL return undefined

#### Scenario: Memory bounded under repeated sessions

- **GIVEN** 1000 sessions have been processed
- **WHEN** each session completes its system.transform hook
- **THEN** the session context storage SHALL contain 0 entries
- **AND** memory usage SHALL not grow proportionally to session count

### Requirement: Frontmatter Parsing

The system SHALL parse rule frontmatter using a YAML parser supporting standard YAML syntax including inline arrays, quoted strings, and case-insensitive keys.

#### Scenario: Inline array syntax for globs

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  globs: ['*.ts', '*.tsx']
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the globs array SHALL contain `["*.ts", "*.tsx"]`

#### Scenario: Mixed array syntax

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  keywords:
    - testing
    - 'unit test'
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the keywords array SHALL contain `["testing", "unit test"]`

#### Scenario: Uppercase frontmatter keys

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  Globs:
    - '*.md'
  Keywords:
    - documentation
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the globs and keywords SHALL be extracted correctly (case-insensitive key matching)

### Requirement: Rule Content Caching

The system SHALL cache parsed rule content with modification-time-based invalidation to avoid redundant file reads.

#### Scenario: Cached rule returned when unchanged

- **GIVEN** a rule file was read and cached
- **AND** the file has not been modified since caching
- **WHEN** the system needs the rule content
- **THEN** the cached content SHALL be returned
- **AND** no file read operation SHALL occur

#### Scenario: Cache invalidated on file modification

- **GIVEN** a rule file was read and cached
- **AND** the file is subsequently modified
- **WHEN** the system needs the rule content
- **THEN** the file SHALL be re-read from disk
- **AND** the cache SHALL be updated with the new content
