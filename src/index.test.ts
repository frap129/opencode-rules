import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import {
  discoverRuleFiles,
  readAndFormatRules,
  parseRuleMetadata,
  extractFilePathsFromMessages,
  promptMatchesKeywords,
  toolsMatchAvailable,
  clearRuleCache,
  type DiscoveredRule,
} from './utils.js';
import * as utilsModule from './utils.js';
import * as sessionStoreModule from './session-store.js';
import { __testOnly } from './index.js';

// Test directories - initialized in setupTestDirs
let testDir: string;
let globalRulesDir: string;
let projectRulesDir: string;

/**
 * Helper to convert file paths to DiscoveredRule objects for testing
 */
function toRules(paths: string[]): DiscoveredRule[] {
  return paths.map(filePath => ({
    filePath,
    relativePath: path.basename(filePath),
  }));
}

function setupTestDirs() {
  // Create a unique temporary directory for each test run
  testDir = mkdtempSync(path.join(os.tmpdir(), 'opencode-rules-test-'));
  globalRulesDir = path.join(testDir, '.config', 'opencode', 'rules');
  projectRulesDir = path.join(testDir, 'project', '.opencode', 'rules');
  mkdirSync(globalRulesDir, { recursive: true });
  mkdirSync(projectRulesDir, { recursive: true });
}

function teardownTestDirs() {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

describe('extractFilePathsFromMessages', () => {
  it('should extract file paths from read tool invocations', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'read',
              args: { filePath: 'src/utils.ts' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/utils.ts');
  });

  it('should extract file paths from edit tool invocations', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'edit',
              args: { filePath: 'src/components/Button.tsx' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/components/Button.tsx');
  });

  it('should extract file paths from write tool invocations', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'write',
              args: { filePath: 'test/data.json' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('test/data.json');
  });

  it('should extract directory from glob pattern arguments', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'glob',
              args: { pattern: 'src/components/**/*.ts' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/components');
  });

  it('should extract directory from glob pattern in path argument', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'glob',
              args: { path: 'src/lib' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/lib');
  });

  it('should only extract path argument from grep, not include patterns', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'grep',
              args: { include: '*.ts', path: 'src' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src');
    // Verify that include pattern '*.ts' is not extracted
    expect(paths).not.toContain('*.ts');
  });

  it('should extract file paths from text content using regex', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: 'I modified src/utils/helpers.ts and lib/helpers.js',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/utils/helpers.ts');
    expect(paths).toContain('lib/helpers.js');
  });

  it('should extract paths with relative path prefixes', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: 'Updated ./src/app.ts and ../config.js',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('./src/app.ts');
    expect(paths).toContain('../config.js');
  });

  it('should extract paths with absolute path prefixes', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: 'Check /etc/config and /home/user/project/src/main.ts',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('/etc/config');
    expect(paths).toContain('/home/user/project/src/main.ts');
  });

  it('should filter out URLs from text extraction', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: 'Visit https://github.com/user/repo or check src/main.ts',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).not.toContainEqual(expect.stringContaining('://'));
    expect(paths).toContain('src/main.ts');
  });

  it('should filter out email addresses from text extraction', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: 'Email user@example.com or check src/config/app.ts',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).not.toContainEqual(expect.stringContaining('@'));
    expect(paths).toContain('src/config/app.ts');
  });

  it('should deduplicate extracted paths', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'read',
              args: { filePath: 'src/utils.ts' },
            },
          },
          {
            type: 'text' as const,
            text: 'Also see src/utils.ts for more details',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe('src/utils.ts');
  });

  it('should handle empty messages', () => {
    // Arrange
    const messages: any[] = [];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toEqual([]);
  });

  it('should handle messages with empty parts', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toEqual([]);
  });

  it('should ignore unknown tool names', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'unknown-tool',
              args: { filePath: 'some/file.ts' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toEqual([]);
  });

  it('should handle multiple messages and parts', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'read',
              args: { filePath: 'src/utils.ts' },
            },
          },
          {
            type: 'text' as const,
            text: 'Checked lib/helpers.js',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'text' as const,
            text: 'Modified src/components/Button.tsx',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toHaveLength(3);
    expect(paths).toContain('src/utils.ts');
    expect(paths).toContain('lib/helpers.js');
    expect(paths).toContain('src/components/Button.tsx');
  });

  it('should handle glob patterns with nested directories', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'glob',
              args: { pattern: 'src/deeply/nested/path/**/*.{ts,tsx}' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/deeply/nested/path');
  });

  it('should handle glob patterns with wildcards at different positions', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'glob',
              args: { pattern: '**/*.test.ts' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    // When pattern starts with glob, should not extract anything
    expect(paths).toEqual([]);
  });

  it('should ignore empty string arguments', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'read',
              args: { filePath: '' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toEqual([]);
  });

  it('should extract paths with various extensions', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: 'Edited src/app.ts src/config.json lib/utils.js docs/readme.md',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/app.ts');
    expect(paths).toContain('src/config.json');
    expect(paths).toContain('lib/utils.js');
    expect(paths).toContain('docs/readme.md');
  });

  it('should trim trailing periods from extracted paths', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: 'Check src/index.ts. It has the implementation.',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/index.ts');
    expect(paths).not.toContain('src/index.ts.');
  });

  it('should trim trailing commas from extracted paths', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: 'Modified src/utils.ts, lib/helpers.js, and docs/guide.md',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/utils.ts');
    expect(paths).toContain('lib/helpers.js');
    expect(paths).toContain('docs/guide.md');
    expect(paths).not.toContain('src/utils.ts,');
  });

  it('should trim multiple trailing punctuation marks from extracted paths', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: 'Updated src/app.ts!!! src/config.json?? lib/utils.js:: docs/readme.md;',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/app.ts');
    expect(paths).toContain('src/config.json');
    expect(paths).toContain('lib/utils.js');
    expect(paths).toContain('docs/readme.md');
  });

  it('should handle glob patterns without slashes', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'glob',
              args: { pattern: 'test*' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    // When pattern has glob characters but no slashes, should not extract file prefix
    expect(paths).toEqual([]);
  });

  it('should extract directory from glob patterns without glob in directory part', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'tool-invocation' as const,
            toolInvocation: {
              toolName: 'glob',
              args: { pattern: 'src/test*' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    // Pattern has slashes before glob, so should extract the directory
    expect(paths).toContain('src');
  });
});

describe('promptMatchesKeywords', () => {
  it('should return true when keyword matches prompt', () => {
    expect(
      promptMatchesKeywords('I need help testing this function', ['testing'])
    ).toBe(true);
  });

  it('should return false when keyword does not match prompt', () => {
    expect(
      promptMatchesKeywords('help me with the database', ['testing', 'jest'])
    ).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(promptMatchesKeywords('testing', ['Testing'])).toBe(true);
    expect(promptMatchesKeywords('TESTING', ['testing'])).toBe(true);
  });

  it('should match at word boundaries (start of word)', () => {
    // "test" should match "testing" (word boundary at start, keyword is prefix)
    expect(promptMatchesKeywords('I am testing this', ['test'])).toBe(true);
  });

  it('should not match mid-word', () => {
    // "test" should NOT match "contest" (not at word boundary)
    expect(promptMatchesKeywords('I entered a contest', ['test'])).toBe(false);
  });

  it('should handle multi-word keywords', () => {
    expect(
      promptMatchesKeywords('I need help with unit test coverage', [
        'unit test',
      ])
    ).toBe(true);
  });

  it('should return true if any keyword matches (OR logic)', () => {
    expect(
      promptMatchesKeywords('please help with jest', [
        'testing',
        'jest',
        'vitest',
      ])
    ).toBe(true);
  });

  it('should return false for empty keywords array', () => {
    expect(promptMatchesKeywords('some prompt', [])).toBe(false);
  });

  it('should return false for empty prompt', () => {
    expect(promptMatchesKeywords('', ['testing'])).toBe(false);
  });

  it('should escape special regex characters in keywords', () => {
    // "test.ts" keyword should match literally (dot is escaped)
    expect(promptMatchesKeywords('file.test.ts', ['test.ts'])).toBe(true);
    // Verify that without escaping, ".ts" would match anything like "tests" (but it doesn't)
    expect(promptMatchesKeywords('run tests now', ['test.ts'])).toBe(false);
  });
});

describe('toolsMatchAvailable', () => {
  it('should return true when required tool is available', () => {
    const available = ['mcp_bash', 'mcp_read', 'mcp_websearch'];
    expect(toolsMatchAvailable(available, ['mcp_websearch'])).toBe(true);
  });

  it('should return false when required tool is not available', () => {
    const available = ['mcp_bash', 'mcp_read'];
    expect(toolsMatchAvailable(available, ['mcp_websearch'])).toBe(false);
  });

  it('should return true if any required tool is available (OR logic)', () => {
    const available = ['mcp_bash', 'mcp_read'];
    expect(toolsMatchAvailable(available, ['mcp_websearch', 'mcp_bash'])).toBe(
      true
    );
  });

  it('should return false for empty required tools', () => {
    const available = ['mcp_bash', 'mcp_read'];
    expect(toolsMatchAvailable(available, [])).toBe(false);
  });

  it('should return false for empty available tools', () => {
    expect(toolsMatchAvailable([], ['mcp_websearch'])).toBe(false);
  });

  it('should use exact string matching', () => {
    const available = ['mcp_websearch_v2'];
    // Should not match partial strings
    expect(toolsMatchAvailable(available, ['mcp_websearch'])).toBe(false);
    expect(toolsMatchAvailable(available, ['mcp_websearch_v2'])).toBe(true);
  });

  it('should handle multiple required and available tools efficiently', () => {
    const available = ['tool_a', 'tool_b', 'tool_c', 'tool_d', 'tool_e'];
    const required = ['tool_x', 'tool_y', 'tool_c']; // tool_c matches
    expect(toolsMatchAvailable(available, required)).toBe(true);
  });
});

