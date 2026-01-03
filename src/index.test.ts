import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  discoverRuleFiles,
  readAndFormatRules,
  parseRuleMetadata,
  extractFilePathsFromMessages,
} from './utils.js';

// Create temporary test directories
const testDir = '/tmp/opencode-rules-test';
const globalRulesDir = path.join(testDir, '.config', 'opencode', 'rules');
const projectRulesDir = path.join(testDir, 'project', '.opencode', 'rules');

function setupTestDirs() {
  // Clean up if exists
  if (require('fs').existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  mkdirSync(globalRulesDir, { recursive: true });
  mkdirSync(projectRulesDir, { recursive: true });
}

function teardownTestDirs() {
  if (require('fs').existsSync(testDir)) {
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
        expect(files).toContain(path.join(globalRulesDir, 'rule1.md'));
        expect(files).toContain(path.join(globalRulesDir, 'rule2.md'));
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
        expect(files).toContain(path.join(fallbackDir, 'rule.md'));
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
        expect(files.some(f => f.endsWith('.md'))).toBe(true);
        expect(files.some(f => f.endsWith('.mdc'))).toBe(true);
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
        expect(files).not.toContainEqual(expect.stringContaining('.hidden.md'));
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
      expect(files).toContain(path.join(projRulesDir, 'local-rule.md'));
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
        expect(files).toContainEqual(expect.stringContaining('global.md'));
        expect(files).toContainEqual(expect.stringContaining('local.md'));
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

    const files = [rule1Path, rule2Path];

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
    const formatted = await readAndFormatRules([nonExistentFile, validFile]);

    // Should still include the valid file
    expect(formatted).toContain('valid.md');
  });

  it('should include filename as subheader in output', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'my-rules.md');
    writeFileSync(rulePath, 'Rule content');

    // Act
    const formatted = await readAndFormatRules([rulePath]);

    // Assert
    expect(formatted).toMatch(/##\s+my-rules\.md/);
  });

  it('should include instructions to follow rules', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'rule.md');
    writeFileSync(rulePath, 'Rule content');

    // Act
    const formatted = await readAndFormatRules([rulePath]);

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
    const formatted = await readAndFormatRules(
      [rulePath],
      'src/utils/helpers.js'
    );

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
    const formatted = await readAndFormatRules(
      [rulePath],
      'src/components/button.ts'
    );

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
    const formatted = await readAndFormatRules(
      [rulePath],
      'src/utils/helpers.js'
    );

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
    const formatted = await readAndFormatRules(
      [rulePath],
      'lib/utils/helper.js'
    );

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
      [unconditionalPath, conditionalPath],
      'src/app.ts'
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
      [unconditionalPath, conditionalPath],
      'docs/readme.md'
    );

    // Assert - only unconditional rule should be included
    expect(formatted).toContain('always.md');
    expect(formatted).toContain('Always apply this');
    expect(formatted).not.toContain('Only for TypeScript');
  });

  it('should apply all rules when no context file path provided', async () => {
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
    const formatted = await readAndFormatRules([rulePath]);

    // Assert - rule should be applied (backward compatibility)
    expect(formatted).toContain('conditional.mdc');
    expect(formatted).toContain('TypeScript only rule');
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

  it('should return hooks object from plugin', async () => {
    // Arrange
    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    // Act
    const hooks = await plugin(mockInput);

    // Assert
    expect(hooks).toBeDefined();
    expect(typeof hooks.event).toBe('function');
  });

  it('should send silent message with rules on session.created event', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'rule.md');
    writeFileSync(rulePath, '# Test Rule\nDo this always');

    const mockPrompt = vi.fn().mockResolvedValue({});
    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {
        session: {
          prompt: mockPrompt,
        },
      } as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    // Mock XDG_CONFIG_HOME to find our test rule
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      // Act
      const hooks = await plugin(mockInput);
      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: {
              id: 'ses_456',
            },
          },
        } as any,
      });

      // Assert
      expect(mockPrompt).toHaveBeenCalledWith({
        path: { id: 'ses_456' },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: expect.stringContaining('OpenCode Rules'),
            },
          ],
        },
      });
      expect(mockPrompt).toHaveBeenCalledWith({
        path: { id: 'ses_456' },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: expect.stringContaining('Test Rule'),
            },
          ],
        },
      });
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should not send message when no rules exist', async () => {
    // Arrange
    // Ensure no rules exist
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockPrompt = vi.fn().mockResolvedValue({});
    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {
        session: {
          prompt: mockPrompt,
        },
      } as any,
      project: {} as any,
      directory: path.join(testDir, 'empty-project'),
      worktree: testDir,
      $: {} as any,
    };

    try {
      // Act
      const hooks = await plugin(mockInput);
      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: {
              id: 'ses_456',
            },
          },
        } as any,
      });

      // Assert - no message should be sent
      expect(mockPrompt).not.toHaveBeenCalled();
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should discover and send rules from project directory', async () => {
    // Arrange
    const projectDir = path.join(testDir, 'myproject');
    mkdirSync(projectDir, { recursive: true });
    const projRulesDir = path.join(projectDir, '.opencode', 'rules');
    mkdirSync(projRulesDir, { recursive: true });
    writeFileSync(path.join(projRulesDir, 'project-rule.md'), '# Project Rule');

    const mockPrompt = vi.fn().mockResolvedValue({});
    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {
        session: {
          prompt: mockPrompt,
        },
      } as any,
      project: {} as any,
      directory: projectDir,
      worktree: testDir,
      $: {} as any,
    };

    // Act
    const hooks = await plugin(mockInput);
    await hooks.event!({
      event: {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_456',
          },
        },
      } as any,
    });

    // Assert
    expect(mockPrompt).toHaveBeenCalledWith({
      path: { id: 'ses_456' },
      body: {
        noReply: true,
        parts: [
          {
            type: 'text',
            text: expect.stringContaining('project-rule.md'),
          },
        ],
      },
    });
  });

  it('should not send rules twice to the same session', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'rule.md');
    writeFileSync(rulePath, '# Test Rule\nDo this always');

    const mockPrompt = vi.fn().mockResolvedValue({});
    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {
        session: {
          prompt: mockPrompt,
        },
      } as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      // Act
      const hooks = await plugin(mockInput);

      // First session.created event
      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: {
              id: 'ses_456',
            },
          },
        } as any,
      });

      // Second session.created event for same session (shouldn't happen normally)
      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: {
              id: 'ses_456',
            },
          },
        } as any,
      });

      // Assert - should only be called once
      expect(mockPrompt).toHaveBeenCalledTimes(1);
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should send rules to multiple different sessions', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'rule.md');
    writeFileSync(rulePath, '# Test Rule\nDo this always');

    const mockPrompt = vi.fn().mockResolvedValue({});
    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {
        session: {
          prompt: mockPrompt,
        },
      } as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      // Act
      const hooks = await plugin(mockInput);

      // First session created
      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: {
              id: 'ses_first',
            },
          },
        } as any,
      });

      // Second session created
      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: {
              id: 'ses_second',
            },
          },
        } as any,
      });

      // Assert - both sessions should receive rules
      expect(mockPrompt).toHaveBeenCalledTimes(2);
      expect(mockPrompt).toHaveBeenCalledWith({
        path: { id: 'ses_first' },
        body: expect.objectContaining({ noReply: true }),
      });
      expect(mockPrompt).toHaveBeenCalledWith({
        path: { id: 'ses_second' },
        body: expect.objectContaining({ noReply: true }),
      });
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should re-send rules after session compaction', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'rule.md');
    writeFileSync(rulePath, '# Test Rule\nDo this always');

    const mockPrompt = vi.fn().mockResolvedValue({});
    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {
        session: {
          prompt: mockPrompt,
        },
      } as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      // Act
      const hooks = await plugin(mockInput);

      // Session created - rules sent
      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: {
              id: 'ses_compact_test',
            },
          },
        } as any,
      });

      expect(mockPrompt).toHaveBeenCalledTimes(1);

      // Session compacted - rules should be re-sent
      await hooks.event!({
        event: {
          type: 'session.compacted',
          properties: {
            sessionID: 'ses_compact_test',
          },
        } as any,
      });

      // Assert - rules should be sent twice (creation + compaction)
      expect(mockPrompt).toHaveBeenCalledTimes(2);
      expect(mockPrompt).toHaveBeenNthCalledWith(2, {
        path: { id: 'ses_compact_test' },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: expect.stringContaining('OpenCode Rules'),
            },
          ],
        },
      });
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should handle compaction event for unknown session gracefully', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'rule.md');
    writeFileSync(rulePath, '# Test Rule\nDo this always');

    const mockPrompt = vi.fn().mockResolvedValue({});
    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {
        session: {
          prompt: mockPrompt,
        },
      } as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    try {
      // Act
      const hooks = await plugin(mockInput);

      // Compaction event for a session that was never created
      await hooks.event!({
        event: {
          type: 'session.compacted',
          properties: {
            sessionID: 'unknown_session',
          },
        } as any,
      });

      // Assert - should still send rules (compaction implies session exists)
      expect(mockPrompt).toHaveBeenCalledWith({
        path: { id: 'unknown_session' },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: expect.stringContaining('OpenCode Rules'),
            },
          ],
        },
      });
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });
});
