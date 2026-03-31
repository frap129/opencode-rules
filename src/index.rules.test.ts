/**
 * Tests for rule parsing, metadata extraction, and filtering logic.
 * Split from index.test.ts for maintainability.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import {
  discoverRuleFiles,
  parseRuleMetadata,
  extractFilePathsFromMessages,
  promptMatchesKeywords,
  toolsMatchAvailable,
  clearRuleCache,
  type Message,
} from './utils.js';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  saveEnv,
  restoreEnv,
  type EnvSnapshot,
} from './test-fixtures.js';

describe('extractFilePathsFromMessages', () => {
  it('should extract file paths from read tool invocations', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/utils.ts');
  });

  it('should extract file paths from edit tool invocations', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/components/Button.tsx');
  });

  it('should extract file paths from write tool invocations', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('test/data.json');
  });

  it('should extract directory from glob pattern arguments', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/components');
  });

  it('should extract directory from glob pattern in path argument', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/lib');
  });

  it('should only extract path argument from grep, not include patterns', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src');
    expect(paths).not.toContain('*.ts');
  });

  it('should extract file paths from text content using regex', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/utils/helpers.ts');
    expect(paths).toContain('lib/helpers.js');
  });

  it('should extract paths with relative path prefixes', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('./src/app.ts');
    expect(paths).toContain('../config.js');
  });

  it('should extract paths with absolute path prefixes', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('/etc/config');
    expect(paths).toContain('/home/user/project/src/main.ts');
  });

  it('should filter out URLs from text extraction', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).not.toContainEqual(expect.stringContaining('://'));
    expect(paths).toContain('src/main.ts');
  });

  it('should filter out email addresses from text extraction', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).not.toContainEqual(expect.stringContaining('@'));
    expect(paths).toContain('src/config/app.ts');
  });

  it('should deduplicate extracted paths', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe('src/utils.ts');
  });

  it('should handle empty messages', () => {
    const messages: Message[] = [];
    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toEqual([]);
  });

  it('should handle messages with empty parts', () => {
    const messages = [{ role: 'user', parts: [] }];
    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toEqual([]);
  });

  it('should ignore unknown tool names', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toEqual([]);
  });

  it('should handle multiple messages and parts', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toHaveLength(3);
    expect(paths).toContain('src/utils.ts');
    expect(paths).toContain('lib/helpers.js');
    expect(paths).toContain('src/components/Button.tsx');
  });

  it('should handle glob patterns with nested directories', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/deeply/nested/path');
  });

  it('should handle glob patterns with wildcards at different positions', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toEqual([]);
  });

  it('should ignore empty string arguments', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toEqual([]);
  });

  it('should extract paths with various extensions', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/app.ts');
    expect(paths).toContain('src/config.json');
    expect(paths).toContain('lib/utils.js');
    expect(paths).toContain('docs/readme.md');
  });

  it('should trim trailing periods from extracted paths', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/index.ts');
    expect(paths).not.toContain('src/index.ts.');
  });

  it('should trim trailing commas from extracted paths', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/utils.ts');
    expect(paths).toContain('lib/helpers.js');
    expect(paths).toContain('docs/guide.md');
    expect(paths).not.toContain('src/utils.ts,');
  });

  it('should trim multiple trailing punctuation marks from extracted paths', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toContain('src/app.ts');
    expect(paths).toContain('src/config.json');
    expect(paths).toContain('lib/utils.js');
    expect(paths).toContain('docs/readme.md');
  });

  it('should handle glob patterns without slashes', () => {
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

    const paths = extractFilePathsFromMessages(messages);
    expect(paths).toEqual([]);
  });

  it('should extract directory from glob patterns without glob in directory part', () => {
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

    const paths = extractFilePathsFromMessages(messages);
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
    expect(promptMatchesKeywords('I am testing this', ['test'])).toBe(true);
  });

  it('should not match mid-word', () => {
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
    expect(promptMatchesKeywords('file.test.ts', ['test.ts'])).toBe(true);
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
    expect(toolsMatchAvailable(available, ['mcp_websearch'])).toBe(false);
    expect(toolsMatchAvailable(available, ['mcp_websearch_v2'])).toBe(true);
  });

  it('should handle multiple required and available tools efficiently', () => {
    const available = ['tool_a', 'tool_b', 'tool_c', 'tool_d', 'tool_e'];
    const required = ['tool_x', 'tool_y', 'tool_c'];
    expect(toolsMatchAvailable(available, required)).toBe(true);
  });
});

describe('parseRuleMetadata', () => {
  it('should parse YAML metadata from .mdc files', () => {
    const content = `---
globs:
  - "src/components/**/*.ts"
