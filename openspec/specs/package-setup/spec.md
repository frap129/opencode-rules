# package-setup Specification

## Purpose
TBD - created by archiving change setup-typescript-package. Update Purpose after archive.
## Requirements
### Requirement: TypeScript Package Configuration

The project SHALL be configured as a TypeScript package with proper build tooling, OpenCode dependencies, and strict type safety. Hook handlers SHALL use properly typed interfaces matching the `@opencode-ai/plugin` API.

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

### Requirement: Test Portability

The test suite SHALL be portable across operating systems and shall not depend on fixed filesystem paths.

#### Scenario: Temporary directory creation

- **WHEN** tests create temporary test directories
- **THEN** the system SHALL use `os.tmpdir()` instead of hardcoded `/tmp`
- **AND** directories SHALL be uniquely named to avoid conflicts

#### Scenario: Cross-platform compatibility

- **WHEN** tests are run on Windows, macOS, or Linux
- **THEN** all tests SHALL pass without modification
- **AND** path separators SHALL be handled correctly

#### Scenario: Test isolation

- **WHEN** multiple test runs occur concurrently
- **THEN** each run SHALL use a unique temporary directory
- **AND** no shared state SHALL cause test interference

### Requirement: Documentation Accuracy

The README documentation SHALL accurately reflect the current implementation behavior.

#### Scenario: Memory management documentation

- **WHEN** the README describes session context storage
- **THEN** it SHALL describe the actual Map-based implementation with cleanup policy
- **AND** it SHALL NOT claim WeakMap usage

#### Scenario: File operation documentation

- **WHEN** the README describes file reading behavior
- **THEN** it SHALL accurately describe synchronous file reads
- **AND** it SHALL NOT claim async file operations if sync operations are used

#### Scenario: Debug logging documentation

- **WHEN** debug logging is available
- **THEN** the README SHALL document the `OPENCODE_RULES_DEBUG` environment variable
- **AND** it SHALL explain what information is logged

#### Scenario: Prompt extraction documentation

- **WHEN** the system extracts user prompts for keyword matching
- **THEN** the README SHALL document the "latest non-synthetic user text" behavior
- **AND** it SHALL explain how synthetic messages are excluded

