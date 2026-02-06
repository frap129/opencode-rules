# package-setup Spec Delta

## MODIFIED Requirements

### Requirement: TypeScript Package Configuration

The project SHALL be configured as a TypeScript package with proper build tooling, OpenCode dependencies, and strict type safety. Hook handlers SHALL use properly typed interfaces matching the `@opencode-ai/plugin` API. Message types shared across modules SHALL be bridged safely without bypassing the type system.

#### Scenario: Package initialization

- **WHEN** the repository is set up
- **THEN** package.json SHALL exist with TypeScript configuration
- **AND** @opencode-ai/sdk and @opencode-ai/plugin SHALL be listed as dependencies
- **AND** build scripts SHALL be configured for TypeScript compilation

#### Scenario: Development workflow

- **WHEN** a developer runs bun install
- **THEN** all dependencies SHALL be installed successfully
- **AND** TypeScript SHALL be configured for the project
- **AND** the package SHALL be importable as "opencode-rules"

#### Scenario: Build process

- **WHEN** build scripts are executed
- **THEN** TypeScript source SHALL compile to JavaScript
- **AND** output SHALL be generated in dist/ directory
- **AND** package exports SHALL be properly configured

#### Scenario: Code formatting

- **WHEN** Prettier is run on source files
- **THEN** code SHALL be formatted according to project conventions
- **AND** consistent style SHALL be applied across all TypeScript files

#### Scenario: Unit testing setup

- **WHEN** Vitest is executed
- **THEN** test framework SHALL be properly configured
- **AND** test files SHALL be discoverable and executable
- **AND** test reports SHALL be generated correctly

#### Scenario: Type safety in hook handlers

- **WHEN** hook handler functions are defined
- **THEN** input and output parameters SHALL use typed interfaces (not `any`)
- **AND** types SHALL match the `@opencode-ai/plugin` Hooks API
- **AND** hooks SHALL return `Promise<void>` and mutate output in place

#### Scenario: Test mock compatibility

- **WHEN** test mocks are created for PluginInput
- **THEN** mocks SHALL include all required properties including `serverUrl`
- **AND** TypeScript compilation SHALL succeed without type errors

#### Scenario: No unsafe type assertions in hook handlers

- **WHEN** a hook handler receives messages from the plugin API
- **AND** the messages need to be passed to internal utility functions
- **THEN** the system SHALL use a typed adapter function to convert between API types and internal types
- **AND** the system SHALL NOT use double type assertions (`as unknown as`)
- **AND** messages with missing required fields SHALL be filtered out by the adapter

#### Scenario: Message type adapter validates required fields

- **GIVEN** a `MessageWithInfo` from the plugin API with `role` and `parts` as optional fields
- **WHEN** converting to the internal `Message` type with required `role` and `parts` fields
- **THEN** the adapter SHALL check that `role` is defined and `parts` is a non-empty array
- **AND** messages failing validation SHALL be excluded from the result

### Requirement: Documentation Accuracy

The README documentation SHALL accurately reflect the current implementation behavior.

#### Scenario: Memory management documentation

- **WHEN** the README describes session context storage
- **THEN** it SHALL describe the actual Map-based implementation with cleanup policy
- **AND** it SHALL NOT claim WeakMap usage

#### Scenario: File operation documentation

- **WHEN** the README describes file reading behavior
- **THEN** it SHALL accurately describe asynchronous file reads via `fs/promises`
- **AND** it SHALL NOT claim synchronous file operations

#### Scenario: Debug logging documentation

- **WHEN** debug logging is available
- **THEN** the README SHALL document the `OPENCODE_RULES_DEBUG` environment variable
- **AND** it SHALL explain what information is logged

#### Scenario: Prompt extraction documentation

- **WHEN** the system extracts user prompts for keyword matching
- **THEN** the README SHALL document the "latest non-synthetic user text" behavior
- **AND** it SHALL explain how synthetic messages are excluded