---

This is a rule for TypeScript components.`;

    const metadata = parseRuleMetadata(content);
    expect(metadata).toBeDefined();
    expect(metadata?.globs).toEqual(['src/components/**/*.ts']);
  });

  it('should return undefined for files without metadata', () => {
    const content = 'This rule should always apply.';
    const metadata = parseRuleMetadata(content);
    expect(metadata).toBeUndefined();
  });

  it('should extract rule content without metadata', () => {
    const content = `---
globs:
  - "src/**/*.ts"
---

Rule content here`;

    const metadata = parseRuleMetadata(content);
    const ruleContent = content.replace(/^---[\s\S]*?---\n/, '');
    expect(metadata?.globs).toBeDefined();
    expect(ruleContent).toBe('\nRule content here');
  });

  it('should handle multiple globs in metadata', () => {
    const content = `---
globs:
  - "src/**/*.ts"
  - "lib/**/*.js"
---

Rule content`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.globs).toEqual(['src/**/*.ts', 'lib/**/*.js']);
  });

  it('should parse keywords from YAML metadata', () => {
    const content = `---
keywords:
  - "testing"
  - "unit test"
---

Follow testing best practices.`;

    const metadata = parseRuleMetadata(content);
    expect(metadata).toBeDefined();
    expect(metadata?.keywords).toEqual(['testing', 'unit test']);
  });

  it('should parse both globs and keywords from metadata', () => {
    const content = `---
globs:
  - "**/*.test.ts"
keywords:
  - "testing"
---

Testing rule content.`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.globs).toEqual(['**/*.test.ts']);
    expect(metadata?.keywords).toEqual(['testing']);
  });

  it('should handle keywords before globs in YAML', () => {
    const content = `---
keywords:
  - "refactor"
globs:
  - "src/**/*.ts"
---

Refactoring rules.`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.keywords).toEqual(['refactor']);
    expect(metadata?.globs).toEqual(['src/**/*.ts']);
  });

  it('should parse tools from YAML metadata', () => {
    const content = `---
tools:
  - "mcp_websearch"
  - "mcp_codesearch"
---

Use web search best practices.`;

    const metadata = parseRuleMetadata(content);
    expect(metadata).toBeDefined();
    expect(metadata?.tools).toEqual(['mcp_websearch', 'mcp_codesearch']);
  });

  it('should parse tools alongside globs and keywords', () => {
    const content = `---
globs:
  - "**/*.test.ts"
keywords:
  - "testing"
tools:
  - "mcp_bash"
---

Testing rule with all conditions.`;

    const metadata = parseRuleMetadata(content);
    expect(metadata?.globs).toEqual(['**/*.test.ts']);
    expect(metadata?.keywords).toEqual(['testing']);
    expect(metadata?.tools).toEqual(['mcp_bash']);
  });

  it('should handle tools-only metadata', () => {
    const content = `---
tools:
  - "mcp_lsp"
---

LSP-specific guidelines.`;

    const metadata = parseRuleMetadata(content);
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

  describe('extractStringArray helper parity', () => {
    it('should trim whitespace from array values', () => {
      const content = `---
globs:
  - "  src/**/*.ts  "
  - "  lib/*.js  "
keywords:
  - "  testing  "
---
rule`;

      const metadata = parseRuleMetadata(content);
      expect(metadata?.globs).toEqual(['src/**/*.ts', 'lib/*.js']);
      expect(metadata?.keywords).toEqual(['testing']);
    });

    it('should filter empty strings from array values', () => {
      const content = `---
globs:
  - "src/**/*.ts"
  - ""
  - "lib/*.js"
