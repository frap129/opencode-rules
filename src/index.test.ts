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
});

describe('OpenCodeRulesPlugin', () => {
  beforeEach(() => {
    setupTestDirs();
  });

  afterEach(() => {
    teardownTestDirs();
    vi.resetAllMocks();
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
});
