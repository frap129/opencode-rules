## ADDED Requirements
### Requirement: TypeScript Package Configuration
The project SHALL be configured as a TypeScript package with proper build tooling and OpenCode dependencies.

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