import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  discoverRuleFiles,
  readAndFormatRules,
  parseRuleMetadata,
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

      // Act & Assert - should not throw
      const files = await discoverRuleFiles(projectDir);
      expect(files).toEqual([]);
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
    expect(typeof hooks['chat.params']).toBe('function');
  });

  it('should modify chat params with system prompt suffix when rules exist', async () => {
    // Arrange
    const rulePath = path.join(globalRulesDir, 'rule.md');
    writeFileSync(rulePath, '# Test Rule\nDo this always');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
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
      const output = {
        temperature: 0.7,
        topP: 0.9,
        options: {} as any,
      };

      await hooks['chat.params']!(
        { model: {}, provider: {}, message: {} } as any,
        output as any
      );

      // Assert
      expect(output.options.systemPromptSuffix).toBeDefined();
      expect(output.options.systemPromptSuffix).toContain('OpenCode Rules');
      expect(output.options.systemPromptSuffix).toContain('Test Rule');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should not set system prompt suffix when no rules exist', async () => {
    // Arrange
    // Ensure no rules exist
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: path.join(testDir, 'empty-project'),
      worktree: testDir,
      $: {} as any,
    };

    try {
      // Act
      const hooks = await plugin(mockInput);
      const output = {
        temperature: 0.7,
        topP: 0.9,
        options: {} as any,
      };

      await hooks['chat.params']!(
        { model: {}, provider: {}, message: {} } as any,
        output as any
      );

      // Assert
      expect(output.options.systemPromptSuffix).toBeUndefined();
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should discover rules from project directory', async () => {
    // Arrange
    const projectDir = path.join(testDir, 'myproject');
    mkdirSync(projectDir, { recursive: true });
    const projRulesDir = path.join(projectDir, '.opencode', 'rules');
    mkdirSync(projRulesDir, { recursive: true });
    writeFileSync(path.join(projRulesDir, 'project-rule.md'), '# Project Rule');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: projectDir,
      worktree: testDir,
      $: {} as any,
    };

    // Act
    const hooks = await plugin(mockInput);
    const output = {
      temperature: 0.7,
      topP: 0.9,
      options: {} as any,
    };

    await hooks['chat.params']!(
      { model: {}, provider: {}, message: {} } as any,
      output as any
    );

    // Assert
    expect(output.options.systemPromptSuffix).toContain('project-rule.md');
  });
});