keywords:
  - ""
  - "testing"
  - "   "
---
rule`;

      const metadata = parseRuleMetadata(content);
      expect(metadata?.globs).toEqual(['src/**/*.ts', 'lib/*.js']);
      expect(metadata?.keywords).toEqual(['testing']);
    });

    it('should filter non-string values from arrays', () => {
      const content = `---
tools:
  - "mcp_bash"
  - 123
  - true
  - "mcp_read"
model:
  - null
  - "claude-opus"
---
rule`;

      const metadata = parseRuleMetadata(content);
      expect(metadata?.tools).toEqual(['mcp_bash', 'mcp_read']);
      expect(metadata?.model).toEqual(['claude-opus']);
    });

    it('should return undefined when all array values are empty after trim/filter', () => {
      const content = `---
globs:
  - ""
  - "   "
---
rule`;

      const metadata = parseRuleMetadata(content);
      expect(metadata?.globs).toBeUndefined();
    });

    it('should process all array fields consistently', () => {
      const content = `---
globs:
  - "  *.ts  "
keywords:
  - "  test  "
tools:
  - "  mcp_bash  "
model:
  - "  gpt-5  "
agent:
  - "  coder  "
command:
  - "  /plan  "
project:
  - "  node  "
branch:
  - "  main  "
os:
  - "  linux  "
