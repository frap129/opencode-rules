# Project Context

## Purpose

opencode-rules is a plugin for opencode that enables loading rules files from "$XDG*CONFIG_HOME/opencode/rules/*.md" and the project ".opencode/rules/\_.md" by default. This allows for easy rules management without having to add a per-project config setting it up for every project. The main goal is to deliver rules as silent messages (using the `noReply` pattern) to sessions when they are created or compacted, ensuring rules are always present in the AI agent's context.

## Tech Stack

- **TypeScript** - Primary programming language
- **@opencode-ai/plugin** - OpenCode plugin framework
- **Bun** - Package manager and build tool
- **Node.js** - Runtime environment

## Project Conventions

### Code Style

- **Formatter**: Prettier with default configuration
- **Naming**: camelCase for variables and functions, PascalCase for classes/types
- **File structure**: Flat structure for simple project, organized by feature
- **Imports**: Use ES6 import/export syntax

### Architecture Patterns

- **Lightweight and flexible architecture** - Simple enough to avoid heavy patterns
- **Plugin-based design** - Built on OpenCode plugin framework
- **Event-driven architecture** - Responds to session lifecycle events (creation, compaction)
- **Silent message pattern** - Uses `noReply: true` to inject context without AI responses
- **File discovery pattern** - Efficient directory scanning and file loading
- **Integration focus** - Minimal business logic, primarily integration with OpenCode

### Testing Strategy

- **Framework**: Vitest (recommended for TypeScript projects)
- **Primary focus**: Unit tests for core functionality
- **Coverage**: File discovery, rule loading, and integration points
- **Test structure**: Co-located with source files or in dedicated test/ directory

### Git Workflow

- **Branching strategy**: Clean main branch with merged feature branches
- **Commit format**: Conventional Commits (feat:, fix:, docs:, etc.)
- **Pull requests**: Required for all changes to main branch
- **Release**: Semantic versioning based on commit types

## Domain Context

This project is an OpenCode plugin that delivers custom rules to AI agents via silent messages. Key domain concepts:

- **Rules files**: Markdown files containing rules or instructions for AI agents
- **XDG_CONFIG_HOME**: Standard user configuration directory (typically ~/.config)
- **Project-specific rules**: Local .opencode/rules/ directory for project-level customization
- **Silent messages**: Messages sent with `noReply: true` to add context without triggering AI responses
- **Session lifecycle events**: `session.created` and `session.compacted` events that trigger rule delivery
- **File discovery**: Efficient scanning and loading of rule files from multiple sources
- **Conditional rules**: Rules with glob patterns that apply only to specific file contexts

## Important Constraints

- **Performance**: Rule file discovery should be well optimized to minimize startup time
- **Compatibility**: Must work with existing OpenCode plugin ecosystem
- **Simplicity**: Maintain lightweight architecture suitable for a focused utility plugin

## External Dependencies

- **@opencode-ai/plugin**: Core OpenCode plugin framework
- **@opencode-ai/sdk**: OpenCode SDK for integration
- **Node.js fs module**: File system operations for rule discovery
- **XDG Base Directory specification**: For config directory resolution
