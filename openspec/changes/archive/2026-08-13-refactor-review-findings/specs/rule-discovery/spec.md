# rule-discovery Spec Delta

## MODIFIED Requirements

### Requirement: Debug Logging for Rule Discovery

The system SHALL provide debug logging capabilities controlled by the `OPENCODE_RULES_DEBUG` environment variable. When set to any truthy value (any non-empty string), debug logging SHALL be enabled. When unset or empty, debug logging SHALL be disabled. Debug log creation SHALL be centralized in a shared module and injectable into components that need it. Logs SHALL display discovered rule files and directory operations. Logs SHALL NOT include sensitive data such as full prompt content or absolute file paths outside the project.

#### Scenario: Debug logging enabled for global rules

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- And global rules directory contains `global-rule.md` and `another-rule.mdc`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: global-rule.md"
- And the system SHALL log "Discovered global rule: another-rule.mdc"

#### Scenario: Debug logging enabled for project rules

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- And project rules directory contains `project-rule.md`
- When the system discovers rules
- Then the system SHALL log "Discovered project rule: project-rule.md"

#### Scenario: Debug logging for nested rules

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- And global rules directory contains `frontend/react.md`
- When the system discovers rules
- Then the system SHALL log "Discovered global rule: frontend/react.md"

#### Scenario: Debug logging disabled by default

- Given `OPENCODE_RULES_DEBUG` is not set or is empty
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging with no rules found

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- And no rule files exist in the searched directories
- When the system discovers rules
- Then the system SHALL NOT log any rule discovery messages

#### Scenario: Debug logging redacts sensitive content

- Given `OPENCODE_RULES_DEBUG` is set to a non-empty value
- When the system logs rule matching information
- Then the system SHALL NOT log full prompt content

#### Scenario: Debug log shared across modules

- **GIVEN** the plugin source contains multiple modules that perform debug logging
- **WHEN** the modules are initialized
- **THEN** all modules SHALL use the same `createDebugLog` factory from a shared `debug` module
- **AND** no module SHALL define its own inline `debugLog` implementation

#### Scenario: Debug log injectable for testing

- **GIVEN** a function in `utils` that performs debug logging
- **WHEN** the function is called in a test
- **THEN** a custom `debugLog` function SHALL be injectable via parameter
- **AND** the default SHALL fall back to the shared `createDebugLog` factory

### Requirement: Rule Content Caching

The system SHALL cache parsed rule content with modification-time-based invalidation using asynchronous file operations to avoid blocking the event loop.

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

#### Scenario: File operations are non-blocking

- **GIVEN** the system needs to check a rule file's modification time or read its content
- **WHEN** the file operation is performed
- **THEN** the system SHALL use asynchronous `fs/promises` APIs (`stat`, `readFile`, `readdir`)
- **AND** the system SHALL NOT use synchronous `fs` APIs (`statSync`, `readFileSync`, `readdirSync`, `existsSync`)

#### Scenario: Directory scanning is non-blocking

- **GIVEN** the system needs to scan a rules directory recursively
- **WHEN** the scan is performed
- **THEN** the system SHALL use `fs/promises.readdir` with `{ withFileTypes: true }`
- **AND** the system SHALL NOT use `readdirSync`

### Requirement: Session Context Lifecycle

The system SHALL manage session context using a bounded in-memory store with LRU eviction, created via a factory function and injected through the plugin entry point. The store SHALL persist session state across hook invocations within a session and evict least-recently-used entries when capacity is exceeded.

#### Scenario: Session store created via factory

- **GIVEN** the plugin is initializing
- **WHEN** the entry point creates the session store
- **THEN** it SHALL call a `createSessionStore` factory function
- **AND** the resulting instance SHALL be passed to the runtime via dependency injection
- **AND** no module-level singleton SHALL be exported

#### Scenario: Session state persists across hooks

- **GIVEN** context paths were captured for session "abc123" during `tool.execute.before`
- **WHEN** the `experimental.chat.system.transform` hook fires for "abc123"
- **THEN** the captured context paths SHALL be available for rule filtering

#### Scenario: LRU eviction under capacity pressure

- **GIVEN** the session store has a maximum capacity of 100
- **AND** 100 sessions are stored
- **WHEN** a new session "session-101" is upserted
- **THEN** the least-recently-used session SHALL be evicted
- **AND** the store size SHALL not exceed 100

#### Scenario: Session state tracks compacting status

- **GIVEN** a session is marked as compacting
- **WHEN** the system queries whether to skip injection
- **THEN** the compacting status and timestamp SHALL be available
- **AND** a 30-second TTL SHALL determine whether to skip

#### Scenario: Tests use isolated store instances

- **GIVEN** a test needs a session store
- **WHEN** the test creates the store
- **THEN** it SHALL call `createSessionStore()` or `new SessionStore()` directly
- **AND** no shared singleton SHALL be used across tests
- **AND** the `__testOnly.resetSessionState()` pattern SHALL NOT be required

#### Scenario: Memory bounded under repeated sessions

- **GIVEN** 10,000 sessions have been processed over time
- **WHEN** the store is inspected
- **THEN** the store SHALL contain at most 100 entries
- **AND** memory usage SHALL be bounded