describe('parseRuleMetadata', () => {
  it('should parse YAML metadata from .mdc files', () => {
    // Arrange
    const content = `---
globs:
  - "src/components/**/*.ts"
---

This is a rule for TypeScript components.`;

    // Act
    const metadata = parseRuleMetadata(content);

    // Assert
    expect(metadata).toBeDefined();
    expect(metadata?.globs).toEqual(['src/components/**/*.ts']);
  });

  it('should return undefined for files without metadata', () => {
    // Arrange
    const content = 'This rule should always apply.';

    // Act
    const metadata = parseRuleMetadata(content);

    // Assert
    expect(metadata).toBeUndefined();
  });

  it('should extract rule content without metadata', () => {
    // Arrange
    const content = `---
globs:
  - "src/**/*.ts"
---

Rule content here`;

    // Act
    const metadata = parseRuleMetadata(content);
    const ruleContent = content.replace(/^---[\s\S]*?---\n/, '');

    // Assert
    expect(metadata?.globs).toBeDefined();
    expect(ruleContent).toBe('\nRule content here');
  });

  it('should handle multiple globs in metadata', () => {
    // Arrange
    const content = `---
globs:
  - "src/**/*.ts"
  - "lib/**/*.js"
---

Rule content`;

    // Act
    const metadata = parseRuleMetadata(content);

    // Assert
    expect(metadata?.globs).toEqual(['src/**/*.ts', 'lib/**/*.js']);
  });

  it('should parse keywords from YAML metadata', () => {
    // Arrange
    const content = `---
keywords:
  - "testing"
  - "unit test"
---

Follow testing best practices.`;

    // Act
    const metadata = parseRuleMetadata(content);

    // Assert
    expect(metadata).toBeDefined();
    expect(metadata?.keywords).toEqual(['testing', 'unit test']);
  });

  it('should parse both globs and keywords from metadata', () => {
    // Arrange
    const content = `---
globs:
  - "**/*.test.ts"
keywords:
  - "testing"
---

Testing rule content.`;

    // Act
    const metadata = parseRuleMetadata(content);

    // Assert
    expect(metadata?.globs).toEqual(['**/*.test.ts']);
    expect(metadata?.keywords).toEqual(['testing']);
  });

  it('should handle keywords before globs in YAML', () => {
    // Arrange
    const content = `---
keywords:
  - "refactor"
globs:
  - "src/**/*.ts"
---

Refactoring rules.`;

    // Act
    const metadata = parseRuleMetadata(content);

    // Assert
    expect(metadata?.keywords).toEqual(['refactor']);
    expect(metadata?.globs).toEqual(['src/**/*.ts']);
  });

  it('should parse tools from YAML metadata', () => {
    // Arrange
    const content = `---
tools:
  - "mcp_websearch"
  - "mcp_codesearch"
---

Use web search best practices.`;

    // Act
    const metadata = parseRuleMetadata(content);

    // Assert
    expect(metadata).toBeDefined();
    expect(metadata?.tools).toEqual(['mcp_websearch', 'mcp_codesearch']);
  });

  it('should parse tools alongside globs and keywords', () => {
    // Arrange
    const content = `---
globs:
  - "**/*.test.ts"
keywords:
  - "testing"
tools:
  - "mcp_bash"
---

Testing rule with all conditions.`;

    // Act
    const metadata = parseRuleMetadata(content);

    // Assert
    expect(metadata?.globs).toEqual(['**/*.test.ts']);
    expect(metadata?.keywords).toEqual(['testing']);
    expect(metadata?.tools).toEqual(['mcp_bash']);
  });

  it('should handle tools-only metadata', () => {
    // Arrange
    const content = `---
tools:
  - "mcp_lsp"
---

LSP-specific guidelines.`;

    // Act
    const metadata = parseRuleMetadata(content);

    // Assert
    expect(metadata).toBeDefined();
    expect(metadata?.tools).toEqual(['mcp_lsp']);
    expect(metadata?.globs).toBeUndefined();
    expect(metadata?.keywords).toBeUndefined();
  });

  it('should parse block list model and agent filters', () => {
    const content = `---
model:
  - gpt-5.3-codex
agent:
  - programmer
---
rule`;

    expect(parseRuleMetadata(content)).toEqual({
      model: ['gpt-5.3-codex'],
      agent: ['programmer'],
    });
  });

  it('should parse command, project, branch, os arrays', () => {
    const content = `---
command:
  - /plan
  - /review
project:
  - node
  - monorepo
branch:
  - feature/*
  - main
os:
  - linux
  - darwin
---
rule`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.command).toEqual(['/plan', '/review']);
    expect(metadata?.project).toEqual(['node', 'monorepo']);
    expect(metadata?.branch).toEqual(['feature/*', 'main']);
    expect(metadata?.os).toEqual(['linux', 'darwin']);
  });

  it('should parse ci boolean as true', () => {
    const content = `---
ci: true
---
rule`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.ci).toBe(true);
  });

  it('should parse ci boolean as false', () => {
    const content = `---
ci: false
---
rule`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.ci).toBe(false);
  });

  it('should ignore non-boolean ci values', () => {
    const content = `---
ci: "yes"
---
rule`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.ci).toBeUndefined();
  });

  it('should parse match as any', () => {
    const content = `---
model:
  - gpt-5
match: any
---
rule`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.match).toBe('any');
  });

  it('should parse match as all', () => {
    const content = `---
model:
  - gpt-5
match: all
---
rule`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.match).toBe('all');
  });

  it('should ignore invalid match values', () => {
    const content = `---
model:
  - gpt-5
match: invalid
---
rule`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.match).toBeUndefined();
    expect(metadata?.model).toEqual(['gpt-5']);
  });

  it('should handle all new filters combined', () => {
    const content = `---
globs:
  - "**/*.ts"
model:
  - claude-opus
agent:
  - coder
command:
  - /plan
project:
  - node
branch:
  - main
os:
  - linux
ci: true
match: all
---
Combined rule`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.globs).toEqual(['**/*.ts']);
    expect(metadata?.model).toEqual(['claude-opus']);
    expect(metadata?.agent).toEqual(['coder']);
    expect(metadata?.command).toEqual(['/plan']);
    expect(metadata?.project).toEqual(['node']);
    expect(metadata?.branch).toEqual(['main']);
    expect(metadata?.os).toEqual(['linux']);
    expect(metadata?.ci).toBe(true);
    expect(metadata?.match).toBe('all');
  });
});

describe('discoverRuleFiles', () => {
  beforeEach(() => {
    setupTestDirs();
  });

  afterEach(() => {
    teardownTestDirs();
    vi.resetAllMocks();
  });

  describe('global rules discovery', () => {
    it('should discover markdown files from XDG_CONFIG_HOME/opencode/rules', async () => {
      // Arrange
      writeFileSync(path.join(globalRulesDir, 'rule1.md'), '# Rule 1');
      writeFileSync(path.join(globalRulesDir, 'rule2.md'), '# Rule 2');

      // Mock XDG_CONFIG_HOME
      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act
        const files = await discoverRuleFiles();

        // Assert
        expect(
          files.some(f => f.filePath === path.join(globalRulesDir, 'rule1.md'))
        ).toBe(true);
        expect(
          files.some(f => f.filePath === path.join(globalRulesDir, 'rule2.md'))
        ).toBe(true);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should use ~/.config/opencode/rules as fallback when XDG_CONFIG_HOME not set', async () => {
      // Arrange
      const homeDir = path.join(testDir, 'home');
      mkdirSync(homeDir, { recursive: true });
      const fallbackDir = path.join(homeDir, '.config', 'opencode', 'rules');
      mkdirSync(fallbackDir, { recursive: true });
      writeFileSync(path.join(fallbackDir, 'rule.md'), '# Rule');

      // Mock environment
      const originalHome = process.env.HOME;
      const originalXDG = process.env.XDG_CONFIG_HOME;
      process.env.HOME = homeDir;
      delete process.env.XDG_CONFIG_HOME;

      try {
        // Act
        const files = await discoverRuleFiles();

        // Assert
        expect(
          files.some(f => f.filePath === path.join(fallbackDir, 'rule.md'))
        ).toBe(true);
      } finally {
        process.env.HOME = originalHome;
        process.env.XDG_CONFIG_HOME = originalXDG;
      }
    });

    it('should handle missing global rules directory gracefully', async () => {
      // Arrange
      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Remove the directory to test graceful handling
        rmSync(globalRulesDir, { recursive: true, force: true });

        // Act & Assert - should not throw
        const files = await discoverRuleFiles();
        expect(files).toEqual([]);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should include both .md and .mdc files', async () => {
      // Arrange
      writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule');
      writeFileSync(
        path.join(globalRulesDir, 'rule.mdc'),
        '# Rule with metadata'
      );
      writeFileSync(path.join(globalRulesDir, 'rule.txt'), 'Not markdown');
      writeFileSync(path.join(globalRulesDir, 'rule.json'), '{}');

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act
        const files = await discoverRuleFiles();

        // Assert
        expect(files).toHaveLength(2);
        expect(files.some(f => f.filePath.endsWith('.md'))).toBe(true);
        expect(files.some(f => f.filePath.endsWith('.mdc'))).toBe(true);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should exclude hidden files', async () => {
      // Arrange
      writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule');
      writeFileSync(path.join(globalRulesDir, '.hidden.md'), '# Hidden');

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act
        const files = await discoverRuleFiles();

        // Assert
        expect(files.every(f => !f.filePath.includes('.hidden.md'))).toBe(true);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });
  });

  describe('project rules discovery', () => {
    it('should discover markdown files from .opencode/rules directory', async () => {
      // Arrange
      const projectDir = path.join(testDir, 'project');
      mkdirSync(projectDir, { recursive: true });
      const projRulesDir = path.join(projectDir, '.opencode', 'rules');
      mkdirSync(projRulesDir, { recursive: true });
      writeFileSync(path.join(projRulesDir, 'local-rule.md'), '# Local Rule');

      // Act
      const files = await discoverRuleFiles(projectDir);

      // Assert
      expect(
        files.some(f => f.filePath === path.join(projRulesDir, 'local-rule.md'))
      ).toBe(true);
    });

    it('should handle missing .opencode directory gracefully', async () => {
      // Arrange
      const projectDir = path.join(testDir, 'empty-project');
      mkdirSync(projectDir, { recursive: true });

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act & Assert - should not throw
        const files = await discoverRuleFiles(projectDir);
        // Should return empty since we set XDG_CONFIG_HOME to test dir with no rules
        expect(files).toEqual([]);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should discover rules from both global and project directories', async () => {
      // Arrange
      writeFileSync(path.join(globalRulesDir, 'global.md'), '# Global');

      const projectDir = path.join(testDir, 'project');
      mkdirSync(projectDir, { recursive: true });
      const projRulesDir = path.join(projectDir, '.opencode', 'rules');
      mkdirSync(projRulesDir, { recursive: true });
      writeFileSync(path.join(projRulesDir, 'local.md'), '# Local');

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act
        const files = await discoverRuleFiles(projectDir);

        // Assert
        expect(files).toHaveLength(2);
        expect(files.some(f => f.filePath.includes('global.md'))).toBe(true);
        expect(files.some(f => f.filePath.includes('local.md'))).toBe(true);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });
  });

  describe('subdirectory scanning', () => {
    it('should discover rules in nested subdirectories', async () => {
      // Arrange
      const nestedDir = path.join(globalRulesDir, 'typescript');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'react.md'), '# React Rules');

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act
        const files = await discoverRuleFiles();

        // Assert
        expect(
          files.some(f => f.filePath === path.join(nestedDir, 'react.md'))
        ).toBe(true);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should discover rules in deeply nested subdirectories (multiple levels)', async () => {
      // Arrange
      const deepDir = path.join(
        globalRulesDir,
        'lang',
        'typescript',
        'framework'
      );
      mkdirSync(deepDir, { recursive: true });
      writeFileSync(path.join(deepDir, 'nextjs.md'), '# Next.js Rules');

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act
        const files = await discoverRuleFiles();

        // Assert
        expect(
          files.some(f => f.filePath === path.join(deepDir, 'nextjs.md'))
        ).toBe(true);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should exclude hidden subdirectories', async () => {
      // Arrange
      const hiddenDir = path.join(globalRulesDir, '.hidden');
      mkdirSync(hiddenDir, { recursive: true });
      writeFileSync(path.join(hiddenDir, 'secret.md'), '# Secret Rule');
      writeFileSync(path.join(globalRulesDir, 'visible.md'), '# Visible Rule');

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act
        const files = await discoverRuleFiles();

        // Assert
        expect(files.every(f => !f.filePath.includes('.hidden'))).toBe(true);
        expect(files.every(f => !f.filePath.includes('secret.md'))).toBe(true);
        expect(
          files.some(
            f => f.filePath === path.join(globalRulesDir, 'visible.md')
          )
        ).toBe(true);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should discover rules from mixed flat and nested structures', async () => {
      // Arrange
      writeFileSync(path.join(globalRulesDir, 'root.md'), '# Root Rule');
      const nestedDir = path.join(globalRulesDir, 'nested');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'child.md'), '# Child Rule');

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act
        const files = await discoverRuleFiles();

        // Assert
        expect(files).toHaveLength(2);
        expect(
          files.some(f => f.filePath === path.join(globalRulesDir, 'root.md'))
        ).toBe(true);
        expect(
          files.some(f => f.filePath === path.join(nestedDir, 'child.md'))
        ).toBe(true);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should discover rules in project subdirectories', async () => {
      // Arrange
      const projectDir = path.join(testDir, 'project');
      const projRulesDir = path.join(projectDir, '.opencode', 'rules');
      const nestedDir = path.join(projRulesDir, 'frontend');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'react.md'), '# React Rules');

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        // Act
        const files = await discoverRuleFiles(projectDir);

        // Assert
        expect(
          files.some(f => f.filePath === path.join(nestedDir, 'react.md'))
        ).toBe(true);
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });
  });
});