---
rule`;

      const metadata = parseRuleMetadata(content);
      expect(metadata?.globs).toEqual(['*.ts']);
      expect(metadata?.keywords).toEqual(['test']);
      expect(metadata?.tools).toEqual(['mcp_bash']);
      expect(metadata?.model).toEqual(['gpt-5']);
      expect(metadata?.agent).toEqual(['coder']);
      expect(metadata?.command).toEqual(['/plan']);
      expect(metadata?.project).toEqual(['node']);
      expect(metadata?.branch).toEqual(['main']);
      expect(metadata?.os).toEqual(['linux']);
    });
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
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    setupTestDirs();
    envSnapshot = saveEnv('XDG_CONFIG_HOME', 'HOME', 'OPENCODE_CONFIG_DIR');
  });

  afterEach(() => {
    teardownTestDirs();
    restoreEnv(envSnapshot);
    vi.resetAllMocks();
  });

  describe('global rules discovery', () => {
    it('should discover markdown files from XDG_CONFIG_HOME/opencode/rules', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      writeFileSync(path.join(globalRulesDir, 'rule1.md'), '# Rule 1');
      writeFileSync(path.join(globalRulesDir, 'rule2.md'), '# Rule 2');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles();
      expect(
        files.some(f => f.filePath === path.join(globalRulesDir, 'rule1.md'))
      ).toBe(true);
      expect(
        files.some(f => f.filePath === path.join(globalRulesDir, 'rule2.md'))
      ).toBe(true);
    });

    it('should use ~/.config/opencode/rules as fallback when XDG_CONFIG_HOME not set', async () => {
      const { testDir } = getTestDirs();
      const homeDir = path.join(testDir, 'home');
      mkdirSync(homeDir, { recursive: true });
      const fallbackDir = path.join(homeDir, '.config', 'opencode', 'rules');
      mkdirSync(fallbackDir, { recursive: true });
      writeFileSync(path.join(fallbackDir, 'rule.md'), '# Rule');

      process.env.HOME = homeDir;
      delete process.env.XDG_CONFIG_HOME;

      const files = await discoverRuleFiles();
      expect(
        files.some(f => f.filePath === path.join(fallbackDir, 'rule.md'))
      ).toBe(true);
    });

    it('should handle missing global rules directory gracefully', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      rmSync(globalRulesDir, { recursive: true, force: true });

      const files = await discoverRuleFiles();
      expect(files).toEqual([]);
    });

    it('should include both .md and .mdc files', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule');
      writeFileSync(
        path.join(globalRulesDir, 'rule.mdc'),
        '# Rule with metadata'
      );
      writeFileSync(path.join(globalRulesDir, 'rule.txt'), 'Not markdown');
      writeFileSync(path.join(globalRulesDir, 'rule.json'), '{}');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles();
      expect(files).toHaveLength(2);
      expect(files.some(f => f.filePath.endsWith('.md'))).toBe(true);
      expect(files.some(f => f.filePath.endsWith('.mdc'))).toBe(true);
    });

    it('should exclude hidden files', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule');
      writeFileSync(path.join(globalRulesDir, '.hidden.md'), '# Hidden');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles();
      expect(files.every(f => !f.filePath.includes('.hidden.md'))).toBe(true);
    });

    it('should use OPENCODE_CONFIG_DIR/rules as global dir when set', async () => {
      const { testDir } = getTestDirs();
      const customDir = path.join(testDir, 'custom-config');
      const customRulesDir = path.join(customDir, 'rules');
      mkdirSync(customRulesDir, { recursive: true });
      writeFileSync(path.join(customRulesDir, 'custom.md'), '# Custom Rule');

      process.env.OPENCODE_CONFIG_DIR = customDir;

      const files = await discoverRuleFiles();
      expect(
        files.some(f => f.filePath === path.join(customRulesDir, 'custom.md'))
      ).toBe(true);
    });

    it('should prefer OPENCODE_CONFIG_DIR over XDG_CONFIG_HOME', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      writeFileSync(path.join(globalRulesDir, 'xdg-rule.md'), '# XDG Rule');

      const customDir = path.join(testDir, 'custom-config');
      const customRulesDir = path.join(customDir, 'rules');
      mkdirSync(customRulesDir, { recursive: true });
      writeFileSync(path.join(customRulesDir, 'custom.md'), '# Custom Rule');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
      process.env.OPENCODE_CONFIG_DIR = customDir;

      const files = await discoverRuleFiles();
      expect(files.some(f => f.filePath.includes('custom.md'))).toBe(true);
      expect(files.some(f => f.filePath.includes('xdg-rule.md'))).toBe(false);
    });

    it('should handle missing OPENCODE_CONFIG_DIR/rules gracefully', async () => {
      const { testDir } = getTestDirs();
      const customDir = path.join(testDir, 'no-rules-here');
      mkdirSync(customDir, { recursive: true });

      process.env.OPENCODE_CONFIG_DIR = customDir;

      const files = await discoverRuleFiles();
      expect(files).toEqual([]);
    });
  });

  describe('project rules discovery', () => {
    it('should discover markdown files from .opencode/rules directory', async () => {
      const { testDir } = getTestDirs();
      const projectDir = path.join(testDir, 'project');
      mkdirSync(projectDir, { recursive: true });
      const projRulesDir = path.join(projectDir, '.opencode', 'rules');
      mkdirSync(projRulesDir, { recursive: true });
      writeFileSync(path.join(projRulesDir, 'local-rule.md'), '# Local Rule');

      const files = await discoverRuleFiles(projectDir);
      expect(
        files.some(f => f.filePath === path.join(projRulesDir, 'local-rule.md'))
      ).toBe(true);
    });

    it('should handle missing .opencode directory gracefully', async () => {
      const { testDir } = getTestDirs();
      const projectDir = path.join(testDir, 'empty-project');
      mkdirSync(projectDir, { recursive: true });

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles(projectDir);
      expect(files).toEqual([]);
    });

    it('should discover rules from both global and project directories', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      writeFileSync(path.join(globalRulesDir, 'global.md'), '# Global');

      const projectDir = path.join(testDir, 'project');
      mkdirSync(projectDir, { recursive: true });
      const projRulesDir = path.join(projectDir, '.opencode', 'rules');
      mkdirSync(projRulesDir, { recursive: true });
      writeFileSync(path.join(projRulesDir, 'local.md'), '# Local');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles(projectDir);
      expect(files).toHaveLength(2);
      expect(files.some(f => f.filePath.includes('global.md'))).toBe(true);
      expect(files.some(f => f.filePath.includes('local.md'))).toBe(true);
    });
  });

  describe('subdirectory scanning', () => {
    it('should discover rules in nested subdirectories', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      const nestedDir = path.join(globalRulesDir, 'typescript');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'react.md'), '# React Rules');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles();
      expect(
        files.some(f => f.filePath === path.join(nestedDir, 'react.md'))
      ).toBe(true);
    });

    it('should discover rules in deeply nested subdirectories (multiple levels)', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      const deepDir = path.join(
        globalRulesDir,
        'lang',
        'typescript',
        'framework'
      );
      mkdirSync(deepDir, { recursive: true });
      writeFileSync(path.join(deepDir, 'nextjs.md'), '# Next.js Rules');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles();
      expect(
        files.some(f => f.filePath === path.join(deepDir, 'nextjs.md'))
      ).toBe(true);
    });

    it('should exclude hidden subdirectories', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      const hiddenDir = path.join(globalRulesDir, '.hidden');
      mkdirSync(hiddenDir, { recursive: true });
      writeFileSync(path.join(hiddenDir, 'secret.md'), '# Secret Rule');
      writeFileSync(path.join(globalRulesDir, 'visible.md'), '# Visible Rule');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles();
      expect(files.every(f => !f.filePath.includes('.hidden'))).toBe(true);
      expect(files.every(f => !f.filePath.includes('secret.md'))).toBe(true);
      expect(
        files.some(f => f.filePath === path.join(globalRulesDir, 'visible.md'))
      ).toBe(true);
    });

    it('should discover rules from mixed flat and nested structures', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      writeFileSync(path.join(globalRulesDir, 'root.md'), '# Root Rule');
      const nestedDir = path.join(globalRulesDir, 'nested');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'child.md'), '# Child Rule');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles();
      expect(files).toHaveLength(2);
      expect(
        files.some(f => f.filePath === path.join(globalRulesDir, 'root.md'))
      ).toBe(true);
      expect(
        files.some(f => f.filePath === path.join(nestedDir, 'child.md'))
      ).toBe(true);
    });

    it('should discover rules in project subdirectories', async () => {
      const { testDir } = getTestDirs();
      const projectDir = path.join(testDir, 'project');
      const projRulesDir = path.join(projectDir, '.opencode', 'rules');
      const nestedDir = path.join(projRulesDir, 'frontend');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'react.md'), '# React Rules');

      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const files = await discoverRuleFiles(projectDir);
      expect(
        files.some(f => f.filePath === path.join(nestedDir, 'react.md'))
      ).toBe(true);
    });
  });

  describe('ENOENT handling', () => {
    it('should handle missing directories gracefully without warnings', async () => {
      const { testDir } = getTestDirs();
      const nonExistentDir = path.join(testDir, 'does-not-exist');
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      process.env.XDG_CONFIG_HOME = nonExistentDir;

      try {
        const files = await discoverRuleFiles();
        expect(files).toEqual([]);
        expect(warnings.filter(w => w.includes('opencode-rules'))).toHaveLength(
          0
        );
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should not emit redundant stat + readdir calls for missing directories', async () => {
      const { testDir } = getTestDirs();
      const nonExistentDir = path.join(testDir, 'missing-rules-dir');
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      process.env.XDG_CONFIG_HOME = nonExistentDir;

      try {
        const files = await discoverRuleFiles();
        expect(files).toEqual([]);
        expect(warnings.filter(w => w.includes('opencode-rules'))).toHaveLength(
          0
        );
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should handle race condition where directory is deleted mid-scan', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      const nestedDir = path.join(globalRulesDir, 'will-be-deleted');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'rule.md'), '# Rule');
      rmSync(nestedDir, { recursive: true, force: true });

      try {
        const files = await discoverRuleFiles();
        expect(
          warnings.filter(w => w.includes('ENOENT') || w.includes('no such'))
        ).toHaveLength(0);
        expect(files).toEqual([]);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should not warn on ENOENT in readdir catch path', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(String(msg));

      rmSync(globalRulesDir, { recursive: true, force: true });

      try {
        const files = await discoverRuleFiles();
        expect(files).toEqual([]);
        const enoentWarnings = warnings.filter(
          w => w.includes('ENOENT') || w.includes('no such file')
        );
        expect(enoentWarnings).toHaveLength(0);
      } finally {
        console.warn = originalWarn;
      }
    });
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
