# package-setup Spec Delta

## MODIFIED Requirements

### Requirement: TypeScript Package Configuration

The project SHALL be configured as a TypeScript package with proper build tooling, OpenCode v2 dependencies, and strict type safety. Hook handlers SHALL use properly typed interfaces matching the `@opencode-ai/plugin` v2 API.

#### Scenario: Package initialization

- **WHEN** the repository is set up
- **THEN** package.json SHALL exist with TypeScript configuration
- **AND** @opencode-ai/plugin SHALL be listed as a peer dependency pinned to the beta channel version
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
- **AND** package exports SHALL map "." to the compiled server entry and "./tui" to the compiled TUI entry

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
- **AND** types SHALL match the `@opencode-ai/plugin` v2 hook payloads
- **AND** handlers SHALL mutate payload fields in place

#### Scenario: Test mock compatibility

- **WHEN** test mocks are created for the v2 plugin context
- **THEN** mocks SHALL include session and tool hook registrars
- **AND** TypeScript compilation SHALL succeed without type errors