describe('readAndFormatRules', () => {
  beforeEach(() => {
    setupTestDirs();
  });

  afterEach(() => {
    teardownTestDirs();
  });

  it('should read and format rule files into a formatted string', async () => {
    // Arrange
    const rule1Path = path.join(globalRulesDir, 'rule1.md');
    const rule2Path = path.join(globalRulesDir, 'rule2.md');
    writeFileSync(rule1Path, '# Rule 1\nContent of rule 1');
    writeFileSync(rule2Path, '# Rule 2\nContent of rule 2');

    const files = toRules([rule1Path, rule2Path]);

    // Act
    const formatted = await readAndFormatRules(files);

    // Assert
    expect(formatted).toContain('OpenCode Rules');
    expect(formatted).toContain('rule1.md');
    expect(formatted).toContain('rule2.md');
    expect(formatted).toContain('Rule 1');
    expect(formatted).toContain('Rule 2');
  });

  it('should return empty string when no files provided', async () => {
    // Act
    const formatted = await readAndFormatRules([]);

    // Assert
    expect(formatted).toBe('');
  });

  it('should handle file read errors gracefully', async () => {
    // Arrange
    const nonExistentFile = path.join(globalRulesDir, 'nonexistent.md');
    const validFile = path.join(globalRulesDir, 'valid.md');
    writeFileSync(validFile, '# Valid Rule');

    // Act & Assert - should not throw
    const formatted = await readAndFormatRules(
      toRules([nonExistentFile, validFile])
    );

    // Should still include the valid file
    expect(formatted).toContain('valid.md');
  });

  it('should include filename as subheader in output', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'my-rules.md');
    writeFileSync(rulePath, 'Rule content');

    // Act
    const formatted = await readAndFormatRules(toRules([rulePath]));

    // Assert
    expect(formatted).toMatch(/##\s+my-rules\.md/);
  });

  it('should include instructions to follow rules', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'rule.md');
    writeFileSync(rulePath, 'Rule content');

    // Act
    const formatted = await readAndFormatRules(toRules([rulePath]));

    // Assert - check for language indicating rules should be followed
    expect(formatted.toLowerCase()).toMatch(
      /follow|adhereread the following rules|must follow/i
    );
  });

  it('should apply rules without metadata unconditionally', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'unconditional.mdc');
    writeFileSync(rulePath, 'This rule always applies');

    // Act
    const formatted = await readAndFormatRules(toRules([rulePath]), [
      'src/utils/helpers.js',
    ]);

    // Assert - rule should be included even though file doesn't match any pattern
    expect(formatted).toContain('unconditional.mdc');
    expect(formatted).toContain('This rule always applies');
  });

  it('should include rule when file matches glob pattern in metadata', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'typescript.mdc');
    const ruleContent = `---
globs:
  - "src/components/**/*.ts"
---

This is a rule for TypeScript components.`;
    writeFileSync(rulePath, ruleContent);

    // Act - testing with a matching file path
    const formatted = await readAndFormatRules(toRules([rulePath]), [
      'src/components/button.ts',
    ]);

    // Assert
    expect(formatted).toContain('typescript.mdc');
    expect(formatted).toContain('This is a rule for TypeScript components.');
  });

  it('should exclude rule when file does not match glob pattern in metadata', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'typescript.mdc');
    const ruleContent = `---
globs:
  - "src/components/**/*.ts"
---

This is a rule for TypeScript components.`;
    writeFileSync(rulePath, ruleContent);

    // Act - testing with a non-matching file path
    const formatted = await readAndFormatRules(toRules([rulePath]), [
      'src/utils/helpers.js',
    ]);

    // Assert - should return empty because rule doesn't apply
    expect(formatted).toBe('');
  });

  it('should include rule when file matches any of multiple glob patterns', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'multi.mdc');
    const ruleContent = `---
globs:
  - "src/components/**/*.ts"
  - "lib/**/*.js"
---

Multi-pattern rule`;
    writeFileSync(rulePath, ruleContent);

    // Act - test with file matching second pattern
    const formatted = await readAndFormatRules(toRules([rulePath]), [
      'lib/utils/helper.js',
    ]);

    // Assert
    expect(formatted).toContain('multi.mdc');
    expect(formatted).toContain('Multi-pattern rule');
  });

  it('should handle mixed rules with and without metadata', async () => {
    // Arrange
    const unconditionalPath = path.join(globalRulesDir, 'always.md');
    const conditionalPath = path.join(globalRulesDir, 'conditional.mdc');

    writeFileSync(unconditionalPath, 'Always apply this');
    writeFileSync(
      conditionalPath,
      `---
globs:
  - "src/**/*.ts"
---

Only for TypeScript`
    );

    // Act - test with matching TypeScript file
    const formatted = await readAndFormatRules(
      toRules([unconditionalPath, conditionalPath]),
      ['src/app.ts']
    );

    // Assert - both should be included
    expect(formatted).toContain('always.md');
    expect(formatted).toContain('Always apply this');
    expect(formatted).toContain('conditional.mdc');
    expect(formatted).toContain('Only for TypeScript');
  });

  it('should exclude conditional rule but include unconditional when file does not match', async () => {
    // Arrange
    const unconditionalPath = path.join(globalRulesDir, 'always.md');
    const conditionalPath = path.join(globalRulesDir, 'conditional.mdc');

    writeFileSync(unconditionalPath, 'Always apply this');
    writeFileSync(
      conditionalPath,
      `---
globs:
  - "src/**/*.ts"
---

Only for TypeScript`
    );

    // Act - test with non-matching file
    const formatted = await readAndFormatRules(
      toRules([unconditionalPath, conditionalPath]),
      ['docs/readme.md']
    );

    // Assert - only unconditional rule should be included
    expect(formatted).toContain('always.md');
    expect(formatted).toContain('Always apply this');
    expect(formatted).not.toContain('Only for TypeScript');
  });

  it('should skip conditional rule when no context is provided', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'conditional.mdc');
    writeFileSync(
      rulePath,
      `---
globs:
  - "src/**/*.ts"
---

TypeScript only rule`
    );

    // Act - no file path provided
    const formatted = await readAndFormatRules(toRules([rulePath]));

    // Assert - rule should NOT be applied (conditions not satisfied)
    expect(formatted).toBe('');
  });

  it('should include rule when user prompt matches keywords', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'testing-rule.mdc');
    writeFileSync(
      rulePath,
      `---
keywords:
  - "testing"
  - "jest"
---

Follow testing best practices.`
    );

    // Act - prompt matches keyword
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      [],
      'I need help testing this function'
    );

    // Assert
    expect(formatted).toContain('testing-rule.mdc');
    expect(formatted).toContain('Follow testing best practices');
  });

  it('should exclude rule when user prompt does not match keywords', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'testing-rule.mdc');
    writeFileSync(
      rulePath,
      `---
keywords:
  - "testing"
  - "jest"
---

Follow testing best practices.`
    );

    // Act - prompt does not match
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      [],
      'help me with the database'
    );

    // Assert
    expect(formatted).toBe('');
  });

  it('should include rule when either keywords OR globs match (keywords match)', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'test-rule.mdc');
    writeFileSync(
      rulePath,
      `---
globs:
  - "**/*.test.ts"
keywords:
  - "testing"
---

Testing standards.`
    );

    // Act - keywords match but no test files in context
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      ['src/app.ts'],
      'help with testing'
    );

    // Assert - rule should be included (keywords matched)
    expect(formatted).toContain('test-rule.mdc');
    expect(formatted).toContain('Testing standards');
  });

  it('should include rule when either keywords OR globs match (globs match)', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'test-rule.mdc');
    writeFileSync(
      rulePath,
      `---
globs:
  - "**/*.test.ts"
keywords:
  - "testing"
---

Testing standards.`
    );

    // Act - globs match but prompt doesn't mention testing
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      ['src/utils.test.ts'],
      'fix the import error'
    );

    // Assert - rule should be included (globs matched)
    expect(formatted).toContain('test-rule.mdc');
    expect(formatted).toContain('Testing standards');
  });

  it('should exclude rule when neither keywords nor globs match', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'test-rule.mdc');
    writeFileSync(
      rulePath,
      `---
globs:
  - "**/*.test.ts"
keywords:
  - "testing"
---

Testing standards.`
    );

    // Act - neither matches
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      ['src/app.ts'],
      'update the readme'
    );

    // Assert - rule should NOT be included
    expect(formatted).toBe('');
  });

  it('should handle case-insensitive keyword matching', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'case-rule.mdc');
    writeFileSync(
      rulePath,
      `---
keywords:
  - "Testing"
---

Testing rule.`
    );

    // Act - lowercase in prompt
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      [],
      'testing in lowercase'
    );

    // Assert
    expect(formatted).toContain('case-rule.mdc');
  });

  it('should match keyword at word boundary (prefix matching)', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'boundary-rule.mdc');
    writeFileSync(
      rulePath,
      `---
keywords:
  - "test"
---

Test rule.`
    );

    // Act - "test" should match "testing"
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      [],
      'I am testing this'
    );

    // Assert
    expect(formatted).toContain('boundary-rule.mdc');
  });

  it('should not match keyword mid-word', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'midword-rule.mdc');
    writeFileSync(
      rulePath,
      `---
keywords:
  - "test"
---

Test rule.`
    );

    // Act - "test" should NOT match "contest"
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      [],
      'I entered a contest'
    );

    // Assert
    expect(formatted).toBe('');
  });

  it('should include rule when tool is available', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'websearch-rule.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - "mcp_websearch"
---

Use web search best practices.`
    );

    // Act - tool is available
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      [],
      undefined,
      ['mcp_bash', 'mcp_websearch', 'mcp_read']
    );

    // Assert
    expect(formatted).toContain('websearch-rule.mdc');
    expect(formatted).toContain('Use web search best practices');
  });

  it('should exclude rule when tool is not available', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'websearch-rule.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - "mcp_websearch"
---

Use web search best practices.`
    );

    // Act - tool is NOT available
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      [],
      undefined,
      ['mcp_bash', 'mcp_read']
    );

    // Assert
    expect(formatted).toBe('');
  });

  it('should include rule when any of multiple tools is available (OR logic)', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'search-rule.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - "mcp_websearch"
  - "mcp_codesearch"
---

Search best practices.`
    );

    // Act - only codesearch is available
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      [],
      undefined,
      ['mcp_bash', 'mcp_codesearch']
    );

    // Assert
    expect(formatted).toContain('search-rule.mdc');
  });

  it('should include rule when tools match OR globs match', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'multi-condition.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - "mcp_lsp"
globs:
  - "**/*.ts"
---

TypeScript or LSP rule.`
    );

    // Act - globs match but tools don't
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      ['src/index.ts'],
      undefined,
      ['mcp_bash']
    );

    // Assert - should be included (globs matched)
    expect(formatted).toContain('multi-condition.mdc');
  });

  it('should include rule when tools match OR keywords match', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'tools-keywords.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - "mcp_websearch"
keywords:
  - "search"
---

Search guidelines.`
    );

    // Act - tools match but keywords don't
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      [],
      'help with database',
      ['mcp_websearch']
    );

    // Assert - should be included (tools matched)
    expect(formatted).toContain('tools-keywords.mdc');
  });

  it('should exclude rule when neither tools nor globs nor keywords match', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'all-conditions.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - "mcp_lsp"
globs:
  - "**/*.ts"
keywords:
  - "typescript"
---

TypeScript with LSP rule.`
    );

    // Act - nothing matches
    const formatted = await readAndFormatRules(
      toRules([rulePath]),
      ['src/index.js'],
      'help with python',
      ['mcp_bash']
    );

    // Assert
    expect(formatted).toBe('');
  });

  it('should skip tool-conditional rule when no tools are provided', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'tool-only.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - "mcp_websearch"
---

Web search only.`
    );

    // Act - no tools provided (simulates tool discovery failure)
    const formatted = await readAndFormatRules(toRules([rulePath]));

    // Assert
    expect(formatted).toBe('');
  });

  it('should include unconditional rules even when tool-conditional rules are skipped', async () => {
    // Arrange
    const unconditionalPath = path.join(globalRulesDir, 'always.md');
    const conditionalPath = path.join(globalRulesDir, 'tool-specific.mdc');

    writeFileSync(unconditionalPath, 'Always apply this');
    writeFileSync(
      conditionalPath,
      `---
tools:
  - "mcp_websearch"
---

Only with websearch.`
    );

    // Act - websearch not available
    const formatted = await readAndFormatRules(
      toRules([unconditionalPath, conditionalPath]),
      [],
      undefined,
      ['mcp_bash']
    );

    // Assert - only unconditional rule included
    expect(formatted).toContain('always.md');
    expect(formatted).toContain('Always apply this');
    expect(formatted).not.toContain('Only with websearch');
  });

  describe('legacy compatibility', () => {
    it('should preserve prompt and tools when second arg is undefined', async () => {
      // Arrange: rule with tools condition
      const rulePath = path.join(globalRulesDir, 'legacy-tools.mdc');
      writeFileSync(
        rulePath,
        `---
tools:
  - mcp_websearch
---

Legacy tools rule.`
      );

      // Act: call with (files, undefined, prompt, tools) - legacy pattern
      const formatted = await readAndFormatRules(
        toRules([rulePath]),
        undefined,
        'some prompt',
        ['mcp_websearch', 'mcp_bash']
      );

      // Assert: tool-conditional rule should be included
      expect(formatted).toContain('legacy-tools.mdc');
      expect(formatted).toContain('Legacy tools rule');
    });

    it('should preserve prompt when second arg is undefined (keywords match)', async () => {
      // Arrange: rule with keywords condition
      const rulePath = path.join(globalRulesDir, 'legacy-keywords.mdc');
      writeFileSync(
        rulePath,
        `---
keywords:
  - testing
---

Legacy keywords rule.`
      );

      // Act: call with (files, undefined, prompt, tools)
      const formatted = await readAndFormatRules(
        toRules([rulePath]),
        undefined,
        'help with testing',
        []
      );

      // Assert: keyword-conditional rule should be included
      expect(formatted).toContain('legacy-keywords.mdc');
      expect(formatted).toContain('Legacy keywords rule');
    });
  });

  describe('new filter dimensions', () => {
    it('should include rule when model matches', async () => {
      const rulePath = path.join(globalRulesDir, 'model-rule.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - gpt-5.3-codex
  - claude-opus
---

Model-specific rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
      });

      expect(formatted).toContain('model-rule.mdc');
      expect(formatted).toContain('Model-specific rule');
    });

    it('should exclude rule when model does not match', async () => {
      const rulePath = path.join(globalRulesDir, 'model-rule.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - gpt-5.3-codex
---

Model-specific rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
      });

      expect(formatted).toBe('');
    });

    it('should include rule when agent matches', async () => {
      const rulePath = path.join(globalRulesDir, 'agent-rule.mdc');
      writeFileSync(
        rulePath,
        `---
agent:
  - programmer
  - coder
---

Agent-specific rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        agentType: 'programmer',
      });

      expect(formatted).toContain('agent-rule.mdc');
      expect(formatted).toContain('Agent-specific rule');
    });

    it('should include rule when command matches', async () => {
      const rulePath = path.join(globalRulesDir, 'command-rule.mdc');
      writeFileSync(
        rulePath,
        `---
command:
  - /plan
  - /review
---

Command-specific rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        command: '/plan',
      });

      expect(formatted).toContain('command-rule.mdc');
      expect(formatted).toContain('Command-specific rule');
    });

    it('should include rule when project tag matches', async () => {
      const rulePath = path.join(globalRulesDir, 'project-rule.mdc');
      writeFileSync(
        rulePath,
        `---
project:
  - node
  - monorepo
---

Node project rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        projectTags: ['node', 'typescript'],
      });

      expect(formatted).toContain('project-rule.mdc');
      expect(formatted).toContain('Node project rule');
    });

    it('should include rule when branch matches exactly', async () => {
      const rulePath = path.join(globalRulesDir, 'branch-rule.mdc');
      writeFileSync(
        rulePath,
        `---
branch:
  - main
  - develop
---

Main branch rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        gitBranch: 'main',
      });

      expect(formatted).toContain('branch-rule.mdc');
      expect(formatted).toContain('Main branch rule');
    });

    it('should include rule when branch matches glob pattern', async () => {
      const rulePath = path.join(globalRulesDir, 'branch-glob-rule.mdc');
      writeFileSync(
        rulePath,
        `---
branch:
  - feature/*
  - hotfix/*
---

Feature branch rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        gitBranch: 'feature/add-login',
      });

      expect(formatted).toContain('branch-glob-rule.mdc');
      expect(formatted).toContain('Feature branch rule');
    });

    it('should NOT match branch exact pattern against nested basename', async () => {
      const rulePath = path.join(globalRulesDir, 'branch-exact-rule.mdc');
      writeFileSync(
        rulePath,
        `---
branch:
  - main
---

Main branch only rule.`
      );

      // branch "main" should NOT match "feature/main" (no basename matching)
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        gitBranch: 'feature/main',
      });

      expect(formatted).toBe('');
    });

    it('should match branch glob pattern correctly without basename overmatch', async () => {
      const rulePath = path.join(globalRulesDir, 'branch-glob-exact.mdc');
      writeFileSync(
        rulePath,
        `---
branch:
  - "feature/*"
---

Feature branch pattern rule.`
      );

      // "feature/*" should NOT match "prefix/feature/main" (no matchBase)
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        gitBranch: 'prefix/feature/main',
      });

      expect(formatted).toBe('');
    });

    it('should include rule when os matches', async () => {
      const rulePath = path.join(globalRulesDir, 'os-rule.mdc');
      writeFileSync(
        rulePath,
        `---
os:
  - linux
  - darwin
---

Unix-specific rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        os: 'linux',
      });

      expect(formatted).toContain('os-rule.mdc');
      expect(formatted).toContain('Unix-specific rule');
    });

    it('should include rule when ci is true and rule requires ci', async () => {
      const rulePath = path.join(globalRulesDir, 'ci-rule.mdc');
      writeFileSync(
        rulePath,
        `---
ci: true
---

CI-specific rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        ci: true,
      });

      expect(formatted).toContain('ci-rule.mdc');
      expect(formatted).toContain('CI-specific rule');
    });

    it('should exclude rule when ci is false but rule requires ci', async () => {
      const rulePath = path.join(globalRulesDir, 'ci-rule.mdc');
      writeFileSync(
        rulePath,
        `---
ci: true
---

CI-specific rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        ci: false,
      });

      expect(formatted).toBe('');
    });

    it('should include rule when ci is false and rule requires non-ci', async () => {
      const rulePath = path.join(globalRulesDir, 'local-rule.mdc');
      writeFileSync(
        rulePath,
        `---
ci: false
---

Local development rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        ci: false,
      });

      expect(formatted).toContain('local-rule.mdc');
      expect(formatted).toContain('Local development rule');
    });
  });

  describe('match: any|all behavior', () => {
    it('should use match: any by default (include when any dimension matches)', async () => {
      const rulePath = path.join(globalRulesDir, 'any-default.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - gpt-5
agent:
  - programmer
os:
  - linux
---

Default any match rule.`
      );

      // model does NOT match, agent does NOT match, but os DOES match
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
        agentType: 'reviewer',
        os: 'linux',
      });

      expect(formatted).toContain('any-default.mdc');
      expect(formatted).toContain('Default any match rule');
    });

    it('should respect explicit match: any', async () => {
      const rulePath = path.join(globalRulesDir, 'explicit-any.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - gpt-5
agent:
  - programmer
match: any
---

Explicit any match rule.`
      );

      // model matches, agent does not
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'gpt-5',
        agentType: 'reviewer',
      });

      expect(formatted).toContain('explicit-any.mdc');
      expect(formatted).toContain('Explicit any match rule');
    });

    it('should require all declared dimensions when match is all', async () => {
      const rulePath = path.join(globalRulesDir, 'all-match.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - claude-opus
agent:
  - programmer
os:
  - linux
match: all
---

All dimensions must match.`
      );

      // model matches, agent matches, os matches => included
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
        agentType: 'programmer',
        os: 'linux',
      });

      expect(formatted).toContain('all-match.mdc');
      expect(formatted).toContain('All dimensions must match');
    });

    it('should exclude rule when match: all and one dimension fails', async () => {
      const rulePath = path.join(globalRulesDir, 'all-match-fail.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - claude-opus
agent:
  - programmer
os:
  - linux
match: all
---

All dimensions must match.`
      );

      // model matches, agent matches, os does NOT match => excluded
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
        agentType: 'programmer',
        os: 'darwin',
      });

      expect(formatted).toBe('');
    });
  });

  describe('mixed legacy and new filter behavior', () => {
    it('should include rule when legacy globs match even if new filters do not', async () => {
      const rulePath = path.join(globalRulesDir, 'mixed-legacy.mdc');
      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.ts"
model:
  - gpt-5
---

Mixed legacy rule.`
      );

      // globs match, model does not => included (match: any default)
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/index.ts'],
        modelID: 'claude-opus',
      });

      expect(formatted).toContain('mixed-legacy.mdc');
      expect(formatted).toContain('Mixed legacy rule');
    });

    it('should include rule when keywords match even if new filters do not', async () => {
      const rulePath = path.join(globalRulesDir, 'mixed-keywords.mdc');
      writeFileSync(
        rulePath,
        `---
keywords:
  - testing
agent:
  - programmer
---

Testing keyword rule.`
      );

      // keywords match, agent does not => included (match: any default)
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        userPrompt: 'help with testing',
        agentType: 'reviewer',
      });

      expect(formatted).toContain('mixed-keywords.mdc');
      expect(formatted).toContain('Testing keyword rule');
    });

    it('should include rule when tools match even if new filters do not', async () => {
      const rulePath = path.join(globalRulesDir, 'mixed-tools.mdc');
      writeFileSync(
        rulePath,
        `---
tools:
  - mcp_websearch
os:
  - windows
---

Websearch tool rule.`
      );

      // tools match, os does not => included (match: any default)
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        availableToolIDs: ['mcp_websearch', 'mcp_bash'],
        os: 'linux',
      });

      expect(formatted).toContain('mixed-tools.mdc');
      expect(formatted).toContain('Websearch tool rule');
    });

    it('should require all dimensions with match: all including legacy filters', async () => {
      const rulePath = path.join(globalRulesDir, 'all-legacy.mdc');
      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.ts"
keywords:
  - refactor
model:
  - claude-opus
match: all
---

All must match including legacy.`
      );

      // globs match, keywords match, model matches => included
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/utils.ts'],
        userPrompt: 'help me refactor this code',
        modelID: 'claude-opus',
      });

      expect(formatted).toContain('all-legacy.mdc');
      expect(formatted).toContain('All must match including legacy');
    });

    it('should exclude with match: all if any legacy filter fails', async () => {
      const rulePath = path.join(globalRulesDir, 'all-legacy-fail.mdc');
      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.ts"
keywords:
  - testing
model:
  - claude-opus
match: all
---

All must match including legacy.`
      );

      // globs match, keywords do NOT match, model matches => excluded
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/utils.ts'],
        userPrompt: 'help me refactor this code',
        modelID: 'claude-opus',
      });

      expect(formatted).toBe('');
    });
  });

  describe('missing runtime fields', () => {
    it('should treat missing modelID as non-match for model dimension', async () => {
      const rulePath = path.join(globalRulesDir, 'model-only.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - gpt-5
---

Model rule.`
      );

      // No modelID provided => model dimension is non-match
      const formatted = await readAndFormatRules(toRules([rulePath]), {});

      expect(formatted).toBe('');
    });

    it('should not throw when runtime context is missing fields', async () => {
      const rulePath = path.join(globalRulesDir, 'many-dimensions.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - gpt-5
agent:
  - programmer
os:
  - linux
---

Multi-dimension rule.`
      );

      // Only os provided, model and agent missing => should not throw
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        os: 'linux',
      });

      // os matches => included with match: any
      expect(formatted).toContain('many-dimensions.mdc');
    });

    it('should exclude with match: all if runtime field is missing', async () => {
      const rulePath = path.join(globalRulesDir, 'all-missing.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - claude-opus
agent:
  - programmer
match: all
---

All match with missing field.`
      );

      // model matches, agent not provided => excluded
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
      });

      expect(formatted).toBe('');
    });

    it('should include unconditional rules when context is empty object', async () => {
      const rulePath = path.join(globalRulesDir, 'unconditional.md');
      writeFileSync(rulePath, 'Always apply this rule.');

      const formatted = await readAndFormatRules(toRules([rulePath]), {});

      expect(formatted).toContain('unconditional.md');
      expect(formatted).toContain('Always apply this rule');
    });
  });
});

describe('OpenCodeRulesPlugin', () => {
  beforeEach(() => {
    setupTestDirs();
  });

  afterEach(() => {
    teardownTestDirs();
    vi.resetAllMocks();
    __testOnly.resetSessionState();
  });

  it('should export a default plugin function', async () => {
    const { default: plugin } = await import('./index.js');
    expect(typeof plugin).toBe('function');
  });

  it('should return transform hooks even when no rules exist', async () => {
    // Arrange
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, 'empty-config');
    mkdirSync(path.join(testDir, 'empty-config', 'opencode', 'rules'), {
      recursive: true,
    });

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: path.join(testDir, 'empty-project'),
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost:3000'),
    };

    try {
      // Act
      const hooks = await plugin(mockInput);

      // Assert - hooks are returned even when no rules exist
      // They handle the empty case gracefully
      expect(hooks).toHaveProperty('experimental.chat.messages.transform');
      expect(hooks).toHaveProperty('experimental.chat.system.transform');
      expect(typeof hooks['experimental.chat.messages.transform']).toBe(
        'function'
      );
      expect(typeof hooks['experimental.chat.system.transform']).toBe(
        'function'
      );
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should return transform hooks when rules exist', async () => {
    // Arrange
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Test Rule');

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost:3000'),
    };

    try {
      // Act
      const hooks = await plugin(mockInput);

      // Assert
      expect(hooks).toHaveProperty('experimental.chat.messages.transform');
      expect(hooks).toHaveProperty('experimental.chat.system.transform');
      expect(typeof hooks['experimental.chat.messages.transform']).toBe(
        'function'
      );
      expect(typeof hooks['experimental.chat.system.transform']).toBe(
        'function'
      );
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should inject rules into system prompt via system.transform hook', async () => {
    // Arrange
    writeFileSync(
      path.join(globalRulesDir, 'rule.md'),
      '# Test Rule\nDo this always'
    );

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost:3000'),
    };

    try {
      // Act
      const hooks = await plugin(mockInput);
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform(
        {},
        { system: 'You are a helpful assistant.' }
      );

      // Assert
      expect(result.system).toContain('You are a helpful assistant.');
      expect(result.system).toContain('OpenCode Rules');
      expect(result.system).toContain('Test Rule');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should append rules to existing system prompt', async () => {
    // Arrange
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# My Rule');

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost:3000'),
    };

    try {
      // Act
      const hooks = await plugin(mockInput);
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform(
        {},
        { system: 'Original system prompt.' }
      );

      // Assert - original comes first, rules appended
      expect(result.system).toMatch(/^Original system prompt\./);
      expect(result.system).toContain('My Rule');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should handle empty system prompt', async () => {
    // Arrange
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule Content');

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost:3000'),
    };

    try {
      // Act
      const hooks = await plugin(mockInput);
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform({}, { system: '' });

      // Assert
      expect(result.system).toContain('OpenCode Rules');
      expect(result.system).toContain('Rule Content');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should not modify messages in messages.transform hook', async () => {
    // Arrange
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule');

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost:3000'),
    };

    const originalMessages = [
      {
        role: 'user',
        parts: [{ sessionID: 'test-123', type: 'text', text: 'Hello' }],
      },
    ];

    try {
      // Act
      const hooks = await plugin(mockInput);
      const messagesTransform = hooks[
        'experimental.chat.messages.transform'
      ] as any;
      const result = await messagesTransform(
        {},
        { messages: originalMessages }
      );

      // Assert - messages unchanged
      expect(result.messages).toEqual(originalMessages);
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('seeds session state once from messages.transform and does not rescan', async () => {
    // Arrange
    const { default: plugin } = await import('./index.js');
    const hooks = await plugin({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost'),
    });

    const transform = hooks['experimental.chat.messages.transform'] as any;

    const messages = {
      messages: [
        {
          info: { role: 'assistant' },
          parts: [
            {
              sessionID: 'ses_seed',
              type: 'tool-invocation',
              toolInvocation: {
                toolName: 'read',
                args: { filePath: 'src/a.ts' },
              },
            },
          ],
        },
      ],
    };

    const { __testOnly } = await import('./index.js');

    // Act - call transform twice with same messages
    await transform({}, messages);
    await transform({}, messages);

    // Assert - should only seed once
    expect(__testOnly.getSeedCount('ses_seed')).toBe(1);
  });

  describe('conditional rules integration', () => {
    it('should include conditional rule when message context matches glob', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'typescript.mdc'),
        `---
globs:
  - "src/components/**/*.tsx"
---

Use React best practices for components.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const { default: plugin } = await import('./index.js');
      const mockInput = {
        client: {} as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost:3000'),
      };

      try {
        // Act
        const hooks = await plugin(mockInput);

        // Create messages with sessionID in parts (as OpenCode does)
        const testSessionID = 'test-session-123';
        const messagesOutput: any = {
          messages: [
            {
              role: 'assistant',
              parts: [
                {
                  sessionID: testSessionID,
                  type: 'tool-invocation',
                  toolInvocation: {
                    toolName: 'read',
                    args: { filePath: 'src/components/Button.tsx' },
                  },
                },
              ],
            },
          ],
        };

        const systemOutput: any = {
          system: 'Base prompt.',
        };

        // First, process messages with a matching file reference
        const messagesTransform = hooks[
          'experimental.chat.messages.transform'
        ] as any;
        await messagesTransform({}, messagesOutput);

        // Then, get the system prompt with sessionID in input
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: testSessionID },
          systemOutput
        );

        // Assert - conditional rule should be included
        expect(result.system).toContain('React best practices');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should exclude conditional rule when message context does not match glob', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'typescript.mdc'),
        `---
globs:
  - "src/components/**/*.tsx"
---

Use React best practices for components.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const { default: plugin } = await import('./index.js');
      const mockInput = {
        client: {} as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost:3000'),
      };

      try {
        // Act
        const hooks = await plugin(mockInput);

        // Create messages with sessionID in parts (as OpenCode does)
        const testSessionID = 'test-session-456';
        const messagesOutput: any = {
          messages: [
            {
              role: 'assistant',
              parts: [
                {
                  sessionID: testSessionID,
                  type: 'tool-invocation',
                  toolInvocation: {
                    toolName: 'read',
                    args: { filePath: 'src/utils/helpers.ts' },
                  },
                },
              ],
            },
          ],
        };

        const systemOutput: any = {
          system: 'Base prompt.',
        };

        // Process messages with NON-matching file reference
        const messagesTransform = hooks[
          'experimental.chat.messages.transform'
        ] as any;
        await messagesTransform({}, messagesOutput);

        // Get the system prompt with sessionID in input
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: testSessionID },
          systemOutput
        );

        // Assert - conditional rule should NOT be included
        expect(result.system).not.toContain('React best practices');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should include unconditional rules regardless of context', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'always.md'),
        '# Always Apply\nThis rule always applies.'
      );
      writeFileSync(
        path.join(globalRulesDir, 'conditional.mdc'),
        `---
globs:
  - "src/special/**/*"
---

Special rule content.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const { default: plugin } = await import('./index.js');
      const mockInput = {
        client: {} as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost:3000'),
      };

      try {
        // Act
        const hooks = await plugin(mockInput);

        // Create messages with sessionID in parts (as OpenCode does)
        const testSessionID = 'test-session-789';
        const messagesOutput: any = {
          messages: [
            {
              role: 'user',
              parts: [
                {
                  sessionID: testSessionID,
                  type: 'text',
                  text: 'Check src/index.ts',
                },
              ],
            },
          ],
        };

        const systemOutput: any = {
          system: '',
        };

        // Process with non-matching context
        const messagesTransform = hooks[
          'experimental.chat.messages.transform'
        ] as any;
        await messagesTransform({}, messagesOutput);

        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: testSessionID },
          systemOutput
        );

        // Assert
        expect(result.system).toContain('Always Apply');
        expect(result.system).toContain('This rule always applies');
        expect(result.system).not.toContain('Special rule content');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should handle multiple matching files for conditional rules', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'multi.mdc'),
        `---
globs:
  - "**/*.test.ts"
---

Follow testing best practices.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const { default: plugin } = await import('./index.js');
      const mockInput = {
        client: {} as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost:3000'),
      };

      try {
        // Act
        const hooks = await plugin(mockInput);

        // Create messages with sessionID in parts (as OpenCode does)
        const testSessionID = 'test-session-multi';
        const messagesOutput: any = {
          messages: [
            {
              role: 'assistant',
              parts: [
                {
                  sessionID: testSessionID,
                  type: 'tool-invocation',
                  toolInvocation: {
                    toolName: 'read',
                    args: { filePath: 'src/utils.ts' },
                  },
                },
                {
                  type: 'tool-invocation',
                  toolInvocation: {
                    toolName: 'read',
                    args: { filePath: 'src/utils.test.ts' },
                  },
                },
              ],
            },
          ],
        };

        const systemOutput: any = {
          system: '',
        };

        // Process with one matching and one non-matching file
        const messagesTransform = hooks[
          'experimental.chat.messages.transform'
        ] as any;
        await messagesTransform({}, messagesOutput);

        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: testSessionID },
          systemOutput
        );

        // Assert - rule should be included because at least one file matches
        expect(result.system).toContain('testing best practices');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });
  });

  describe('runtime filter context integration', () => {
    it('should include model-conditional rule when session has matching modelID', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'model-rule.mdc'),
        `---
model:
  - claude-opus
---

Model-specific guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Set model via chat.message hook
        const chatMessage = hooks['chat.message'] as any;
        await chatMessage(
          { sessionID: 'ses_model_test', model: { modelID: 'claude-opus' } },
          {
            message: { role: 'user' },
            parts: [{ type: 'text', text: 'hello' }],
          }
        );

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: 'ses_model_test' },
          { system: 'Base prompt.' }
        );

        // Assert - model-conditional rule should be included
        expect(result.system).toContain('Model-specific guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should include agent-conditional rule when session has matching agentType', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'agent-rule.mdc'),
        `---
agent:
  - programmer
---

Agent-specific guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Set agent via chat.message hook
        const chatMessage = hooks['chat.message'] as any;
        await chatMessage(
          { sessionID: 'ses_agent_test', agent: 'programmer' },
          {
            message: { role: 'user' },
            parts: [{ type: 'text', text: 'hello' }],
          }
        );

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: 'ses_agent_test' },
          { system: 'Base prompt.' }
        );

        // Assert - agent-conditional rule should be included
        expect(result.system).toContain('Agent-specific guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should include command-conditional rule when user prompt starts with matching slash command', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'plan-rule.mdc'),
        `---
command:
  - /plan
---

Planning guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Set user prompt with slash command via chat.message hook
        const chatMessage = hooks['chat.message'] as any;
        await chatMessage(
          { sessionID: 'ses_cmd_test' },
          {
            message: { role: 'user' },
            parts: [{ type: 'text', text: '/plan implement a new feature' }],
          }
        );

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: 'ses_cmd_test' },
          { system: 'Base prompt.' }
        );

        // Assert - command-conditional rule should be included
        expect(result.system).toContain('Planning guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should include os-conditional rule when current platform matches', async () => {
      // Arrange - use current platform for test
      const currentPlatform = process.platform;
      writeFileSync(
        path.join(globalRulesDir, 'os-rule.mdc'),
        `---
os:
  - ${currentPlatform}
---

Platform-specific guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - os-conditional rule should be included
        expect(result.system).toContain('Platform-specific guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    // CI env vars that must be isolated for hermetic CI detection tests
    const CI_ENV_VARS = [
      'CI',
      'CONTINUOUS_INTEGRATION',
      'BUILD_NUMBER',
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'CIRCLECI',
      'TRAVIS',
      'JENKINS_URL',
      'BUILDKITE',
      'TEAMCITY_VERSION',
    ] as const;

    function saveCiEnvVars(): Record<string, string | undefined> {
      const saved: Record<string, string | undefined> = {};
      for (const key of CI_ENV_VARS) {
        saved[key] = process.env[key];
      }
      return saved;
    }

    function clearCiEnvVars(): void {
      for (const key of CI_ENV_VARS) {
        delete process.env[key];
      }
    }

    function restoreCiEnvVars(saved: Record<string, string | undefined>): void {
      for (const key of CI_ENV_VARS) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }
    }

    it('should include ci-conditional rule when CI env var is set', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'ci-rule.mdc'),
        `---
ci: true
---

CI-specific guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      const savedCiEnv = saveCiEnvVars();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      clearCiEnvVars();
      process.env.CI = 'true';

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - ci-conditional rule should be included
        expect(result.system).toContain('CI-specific guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        restoreCiEnvVars(savedCiEnv);
      }
    });

    it('should NOT include ci:true rule when CI env var is "false"', async () => {
      // Arrange - regression test for CI='false' being incorrectly treated as truthy
      writeFileSync(
        path.join(globalRulesDir, 'ci-only-rule.mdc'),
        `---
ci: true
---

CI-only guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      const savedCiEnv = saveCiEnvVars();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      clearCiEnvVars();
      process.env.CI = 'false';

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - ci:true rule should NOT be included when CI='false'
        expect(result.system).not.toContain('CI-only guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        restoreCiEnvVars(savedCiEnv);
      }
    });

    it('should NOT include ci:true rule when CI env var is "0"', async () => {
      // Arrange - regression test for CI='0' being incorrectly treated as truthy
      writeFileSync(
        path.join(globalRulesDir, 'ci-zero-rule.mdc'),
        `---
ci: true
---

CI-zero guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      const savedCiEnv = saveCiEnvVars();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      clearCiEnvVars();
      process.env.CI = '0';

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - ci:true rule should NOT be included when CI='0'
        expect(result.system).not.toContain('CI-zero guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        restoreCiEnvVars(savedCiEnv);
      }
    });

    it('should include ci:true rule when CI env var is "1"', async () => {
      // Arrange - verify truthy values still work
      writeFileSync(
        path.join(globalRulesDir, 'ci-one-rule.mdc'),
        `---
ci: true
---

CI-one guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      const savedCiEnv = saveCiEnvVars();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      clearCiEnvVars();
      process.env.CI = '1';

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - ci:true rule SHOULD be included when CI='1'
        expect(result.system).toContain('CI-one guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        restoreCiEnvVars(savedCiEnv);
      }
    });

    it('should NOT include ci:true rule when CI="false" even with GITHUB_ACTIONS set', async () => {
      // Arrange - regression: CI='false' is authoritative, ignoring provider vars
      writeFileSync(
        path.join(globalRulesDir, 'ci-auth-rule.mdc'),
        `---
ci: true
---

CI-authoritative guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      const savedCiEnv = saveCiEnvVars();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      clearCiEnvVars();
      process.env.CI = 'false';
      process.env.GITHUB_ACTIONS = 'true';

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - CI='false' is authoritative; GITHUB_ACTIONS should be ignored
        expect(result.system).not.toContain('CI-authoritative guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        restoreCiEnvVars(savedCiEnv);
      }
    });

    it('should detect CI from provider vars when CI env var is not set', async () => {
      // Arrange - CI not set, but GITHUB_ACTIONS is set => detect as CI
      writeFileSync(
        path.join(globalRulesDir, 'ci-fallback-rule.mdc'),
        `---
ci: true
---

CI-fallback guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      const savedCiEnv = saveCiEnvVars();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      clearCiEnvVars();
      // CI is NOT set (undefined), but GITHUB_ACTIONS is set
      process.env.GITHUB_ACTIONS = 'true';

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - should detect CI from GITHUB_ACTIONS fallback
        expect(result.system).toContain('CI-fallback guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        restoreCiEnvVars(savedCiEnv);
      }
    });

    it('should NOT detect CI when BUILD_NUMBER is "false"', async () => {
      // Arrange - regression: BUILD_NUMBER="false" should not be truthy
      writeFileSync(
        path.join(globalRulesDir, 'ci-build-number-rule.mdc'),
        `---
ci: true
---

CI-build-number guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      const savedCiEnv = saveCiEnvVars();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      clearCiEnvVars();
      process.env.BUILD_NUMBER = 'false';

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - BUILD_NUMBER='false' should not be treated as truthy
        expect(result.system).not.toContain('CI-build-number guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        restoreCiEnvVars(savedCiEnv);
      }
    });

    it('should NOT detect CI when JENKINS_URL is "false"', async () => {
      // Arrange - regression: JENKINS_URL="false" should not be truthy
      writeFileSync(
        path.join(globalRulesDir, 'ci-jenkins-rule.mdc'),
        `---
ci: true
---

CI-jenkins guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      const savedCiEnv = saveCiEnvVars();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      clearCiEnvVars();
      process.env.JENKINS_URL = 'false';

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - JENKINS_URL='false' should not be treated as truthy
        expect(result.system).not.toContain('CI-jenkins guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        restoreCiEnvVars(savedCiEnv);
      }
    });

    it('should NOT detect CI when TEAMCITY_VERSION is "false"', async () => {
      // Arrange - regression: TEAMCITY_VERSION="false" should not be truthy
      writeFileSync(
        path.join(globalRulesDir, 'ci-teamcity-rule.mdc'),
        `---
ci: true
---

CI-teamcity guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      const savedCiEnv = saveCiEnvVars();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      clearCiEnvVars();
      process.env.TEAMCITY_VERSION = 'false';

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - TEAMCITY_VERSION='false' should not be treated as truthy
        expect(result.system).not.toContain('CI-teamcity guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        restoreCiEnvVars(savedCiEnv);
      }
    });

    it('should not throw when project tags detection fails', async () => {
      // Arrange - use a project directory that doesn't exist
      writeFileSync(
        path.join(globalRulesDir, 'unconditional.md'),
        'Always apply this rule.'
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: path.join(testDir, 'nonexistent-project'),
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act - should not throw
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - unconditional rule still included
        expect(result.system).toContain('Always apply this rule');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should not throw when git branch detection fails', async () => {
      // Arrange - use a directory that is not a git repo
      writeFileSync(
        path.join(globalRulesDir, 'unconditional.md'),
        'Always apply this rule.'
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const nonGitDir = path.join(testDir, 'not-a-git-repo');
        mkdirSync(nonGitDir, { recursive: true });

        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: nonGitDir,
          worktree: nonGitDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act - should not throw
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - unconditional rule still included
        expect(result.system).toContain('Always apply this rule');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should combine model, agent, and command filters with match: all', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'all-match.mdc'),
        `---
model:
  - claude-opus
agent:
  - programmer
command:
  - /plan
match: all
---

All dimensions must match.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Set model, agent, and command
        const chatMessage = hooks['chat.message'] as any;
        await chatMessage(
          {
            sessionID: 'ses_all',
            model: { modelID: 'claude-opus' },
            agent: 'programmer',
          },
          {
            message: { role: 'user' },
            parts: [{ type: 'text', text: '/plan implement something' }],
          }
        );

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: 'ses_all' },
          { system: 'Base prompt.' }
        );

        // Assert - all-match rule should be included when all dimensions match
        expect(result.system).toContain('All dimensions must match');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should exclude match: all rule when one dimension is missing', async () => {
      // Arrange
      writeFileSync(
        path.join(globalRulesDir, 'all-match-fail.mdc'),
        `---
model:
  - claude-opus
agent:
  - programmer
command:
  - /plan
match: all
---

All dimensions must match.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Set model and agent, but user prompt is not a slash command
        const chatMessage = hooks['chat.message'] as any;
        await chatMessage(
          {
            sessionID: 'ses_fail',
            model: { modelID: 'claude-opus' },
            agent: 'programmer',
          },
          {
            message: { role: 'user' },
            parts: [{ type: 'text', text: 'just a regular prompt' }],
          }
        );

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: 'ses_fail' },
          { system: 'Base prompt.' }
        );

        // Assert - rule should NOT be included because command dimension doesn't match
        expect(result.system).not.toContain('All dimensions must match');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should include project-conditional rule when project has matching tags', async () => {
      // Arrange - create a node project with package.json
      const projectDir = path.join(testDir, 'node-project');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(path.join(projectDir, 'package.json'), '{}');

      writeFileSync(
        path.join(globalRulesDir, 'node-rule.mdc'),
        `---
project:
  - node
---

Node.js project guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: projectDir,
          worktree: projectDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - project-conditional rule should be included
        expect(result.system).toContain('Node.js project guidelines');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should include branch-conditional rule when getGitBranch returns matching branch', async () => {
      // Arrange - create rule with branch glob pattern
      writeFileSync(
        path.join(globalRulesDir, 'feature-branch-rule.mdc'),
        `---
branch:
  - feature/*
---

Feature branch guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      // Mock getGitBranch to return a matching branch
      const gitBranchModule = await import('./git-branch.js');
      const getGitBranchSpy = vi
        .spyOn(gitBranchModule, 'getGitBranch')
        .mockResolvedValue('feature/add-login');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - branch-conditional rule should be included
        expect(result.system).toContain('Feature branch guidelines');
        expect(getGitBranchSpy).toHaveBeenCalled();
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        getGitBranchSpy.mockRestore();
      }
    });

    it('should exclude branch-conditional rule when getGitBranch returns non-matching branch', async () => {
      // Arrange - create rule with branch glob pattern
      writeFileSync(
        path.join(globalRulesDir, 'feature-only-rule.mdc'),
        `---
branch:
  - feature/*
---

Feature-only guidelines.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      // Mock getGitBranch to return a non-matching branch
      const gitBranchModule = await import('./git-branch.js');
      const getGitBranchSpy = vi
        .spyOn(gitBranchModule, 'getGitBranch')
        .mockResolvedValue('main');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        // Act
        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform({}, { system: 'Base prompt.' });

        // Assert - branch-conditional rule should NOT be included
        expect(result.system).not.toContain('Feature-only guidelines');
        expect(getGitBranchSpy).toHaveBeenCalled();
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        getGitBranchSpy.mockRestore();
      }
    });

    it('should build filter context with all session state fields', async () => {
      writeFileSync(
        path.join(globalRulesDir, 'model-agent-rule.mdc'),
        `---
model:
  - claude-opus
agent:
  - programmer
match: all
---

Model and agent filter rule.`
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        const chatMessage = hooks['chat.message'] as any;
        await chatMessage(
          {
            sessionID: 'ses_ctx',
            model: { modelID: 'claude-opus' },
            agent: 'programmer',
          },
          {
            message: { role: 'user' },
            parts: [{ type: 'text', text: 'test prompt' }],
          }
        );

        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        const result = await systemTransform(
          { sessionID: 'ses_ctx' },
          { system: 'Base prompt.' }
        );

        expect(result.system).toContain('Model and agent filter rule');
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    it('should log warnings via console.warn for tool query failures', async () => {
      writeFileSync(
        path.join(globalRulesDir, 'unconditional.md'),
        'Always apply.'
      );

      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const { default: plugin } = await import('./index.js');
        const mockClient = {
          tool: {
            ids: vi.fn(async () => {
              throw new Error('Tool query failed');
            }),
          },
        };
        const hooks = await plugin({
          client: mockClient as any,
          project: {} as any,
          directory: testDir,
          worktree: testDir,
          $: {} as any,
          serverUrl: new URL('http://localhost'),
        });

        const systemTransform = hooks[
          'experimental.chat.system.transform'
        ] as any;
        await systemTransform({}, { system: 'Base prompt.' });

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Warning: Failed to query tool IDs')
        );
      } finally {
        process.env.XDG_CONFIG_HOME = originalEnv;
        warnSpy.mockRestore();
      }
    });
  });

  describe('YAML Parsing Edge Cases', () => {
    beforeEach(() => {
      setupTestDirs();
      clearRuleCache();
    });

    afterEach(() => {
      teardownTestDirs();
    });

    it('should handle empty frontmatter', () => {
      const content = '---\n---\nRule content here';
      const metadata = parseRuleMetadata(content);
      expect(metadata).toBeUndefined();
    });

    it('should handle frontmatter with only whitespace', () => {
      const content = '---\n   \n---\nRule content here';
      const metadata = parseRuleMetadata(content);
      expect(metadata).toBeUndefined();
    });

    it('should handle complex YAML structures', () => {
      const content = `---
globs:
  - "**/*.ts"
  - "**/*.tsx"
keywords:
  - refactoring
  - cleanup
  - code review
---
Rule content`;
      const metadata = parseRuleMetadata(content);
      expect(metadata?.globs).toEqual(['**/*.ts', '**/*.tsx']);
      expect(metadata?.keywords).toEqual([
        'refactoring',
        'cleanup',
        'code review',
      ]);
    });

    it('should handle inline array syntax in YAML', () => {
      // Note: inline array syntax is valid YAML
      const content = `---
globs: ["**/*.js", "**/*.jsx"]
---
Rule content`;
      const metadata = parseRuleMetadata(content);
      expect(metadata?.globs).toEqual(['**/*.js', '**/*.jsx']);
    });

    it('should ignore non-string array elements', () => {
      const content = `---
globs:
  - "**/*.ts"
  - 123
  - true
keywords:
  - test
---
Rule content`;
      const metadata = parseRuleMetadata(content);
      // Only string elements should be included
      expect(metadata?.globs).toEqual(['**/*.ts']);
      expect(metadata?.keywords).toEqual(['test']);
    });

    it('should parse new filter arrays with inline YAML syntax', () => {
      const content = `---
model: ["gpt-5", "claude-opus"]
agent: ["programmer"]
command: ["/plan", "/review"]
project: ["node", "python"]
branch: ["main", "develop"]
os: ["linux"]
---
Rule content`;
      const metadata = parseRuleMetadata(content);
      expect(metadata?.model).toEqual(['gpt-5', 'claude-opus']);
      expect(metadata?.agent).toEqual(['programmer']);
      expect(metadata?.command).toEqual(['/plan', '/review']);
      expect(metadata?.project).toEqual(['node', 'python']);
      expect(metadata?.branch).toEqual(['main', 'develop']);
      expect(metadata?.os).toEqual(['linux']);
    });

    it('should parse ci boolean in complex frontmatter', () => {
      const content = `---
globs:
  - "**/*.ts"
ci: true
---
Rule content`;
      const metadata = parseRuleMetadata(content);
      expect(metadata?.ci).toBe(true);
      expect(metadata?.globs).toEqual(['**/*.ts']);
    });

    it('should normalize match to any or all only', () => {
      const validAny = `---
model: ["gpt-5"]
match: any
---
content`;
      const validAll = `---
model: ["gpt-5"]
match: all
---
content`;
      const invalid = `---
model: ["gpt-5"]
match: some
---
content`;

      expect(parseRuleMetadata(validAny)?.match).toBe('any');
      expect(parseRuleMetadata(validAll)?.match).toBe('all');
      expect(parseRuleMetadata(invalid)?.match).toBeUndefined();
    });
  });

  describe('Cache Functionality', () => {
    beforeEach(() => {
      setupTestDirs();
      clearRuleCache();
    });

    afterEach(() => {
      teardownTestDirs();
    });

    it('should use cached content on second read', async () => {
      // Arrange - create a rule file
      const rulePath = path.join(globalRulesDir, 'cached-rule.md');
      writeFileSync(rulePath, '# Cached Rule\n\nThis should be cached.');

      const rules = toRules([rulePath]);

      // Act - read the file twice
      const result1 = await readAndFormatRules(rules);
      const result2 = await readAndFormatRules(rules);

      // Assert - both should have the same content
      expect(result1).toContain('Cached Rule');
      expect(result2).toContain('Cached Rule');
      expect(result1).toBe(result2);
    });

    it('should invalidate cache when file is modified', async () => {
      // Arrange - create a rule file
      const rulePath = path.join(globalRulesDir, 'mutable-rule.md');
      writeFileSync(rulePath, '# Original Content');

      const rules = toRules([rulePath]);

      // Act - read the file
      const result1 = await readAndFormatRules(rules);
      expect(result1).toContain('Original Content');

      // Wait a bit to ensure mtime changes
      await new Promise(resolve => setTimeout(resolve, 10));

      // Modify the file
      writeFileSync(rulePath, '# Modified Content');

      // Read again
      const result2 = await readAndFormatRules(rules);

      // Assert - should get the new content
      expect(result2).toContain('Modified Content');
      expect(result2).not.toContain('Original Content');
    });

    it('should handle clearRuleCache correctly', async () => {
      // Arrange - create a rule file
      const rulePath = path.join(globalRulesDir, 'clear-test.md');
      writeFileSync(rulePath, '# Test Content');

      const rules = toRules([rulePath]);

      // Act - read, clear cache, read again
      await readAndFormatRules(rules);
      clearRuleCache();

      // File should be re-read from disk (we can verify by checking the result is still correct)
      const result = await readAndFormatRules(rules);
      expect(result).toContain('Test Content');
    });
  });
});

describe('SessionState', () => {
  beforeEach(() => {
    setupTestDirs();
  });

  afterEach(async () => {
    teardownTestDirs();
    const { __testOnly } = await import('./index.js');
    __testOnly.resetSessionState();
  });

  it('prunes session state when over limit', async () => {
    const { __testOnly } = await import('./index.js');

    __testOnly.setSessionStateLimit(2);
    __testOnly.upsertSessionState('ses_1', s => void (s.lastUpdated = 1));
    __testOnly.upsertSessionState('ses_2', s => void (s.lastUpdated = 2));
    __testOnly.upsertSessionState('ses_3', s => void (s.lastUpdated = 3));

    const ids = __testOnly.getSessionStateIDs();
    expect(ids).toHaveLength(2);
    expect(ids).toContain('ses_2');
    expect(ids).toContain('ses_3');
  });

  it('updates lastUserPrompt from chat.message', async () => {
    const { default: plugin } = await import('./index.js');
    const hooks = await plugin({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost'),
    });

    const hook = hooks['chat.message'] as any;
    expect(hook).toBeTypeOf('function');

    await hook(
      { sessionID: 'ses_test' },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'please add tests' }],
      }
    );

    const { __testOnly } = await import('./index.js');
    const snapshot = __testOnly.getSessionStateSnapshot('ses_test');
    expect(snapshot?.lastUserPrompt).toBe('please add tests');
  });

  it('stores lastModelID from chat.message for user messages', async () => {
    const { default: plugin, __testOnly } = await import('./index.js');
    const hooks = await plugin({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost'),
    });

    const hook = hooks['chat.message'] as any;

    await hook(
      { sessionID: 'ses_model', model: { modelID: 'claude-opus' } },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'hello' }],
      }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_model');
    expect(snapshot?.lastModelID).toBe('claude-opus');
  });

  it('stores lastAgentType from chat.message for user messages', async () => {
    const { default: plugin, __testOnly } = await import('./index.js');
    const hooks = await plugin({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost'),
    });

    const hook = hooks['chat.message'] as any;

    await hook(
      { sessionID: 'ses_agent', agent: 'programmer' },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'hello' }],
      }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_agent');
    expect(snapshot?.lastAgentType).toBe('programmer');
  });

  it('stores both model and agent from chat.message', async () => {
    const { default: plugin, __testOnly } = await import('./index.js');
    const hooks = await plugin({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost'),
    });

    const hook = hooks['chat.message'] as any;

    await hook(
      {
        sessionID: 'ses_both',
        model: { modelID: 'gpt-5' },
        agent: 'coder',
      },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'hello' }],
      }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_both');
    expect(snapshot?.lastModelID).toBe('gpt-5');
    expect(snapshot?.lastAgentType).toBe('coder');
  });

  it('does not update model/agent for non-user messages', async () => {
    const { default: plugin, __testOnly } = await import('./index.js');
    const hooks = await plugin({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost'),
    });

    const hook = hooks['chat.message'] as any;

    // First set values with user message
    await hook(
      {
        sessionID: 'ses_nonuser',
        model: { modelID: 'initial-model' },
        agent: 'initial-agent',
      },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'hello' }],
      }
    );

    // Then try to update with assistant message - should not change
    await hook(
      {
        sessionID: 'ses_nonuser',
        model: { modelID: 'new-model' },
        agent: 'new-agent',
      },
      {
        message: { role: 'assistant' },
        parts: [{ type: 'text', text: 'response' }],
      }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_nonuser');
    expect(snapshot?.lastModelID).toBe('initial-model');
    expect(snapshot?.lastAgentType).toBe('initial-agent');
  });

  it('updates model/agent on subsequent user messages', async () => {
    const { default: plugin, __testOnly } = await import('./index.js');
    const hooks = await plugin({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
      serverUrl: new URL('http://localhost'),
    });

    const hook = hooks['chat.message'] as any;

    // First user message
    await hook(
      {
        sessionID: 'ses_update',
        model: { modelID: 'model-v1' },
        agent: 'agent-v1',
      },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'first message' }],
      }
    );

    // Second user message with different model/agent
    await hook(
      {
        sessionID: 'ses_update',
        model: { modelID: 'model-v2' },
        agent: 'agent-v2',
      },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'second message' }],
      }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_update');
    expect(snapshot?.lastModelID).toBe('model-v2');
    expect(snapshot?.lastAgentType).toBe('agent-v2');
  });

  it('includes glob-conditional rule when tool hook records matching file path', async () => {
    // Arrange rules
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      writeFileSync(
        path.join(globalRulesDir, 'typescript.mdc'),
        `---\nglobs:\n  - "src/components/**/*.tsx"\n---\n\nUse React best practices.`
      );

      const { default: plugin } = await import('./index.js');
      const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
      const hooks = await plugin({
        client: mockClient as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost'),
      });

      // Act: record file path via tool hook
      const before = hooks['tool.execute.before'] as any;
      expect(before).toBeDefined();

      await before(
        { tool: 'read', sessionID: 'ses_1', callID: 'call_1' },
        { args: { filePath: 'src/components/Button.tsx' } }
      );

      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform(
        { sessionID: 'ses_1' },
        { system: 'Base prompt.' }
      );

      // Assert
      expect(result.system).toContain('React best practices');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('does not require messages.transform to inject conditional rules', async () => {
    // Arrange - create conditional rule
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      writeFileSync(
        path.join(globalRulesDir, 'conditional.mdc'),
        `---\nglobs:\n  - "src/special/**/*"\n---\n\nSpecial rule content.`
      );

      const { default: plugin } = await import('./index.js');
      const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
      const hooks = await plugin({
        client: mockClient as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost'),
      });

      // Seed state directly (without calling messages.transform)
      const { __testOnly } = await import('./index.js');
      __testOnly.upsertSessionState('ses_x', s =>
        s.contextPaths.add('src/special/a.txt')
      );

      // Act: call system.transform directly
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform(
        { sessionID: 'ses_x' },
        { system: 'Base prompt.' }
      );

      // Assert - conditional rule should be included via sessionState
      expect(result.system).toContain('Special rule content');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('adds minimal working-set context during compaction', async () => {
    // Arrange
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      const { default: plugin, __testOnly } = await import('./index.js');
      const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
      const hooks = await plugin({
        client: mockClient as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost'),
      });

      // Seed session state with context paths
      __testOnly.upsertSessionState('ses_c', s => {
        s.contextPaths.add('src/components/Button.tsx');
        s.contextPaths.add('src/utils/helpers.ts');
      });

      // Act: call the compacting hook
      const compacting = hooks['experimental.session.compacting'] as any;
      expect(compacting).toBeDefined();

      const output = { context: [] as string[] };
      await compacting({ sessionID: 'ses_c' }, output);

      // Assert
      const contextText = output.context.join('\n');
      expect(contextText).toContain('OpenCode Rules');
      expect(contextText).toContain('src/components/Button.tsx');
      expect(contextText).toContain('src/utils/helpers.ts');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('truncates to 20 paths and shows "... and X more" when paths exceed limit', async () => {
    // Arrange
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      const { default: plugin, __testOnly } = await import('./index.js');
      const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
      const hooks = await plugin({
        client: mockClient as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost'),
      });

      // Seed session state with 25 paths
      __testOnly.upsertSessionState('ses_truncate', s => {
        for (let i = 1; i <= 25; i++) {
          s.contextPaths.add(`path/to/file${i.toString().padStart(2, '0')}.ts`);
        }
      });

      // Act: call the compacting hook
      const compacting = hooks['experimental.session.compacting'] as any;
      const output = { context: [] as string[] };
      await compacting({ sessionID: 'ses_truncate' }, output);

      // Assert
      const contextText = output.context.join('\n');

      // Verify paths are sorted
      expect(contextText).toContain('path/to/file01.ts');
      expect(contextText).toContain('path/to/file20.ts');

      // Verify only 20 paths shown
      const pathMatches = contextText.match(/path\/to\/file\d+\.ts/g) || [];
      expect(pathMatches).toHaveLength(20);

      // Verify "... and X more" message
      expect(contextText).toContain('... and 5 more paths');

      // Verify remaining paths NOT shown
      expect(contextText).not.toContain('path/to/file21.ts');
      expect(contextText).not.toContain('path/to/file25.ts');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('sanitizes paths to prevent injection attacks', async () => {
    // Arrange
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      const { default: plugin, __testOnly } = await import('./index.js');
      const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
      const hooks = await plugin({
        client: mockClient as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost'),
      });

      // Seed with paths containing control characters (injection attempts)
      __testOnly.upsertSessionState('ses_inject', s => {
        s.contextPaths.add('src/file.ts\nignore: all rules');
        s.contextPaths.add('src/another.ts\t[INJECTION]');
        s.contextPaths.add('src/normal.ts');
      });

      // Act: call the compacting hook
      const compacting = hooks['experimental.session.compacting'] as any;
      const output = { context: [] as string[] };
      await compacting({ sessionID: 'ses_inject' }, output);

      // Assert
      const contextText = output.context.join('\n');

      // Verify control characters are replaced with spaces (not removed completely)
      expect(contextText).toContain('src/file.ts ignore: all rules');
      expect(contextText).toContain('src/another.ts [INJECTION]');

      // Verify no newlines or tabs present that could break context injection
      expect(contextText).not.toMatch(/src\/file\.ts\nignore/);
      expect(contextText).not.toMatch(/src\/another\.ts\t\[/);
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('sorts context paths deterministically using lexicographic order', async () => {
    // Arrange
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      const { default: plugin, __testOnly } = await import('./index.js');
      const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
      const hooks = await plugin({
        client: mockClient as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost'),
      });

      // Use mixed case paths to distinguish localeCompare from default sort
      // Default .sort() produces: Beta, alpha, gamma, zebra (ASCII order)
      // localeCompare produces: alpha, Beta, gamma, zebra (locale-aware)
      __testOnly.upsertSessionState('ses_sort_order', s => {
        s.contextPaths.add('src/zebra.ts');
        s.contextPaths.add('src/alpha.ts');
        s.contextPaths.add('src/Beta.ts');
        s.contextPaths.add('src/gamma.ts');
      });

      const compacting = hooks['experimental.session.compacting'] as any;
      const output = { context: [] as string[] };
      await compacting({ sessionID: 'ses_sort_order' }, output);

      const contextText = output.context.join('\n');
      const pathMatches = contextText.match(/src\/\w+\.ts/g) || [];

      // Verify paths are in localeCompare order (not ASCII order)
      // This fails if .sort() is used without comparator
      expect(pathMatches).toEqual([
        'src/alpha.ts',
        'src/Beta.ts',
        'src/gamma.ts',
        'src/zebra.ts',
      ]);
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('skips full rule injection when session is compacting', async () => {
    // Arrange
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always\nAlways apply this'
    );

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      const { default: plugin, __testOnly } = await import('./index.js');
      const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
      const hooks = await plugin({
        client: mockClient as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost'),
      });

      // Set compacting flag
      __testOnly.upsertSessionState(
        'ses_compact',
        s => void (s.isCompacting = true)
      );

      // Act
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform(
        { sessionID: 'ses_compact' },
        { system: 'Base prompt.' }
      );

      // Assert - rules should NOT be injected
      expect(result.system).toBe('Base prompt.');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('includes rules gated by connected mcp server capability', async () => {
    // Arrange
    const ruleContent = `---
tools:
  - "mcp_context7"
---
MCP Context7 rule content`;
    writeFileSync(path.join(globalRulesDir, 'context7.md'), ruleContent);

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      const { default: plugin } = await import('./index.js');
      const mockClient = {
        tool: { ids: vi.fn(async () => ({ data: [] })) },
        mcp: {
          status: vi.fn(async () => ({
            data: { context7: { status: 'connected' } },
          })),
        },
      };

      const hooks = await plugin({
        client: mockClient as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        $: {} as any,
        serverUrl: new URL('http://localhost:3000'),
      });

      // Act
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform({}, { system: 'Base prompt.' });

      // Assert - rule content should be included when MCP is connected
      expect(result.system).toContain('MCP Context7 rule content');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });
});

describe('Cross-Dimension Regression Coverage', () => {
  beforeEach(() => {
    setupTestDirs();
  });

  afterEach(() => {
    teardownTestDirs();
  });

  describe('omitted match behaves as any', () => {
    it('should produce identical behavior with omitted match vs explicit match: any', async () => {
      // Regression: omitted match must be semantically equivalent to match: any
      const ruleOmitted = path.join(globalRulesDir, 'omitted.mdc');
      const ruleExplicit = path.join(globalRulesDir, 'explicit.mdc');

      writeFileSync(
        ruleOmitted,
        `---
model:
  - gpt-5
agent:
  - programmer
os:
  - linux
---

Rule with omitted match.`
      );

      writeFileSync(
        ruleExplicit,
        `---
model:
  - gpt-5
agent:
  - programmer
os:
  - linux
match: any
---

Rule with explicit match any.`
      );

      // Context: model and agent do NOT match, but os DOES match
      const context = {
        modelID: 'claude-opus',
        agentType: 'reviewer',
        os: 'linux',
      };

      // Both should be included because one dimension (os) matches
      const omittedResult = await readAndFormatRules(
        toRules([ruleOmitted]),
        context
      );
      const explicitResult = await readAndFormatRules(
        toRules([ruleExplicit]),
        context
      );

      expect(omittedResult).toContain('Rule with omitted match');
      expect(explicitResult).toContain('Rule with explicit match any');
    });

    it('should exclude rule with omitted match when no dimension matches', async () => {
      // Regression: omitted match still requires at least one dimension to match
      const rulePath = path.join(globalRulesDir, 'none-match.mdc');

      writeFileSync(
        rulePath,
        `---
model:
  - gpt-5
agent:
  - programmer
---

Rule that should not match.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
        agentType: 'reviewer',
      });

      expect(formatted).toBe('');
    });
  });

  describe('mixed legacy + new filters under match: any', () => {
    it('should include rule when only legacy globs match (model, agent mismatch)', async () => {
      const rulePath = path.join(globalRulesDir, 'legacy-globs-any.mdc');

      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.ts"
keywords:
  - refactor
tools:
  - mcp_websearch
model:
  - gpt-5
agent:
  - programmer
---

Mixed legacy and new filters rule.`
      );

      // Only globs match (typescript file), everything else mismatches
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/index.ts'],
        userPrompt: 'help with debugging', // keywords don't match
        availableToolIDs: ['mcp_bash'], // tools don't match
        modelID: 'claude-opus', // model doesn't match
        agentType: 'reviewer', // agent doesn't match
      });

      expect(formatted).toContain('Mixed legacy and new filters rule');
    });

    it('should include rule when only legacy keywords match (globs, tools, new filters mismatch)', async () => {
      const rulePath = path.join(globalRulesDir, 'legacy-keywords-any.mdc');

      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.py"
keywords:
  - testing
tools:
  - mcp_lsp
model:
  - gpt-5
os:
  - windows
---

Keywords only match rule.`
      );

      // Only keywords match
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/index.ts'], // globs don't match (.py)
        userPrompt: 'help with testing this function', // keywords match
        availableToolIDs: ['mcp_bash'], // tools don't match
        modelID: 'claude-opus', // model doesn't match
        os: 'linux', // os doesn't match
      });

      expect(formatted).toContain('Keywords only match rule');
    });

    it('should include rule when only legacy tools match (globs, keywords, new filters mismatch)', async () => {
      const rulePath = path.join(globalRulesDir, 'legacy-tools-any.mdc');

      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.go"
keywords:
  - deploy
tools:
  - mcp_websearch
model:
  - gpt-5
branch:
  - release/*
---

Tools only match rule.`
      );

      // Only tools match
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/index.ts'], // globs don't match
        userPrompt: 'help with coding', // keywords don't match
        availableToolIDs: ['mcp_websearch', 'mcp_bash'], // tools match
        modelID: 'claude-opus', // model doesn't match
        gitBranch: 'main', // branch doesn't match
      });

      expect(formatted).toContain('Tools only match rule');
    });

    it('should include rule when only new model filter matches (all legacy mismatch)', async () => {
      const rulePath = path.join(globalRulesDir, 'new-model-any.mdc');

      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.rs"
keywords:
  - rust
tools:
  - mcp_lsp
model:
  - claude-opus
agent:
  - unknown-agent
---

New model filter matches rule.`
      );

      // Only model matches
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/index.ts'], // globs don't match
        userPrompt: 'help with typescript', // keywords don't match
        availableToolIDs: ['mcp_bash'], // tools don't match
        modelID: 'claude-opus', // model MATCHES
        agentType: 'programmer', // agent doesn't match
      });

      expect(formatted).toContain('New model filter matches rule');
    });
  });

  describe('mixed legacy + new filters under match: all', () => {
    it('should include rule when all legacy and new dimensions match', async () => {
      const rulePath = path.join(globalRulesDir, 'all-match-all.mdc');

      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.ts"
keywords:
  - refactor
tools:
  - mcp_bash
model:
  - claude-opus
agent:
  - programmer
os:
  - linux
match: all
---

All dimensions match rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/utils.ts'], // globs match
        userPrompt: 'help me refactor this code', // keywords match
        availableToolIDs: ['mcp_bash', 'mcp_read'], // tools match
        modelID: 'claude-opus', // model matches
        agentType: 'programmer', // agent matches
        os: 'linux', // os matches
      });

      expect(formatted).toContain('All dimensions match rule');
    });

    it('should exclude rule when one legacy dimension fails (keywords mismatch)', async () => {
      const rulePath = path.join(globalRulesDir, 'all-keywords-fail.mdc');

      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.ts"
keywords:
  - database
tools:
  - mcp_bash
model:
  - claude-opus
match: all
---

Keywords fail rule.`
      );

      // Keywords do NOT match
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/utils.ts'], // globs match
        userPrompt: 'help me refactor this code', // keywords DON'T match (no "database")
        availableToolIDs: ['mcp_bash'], // tools match
        modelID: 'claude-opus', // model matches
      });

      expect(formatted).toBe('');
    });

    it('should exclude rule when one new dimension fails (agent mismatch)', async () => {
      const rulePath = path.join(globalRulesDir, 'all-agent-fail.mdc');

      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.ts"
keywords:
  - refactor
model:
  - claude-opus
agent:
  - reviewer
match: all
---

Agent fail rule.`
      );

      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/utils.ts'], // globs match
        userPrompt: 'help me refactor this', // keywords match
        modelID: 'claude-opus', // model matches
        agentType: 'programmer', // agent DON'T match (needs reviewer)
      });

      expect(formatted).toBe('');
    });

    it('should exclude rule when runtime field is missing (match: all)', async () => {
      const rulePath = path.join(globalRulesDir, 'all-missing-field.mdc');

      writeFileSync(
        rulePath,
        `---
globs:
  - "**/*.ts"
model:
  - claude-opus
agent:
  - programmer
match: all
---

Missing field rule.`
      );

      // agentType not provided => agent dimension is non-match
      const formatted = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/utils.ts'], // globs match
        modelID: 'claude-opus', // model matches
        // agentType is MISSING
      });

      expect(formatted).toBe('');
    });
  });

  describe('unconditional rules injection', () => {
    it('should always include unconditional rules alongside conditional rules', async () => {
      const unconditionalPath = path.join(globalRulesDir, 'always-apply.md');
      const conditionalPath = path.join(globalRulesDir, 'conditional.mdc');

      writeFileSync(
        unconditionalPath,
        '# Always Apply\nThis rule always applies unconditionally.'
      );
      writeFileSync(
        conditionalPath,
        `---
model:
  - gpt-5
---

Conditional rule for gpt-5 only.`
      );

      // Conditional rule does NOT match, but unconditional should still be included
      const formatted = await readAndFormatRules(
        toRules([unconditionalPath, conditionalPath]),
        {
          modelID: 'claude-opus', // doesn't match gpt-5
        }
      );

      expect(formatted).toContain('This rule always applies unconditionally');
      expect(formatted).not.toContain('Conditional rule for gpt-5 only');
    });

    it('should include unconditional rules even when filter context is empty', async () => {
      const unconditionalPath = path.join(globalRulesDir, 'no-conditions.md');
      const conditionalPath = path.join(globalRulesDir, 'needs-match.mdc');

      writeFileSync(
        unconditionalPath,
        '# Unconditional\nNo metadata means always apply.'
      );
      writeFileSync(
        conditionalPath,
        `---
globs:
  - "**/*.special"
keywords:
  - special
---

Only for special files.`
      );

      // Empty context - no filters satisfied
      const formatted = await readAndFormatRules(
        toRules([unconditionalPath, conditionalPath]),
        {}
      );

      expect(formatted).toContain('No metadata means always apply');
      expect(formatted).not.toContain('Only for special files');
    });

    it('should include unconditional rules when called with no context at all', async () => {
      const unconditionalPath = path.join(globalRulesDir, 'bare.md');

      writeFileSync(
        unconditionalPath,
        '# Bare Rule\nShould always be included.'
      );

      // Call with no context argument at all (legacy signature)
      const formatted = await readAndFormatRules(toRules([unconditionalPath]));

      expect(formatted).toContain('Should always be included');
    });

    it('should include multiple unconditional rules when all conditional rules are excluded', async () => {
      const uncond1 = path.join(globalRulesDir, 'uncond1.md');
      const uncond2 = path.join(globalRulesDir, 'uncond2.md');
      const cond1 = path.join(globalRulesDir, 'cond1.mdc');
      const cond2 = path.join(globalRulesDir, 'cond2.mdc');

      writeFileSync(uncond1, '# First Unconditional\nAlways rule 1.');
      writeFileSync(uncond2, '# Second Unconditional\nAlways rule 2.');
      writeFileSync(
        cond1,
        `---
model:
  - nonexistent-model
---

Conditional 1.`
      );
      writeFileSync(
        cond2,
        `---
os:
  - nonexistent-os
---

Conditional 2.`
      );

      const formatted = await readAndFormatRules(
        toRules([uncond1, uncond2, cond1, cond2]),
        {
          modelID: 'claude-opus',
          os: 'linux',
        }
      );

      expect(formatted).toContain('Always rule 1');
      expect(formatted).toContain('Always rule 2');
      expect(formatted).not.toContain('Conditional 1');
      expect(formatted).not.toContain('Conditional 2');
    });
  });
});

describe('utils runtime exports', () => {
  it('exports only expected functions at runtime', () => {
    const exportedKeys = Object.keys(utilsModule).sort();
    expect(exportedKeys).toEqual([
      'clearRuleCache',
      'discoverRuleFiles',
      'extractFilePathsFromMessages',
      'parseRuleMetadata',
      'promptMatchesKeywords',
      'readAndFormatRules',
      'toolsMatchAvailable',
    ]);
  });
});

describe('session-store runtime exports', () => {
  it('exports only SessionStore and createSessionStore at runtime', () => {
    const exportedKeys = Object.keys(sessionStoreModule).sort();
    expect(exportedKeys).toEqual(['SessionStore', 'createSessionStore']);
  });
});
