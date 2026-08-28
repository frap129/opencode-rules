/**
 * High-level integration tests for opencode-rules.
 * Tests end-to-end rule injection, conditional rules with runtime context,
 * cache behavior, and cross-dimension regression scenarios.
 * Split from index.test.ts for maintainability.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { readAndFormatRules, clearRuleCache } from './utils.js';
import { matchRules } from './rule-filter.js';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  toRules,
  createMockPluginInput,
} from './test-fixtures.js';
import { buildRulePart } from './rule-delivery-codec.js';
import { _setStateDirForTesting } from './active-rules-state.js';
import { __testOnly } from './index.js';

type ChatMessageOutputLike = {
  message: { role: string };
  parts: Array<{
    id?: string;
    type?: string;
    text?: string;
    synthetic?: boolean;
  }>;
};

describe('readAndFormatRules', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    clearRuleCache();
  });

  afterEach(() => {
    teardownTestDirs();
    if (savedEnvXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedEnvXDG;
    }
    if (savedEnvConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = savedEnvConfigDir;
    }
  });

  it('should read and format rule files into a formatted string', async () => {
    const { globalRulesDir } = getTestDirs();
    const rule1Path = path.join(globalRulesDir, 'rule1.md');
    const rule2Path = path.join(globalRulesDir, 'rule2.md');
    writeFileSync(rule1Path, '# Rule 1\nContent of rule 1');
    writeFileSync(rule2Path, '# Rule 2\nContent of rule 2');

    const { formattedRules } = await readAndFormatRules(
      toRules([rule1Path, rule2Path])
    );

    expect(formattedRules).toContain('OpenCode Rules');
    expect(formattedRules).toContain('rule1.md');
    expect(formattedRules).toContain('rule2.md');
    expect(formattedRules).toContain('Rule 1');
    expect(formattedRules).toContain('Rule 2');
  });

  it('should return empty string when no files provided', async () => {
    const { formattedRules } = await readAndFormatRules([]);
    expect(formattedRules).toBe('');
  });

  it('should handle file read errors gracefully', async () => {
    const { globalRulesDir } = getTestDirs();
    const nonExistentFile = path.join(globalRulesDir, 'nonexistent.md');
    const validFile = path.join(globalRulesDir, 'valid.md');
    writeFileSync(validFile, '# Valid Rule');

    const { formattedRules } = await readAndFormatRules(
      toRules([nonExistentFile, validFile])
    );
    expect(formattedRules).toContain('valid.md');
  });

  it('should include filename as subheader in output', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'my-rules.md');
    writeFileSync(rulePath, 'Rule content');

    const { formattedRules } = await readAndFormatRules(toRules([rulePath]));
    expect(formattedRules).toMatch(/##\s+my-rules\.md/);
  });

  it('should include rule when file matches glob pattern in metadata', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'typescript.mdc');
    const ruleContent = `---
globs:
  - "src/components/**/*.ts"
---

This is a rule for TypeScript components.`;
    writeFileSync(rulePath, ruleContent);

    const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
      contextFilePaths: ['src/components/button.ts'],
    });

    expect(formattedRules).toContain('typescript.mdc');
    expect(formattedRules).toContain(
      'This is a rule for TypeScript components.'
    );
  });

  it('should exclude rule when file does not match glob pattern in metadata', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'typescript.mdc');
    const ruleContent = `---
globs:
  - "src/components/**/*.ts"
---

This is a rule for TypeScript components.`;
    writeFileSync(rulePath, ruleContent);

    const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
      contextFilePaths: ['src/utils/helpers.js'],
    });

    expect(formattedRules).toBe('');
  });

  it('should include rule when user prompt matches keywords', async () => {
    const { globalRulesDir } = getTestDirs();
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

    const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
      userPrompt: 'I need help testing this function',
    });

    expect(formattedRules).toContain('testing-rule.mdc');
    expect(formattedRules).toContain('Follow testing best practices');
  });

  it('should include rule when tool is available', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'websearch-rule.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - "mcp_websearch"
---

Use web search best practices.`
    );

    const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
      availableToolIDs: ['mcp_bash', 'mcp_websearch', 'mcp_read'],
    });

    expect(formattedRules).toContain('websearch-rule.mdc');
    expect(formattedRules).toContain('Use web search best practices');
  });

  describe('new filter dimensions', () => {
    it('should include rule when model matches', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
      });

      expect(formattedRules).toContain('model-rule.mdc');
      expect(formattedRules).toContain('Model-specific rule');
    });

    it('should include rule when agent matches', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        agentType: 'programmer',
      });

      expect(formattedRules).toContain('agent-rule.mdc');
      expect(formattedRules).toContain('Agent-specific rule');
    });

    it('should include rule when os matches', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        os: 'linux',
      });

      expect(formattedRules).toContain('os-rule.mdc');
      expect(formattedRules).toContain('Unix-specific rule');
    });

    it('should include rule when ci is true and rule requires ci', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'ci-rule.mdc');
      writeFileSync(
        rulePath,
        `---
ci: true
---

CI-specific rule.`
      );

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        ci: true,
      });

      expect(formattedRules).toContain('ci-rule.mdc');
      expect(formattedRules).toContain('CI-specific rule');
    });

    it('should include rule when branch matches glob pattern', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        gitBranch: 'feature/add-login',
      });

      expect(formattedRules).toContain('branch-glob-rule.mdc');
      expect(formattedRules).toContain('Feature branch rule');
    });
  });

  describe('match: any|all behavior', () => {
    it('should use match: any by default (include when any dimension matches)', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
        agentType: 'reviewer',
        os: 'linux',
      });

      expect(formattedRules).toContain('any-default.mdc');
      expect(formattedRules).toContain('Default any match rule');
    });

    it('should require all declared dimensions when match is all', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
        agentType: 'programmer',
        os: 'linux',
      });

      expect(formattedRules).toContain('all-match.mdc');
      expect(formattedRules).toContain('All dimensions must match');
    });

    it('should exclude rule when match: all and one dimension fails', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
        agentType: 'programmer',
        os: 'darwin',
      });

      expect(formattedRules).toBe('');
    });
  });

  describe('Cache Functionality', () => {
    it('should use cached content on second read', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'cached-rule.md');
      writeFileSync(rulePath, '# Cached Rule\n\nThis should be cached.');

      const rules = toRules([rulePath]);

      const result1 = await readAndFormatRules(rules);
      const result2 = await readAndFormatRules(rules);

      expect(result1.formattedRules).toContain('Cached Rule');
      expect(result2.formattedRules).toContain('Cached Rule');
      expect(result1.formattedRules).toBe(result2.formattedRules);
    });

    it('should invalidate cache when file is modified', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'mutable-rule.md');
      writeFileSync(rulePath, '# Original Content');

      const rules = toRules([rulePath]);

      const result1 = await readAndFormatRules(rules);
      expect(result1.formattedRules).toContain('Original Content');

      // Write new content and explicitly set mtime to future to ensure cache invalidation
      // This avoids flaky timing issues on CI/different filesystems
      writeFileSync(rulePath, '# Modified Content');
      const futureTime = new Date(Date.now() + 2000);
      utimesSync(rulePath, futureTime, futureTime);

      const result2 = await readAndFormatRules(rules);

      expect(result2.formattedRules).toContain('Modified Content');
      expect(result2.formattedRules).not.toContain('Original Content');
    });

    it('should handle clearRuleCache correctly', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'clear-test.md');
      writeFileSync(rulePath, '# Test Content');

      const rules = toRules([rulePath]);

      await readAndFormatRules(rules);
      clearRuleCache();

      const result = await readAndFormatRules(rules);
      expect(result.formattedRules).toContain('Test Content');
    });
  });
});

describe('matchRules', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    clearRuleCache();
  });

  afterEach(() => {
    teardownTestDirs();
    if (savedEnvXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedEnvXDG;
    }
    if (savedEnvConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = savedEnvConfigDir;
    }
  });

  it('returns per-rule entries with stripped content', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'entry.md');
    writeFileSync(rulePath, '# Entry Rule\nBody text');

    const entries = await matchRules(toRules([rulePath]));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.filePath).toBe(rulePath);
    expect(entries[0]?.relativePath).toBe('entry.md');
    expect(entries[0]?.strippedContent).toBe('# Entry Rule\nBody text');
  });

  it('filters conditional rules using the runtime context', async () => {
    const { globalRulesDir } = getTestDirs();
    const matchPath = path.join(globalRulesDir, 'kw-match.mdc');
    const skipPath = path.join(globalRulesDir, 'kw-skip.mdc');
    writeFileSync(
      matchPath,
      `---
keywords:
  - testing
---

Matched content.`
    );
    writeFileSync(
      skipPath,
      `---
keywords:
  - database
---

Skipped content.`
    );

    const entries = await matchRules(toRules([matchPath, skipPath]), {
      userPrompt: 'please add testing for this',
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.relativePath).toBe('kw-match.mdc');
  });

  it('returns an empty array for no files', async () => {
    expect(await matchRules([])).toEqual([]);
  });
});

describe('Cross-Dimension Regression Coverage', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    clearRuleCache();
  });

  afterEach(() => {
    teardownTestDirs();
    if (savedEnvXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedEnvXDG;
    }
    if (savedEnvConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = savedEnvConfigDir;
    }
  });

  describe('omitted match behaves as any', () => {
    it('should produce identical behavior with omitted match vs explicit match: any', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const context = {
        modelID: 'claude-opus',
        agentType: 'reviewer',
        os: 'linux',
      };

      const omittedResult = await readAndFormatRules(
        toRules([ruleOmitted]),
        context
      );
      const explicitResult = await readAndFormatRules(
        toRules([ruleExplicit]),
        context
      );

      expect(omittedResult.formattedRules).toContain('Rule with omitted match');
      expect(explicitResult.formattedRules).toContain(
        'Rule with explicit match any'
      );
    });

    it('should exclude rule with omitted match when no dimension matches', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        modelID: 'claude-opus',
        agentType: 'reviewer',
      });

      expect(formattedRules).toBe('');
    });
  });

  describe('mixed legacy + new filters under match: any', () => {
    it('should include rule when only legacy globs match (model, agent mismatch)', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/index.ts'],
        userPrompt: 'help with debugging',
        availableToolIDs: ['mcp_bash'],
        modelID: 'claude-opus',
        agentType: 'reviewer',
      });

      expect(formattedRules).toContain('Mixed legacy and new filters rule');
    });

    it('should include rule when only new model filter matches (all legacy mismatch)', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/index.ts'],
        userPrompt: 'help with typescript',
        availableToolIDs: ['mcp_bash'],
        modelID: 'claude-opus',
        agentType: 'programmer',
      });

      expect(formattedRules).toContain('New model filter matches rule');
    });
  });

  describe('mixed legacy + new filters under match: all', () => {
    it('should include rule when all legacy and new dimensions match', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/utils.ts'],
        userPrompt: 'help me refactor this code',
        availableToolIDs: ['mcp_bash', 'mcp_read'],
        modelID: 'claude-opus',
        agentType: 'programmer',
        os: 'linux',
      });

      expect(formattedRules).toContain('All dimensions match rule');
    });

    it('should exclude rule when one legacy dimension fails (keywords mismatch)', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(toRules([rulePath]), {
        contextFilePaths: ['src/utils.ts'],
        userPrompt: 'help me refactor this code',
        availableToolIDs: ['mcp_bash'],
        modelID: 'claude-opus',
      });

      expect(formattedRules).toBe('');
    });
  });

  describe('unconditional rules injection', () => {
    it('should always include unconditional rules alongside conditional rules', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(
        toRules([unconditionalPath, conditionalPath]),
        { modelID: 'claude-opus' }
      );

      expect(formattedRules).toContain(
        'This rule always applies unconditionally'
      );
      expect(formattedRules).not.toContain('Conditional rule for gpt-5 only');
    });

    it('should include unconditional rules even when filter context is empty', async () => {
      const { globalRulesDir } = getTestDirs();
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

      const { formattedRules } = await readAndFormatRules(
        toRules([unconditionalPath, conditionalPath]),
        {}
      );

      expect(formattedRules).toContain('No metadata means always apply');
      expect(formattedRules).not.toContain('Only for special files');
    });

    it('should include unconditional rules when called with no context at all', async () => {
      const { globalRulesDir } = getTestDirs();
      const unconditionalPath = path.join(globalRulesDir, 'bare.md');

      writeFileSync(
        unconditionalPath,
        '# Bare Rule\nShould always be included.'
      );

      const { formattedRules } = await readAndFormatRules(
        toRules([unconditionalPath])
      );

      expect(formattedRules).toContain('Should always be included');
    });
  });

  describe('matchedPaths tracking', () => {
    it('should return matchedPaths with file paths of included rules', async () => {
      const { globalRulesDir } = getTestDirs();
      const rule1Path = path.join(globalRulesDir, 'rule1.md');
      const rule2Path = path.join(globalRulesDir, 'rule2.md');
      writeFileSync(rule1Path, '# Rule 1\nContent');
      writeFileSync(rule2Path, '# Rule 2\nContent');

      const { formattedRules, matchedPaths } = await readAndFormatRules(
        toRules([rule1Path, rule2Path])
      );

      expect(formattedRules).toContain('Rule 1');
      expect(matchedPaths).toHaveLength(2);
      expect(matchedPaths).toContain(rule1Path);
      expect(matchedPaths).toContain(rule2Path);
    });

    it('should return empty matchedPaths when no rules match', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'conditional.mdc');
      writeFileSync(
        rulePath,
        `---
model:
  - gpt-5
---

Conditional rule.`
      );

      const { formattedRules, matchedPaths } = await readAndFormatRules(
        toRules([rulePath]),
        { modelID: 'claude-opus' }
      );

      expect(formattedRules).toBe('');
      expect(matchedPaths).toHaveLength(0);
    });

    it('should return empty matchedPaths when files array is empty', async () => {
      const { formattedRules, matchedPaths } = await readAndFormatRules([]);

      expect(formattedRules).toBe('');
      expect(matchedPaths).toHaveLength(0);
    });

    it('should only include matching rules in matchedPaths (not filtered-out rules)', async () => {
      const { globalRulesDir } = getTestDirs();
      const includedPath = path.join(globalRulesDir, 'included.mdc');
      const excludedPath = path.join(globalRulesDir, 'excluded.mdc');

      writeFileSync(
        includedPath,
        `---
model:
  - claude-opus
---

Included rule.`
      );
      writeFileSync(
        excludedPath,
        `---
model:
  - gpt-5
---

Excluded rule.`
      );

      const { formattedRules, matchedPaths } = await readAndFormatRules(
        toRules([includedPath, excludedPath]),
        { modelID: 'claude-opus' }
      );

      expect(formattedRules).toContain('Included rule');
      expect(formattedRules).not.toContain('Excluded rule');
      expect(matchedPaths).toHaveLength(1);
      expect(matchedPaths).toContain(includedPath);
      expect(matchedPaths).not.toContain(excludedPath);
    });

    it('should include unconditional rules in matchedPaths', async () => {
      const { globalRulesDir } = getTestDirs();
      const unconditionalPath = path.join(globalRulesDir, 'always.md');

      writeFileSync(unconditionalPath, '# Always\nUnconditional rule.');

      const { matchedPaths } = await readAndFormatRules(
        toRules([unconditionalPath])
      );

      expect(matchedPaths).toHaveLength(1);
      expect(matchedPaths).toContain(unconditionalPath);
    });
  });
});

describe('Conditional rules integration', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    clearRuleCache();
  });

  afterEach(async () => {
    teardownTestDirs();
    vi.resetAllMocks();
    __testOnly.resetSessionState();
    if (savedEnvXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedEnvXDG;
    }
    if (savedEnvConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = savedEnvConfigDir;
    }
  });

  it('should include conditional rule when message context matches glob', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'typescript.mdc'),
      `---
globs:
  - "src/components/**/*.tsx"
---

Use React best practices for components.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const testSessionID = 'test-session-123';
    const messagesOutput = {
      messages: [
        {
          info: { role: 'assistant' },
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

    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: unknown[] }
    ) => Promise<{ messages: unknown[] }>;
    await messagesTransform({}, messagesOutput);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: testSessionID, messageID: 'msg_glob_1' },
      output
    );

    const syntheticText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(syntheticText).toContain('React best practices');
  });

  it('should restore glob context from current tool history after restart', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'typescript.mdc'),
      `---
globs:
  - "src/components/**/*.tsx"
---

Use React best practices for components.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const sessionID = 'test-session-current-history';
    const mockInput = createMockPluginInput({
      testDir,
      history: [
        {
          info: { role: 'assistant', sessionID },
          parts: [
            {
              type: 'tool',
              tool: 'read',
              state: {
                status: 'completed',
                input: { filePath: 'src/components/Button.tsx' },
              },
            },
          ],
        },
      ],
    });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'continue after restart' }],
    };
    await chatMessage({ sessionID, messageID: 'msg_current_history' }, output);

    const syntheticText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(syntheticText).toContain('React best practices');
  });

  it('should exclude conditional rule when message context does not match glob', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'typescript.mdc'),
      `---
globs:
  - "src/components/**/*.tsx"
---

Use React best practices for components.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const testSessionID = 'test-session-456';
    const messagesOutput = {
      messages: [
        {
          info: { role: 'assistant' },
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

    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: unknown[] }
    ) => Promise<{ messages: unknown[] }>;
    await messagesTransform({}, messagesOutput);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: testSessionID, messageID: 'msg_negctx_1' },
      output
    );

    const syntheticText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(syntheticText).not.toContain('React best practices');
  });

  it('should include unconditional rules regardless of context', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
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
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const testSessionID = 'test-session-789';
    const messagesOutput = {
      messages: [
        {
          info: { role: 'user' },
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

    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: unknown[] }
    ) => Promise<{ messages: unknown[] }>;
    await messagesTransform({}, messagesOutput);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: testSessionID, messageID: 'msg_uncond_1' },
      output
    );

    const syntheticText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(syntheticText).toContain('Always Apply');
    expect(syntheticText).toContain('This rule always applies');
    expect(syntheticText).not.toContain('Special rule content');
  });
});

describe('Session compacting behavior', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    clearRuleCache();
  });

  afterEach(async () => {
    teardownTestDirs();
    vi.resetAllMocks();
    __testOnly.resetSessionState();
    if (savedEnvXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedEnvXDG;
    }
    if (savedEnvConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = savedEnvConfigDir;
    }
  });

  it('adds minimal working-set context during compaction', async () => {
    const { testDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    __testOnly.upsertSessionState('ses_c', s => {
      s.contextPaths.add('src/components/Button.tsx');
      s.contextPaths.add('src/utils/helpers.ts');
    });

    const compacting = hooks['experimental.session.compacting'] as (
      input: { sessionID: string },
      output: { context: string[] }
    ) => Promise<void>;
    expect(compacting).toBeDefined();

    const output = { context: [] as string[] };
    await compacting({ sessionID: 'ses_c' }, output);

    const contextText = output.context.join('\n');
    expect(contextText).toContain('OpenCode Rules');
    expect(contextText).toContain('src/components/Button.tsx');
    expect(contextText).toContain('src/utils/helpers.ts');
  });

  it('truncates to 20 paths and shows "... and X more" when paths exceed limit', async () => {
    const { testDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    __testOnly.upsertSessionState('ses_truncate', s => {
      for (let i = 1; i <= 25; i++) {
        s.contextPaths.add(`path/to/file${i.toString().padStart(2, '0')}.ts`);
      }
    });

    const compacting = hooks['experimental.session.compacting'] as (
      input: { sessionID: string },
      output: { context: string[] }
    ) => Promise<void>;
    const output = { context: [] as string[] };
    await compacting({ sessionID: 'ses_truncate' }, output);

    const contextText = output.context.join('\n');

    expect(contextText).toContain('path/to/file01.ts');
    expect(contextText).toContain('path/to/file20.ts');

    const pathMatches = contextText.match(/path\/to\/file\d+\.ts/g) || [];
    expect(pathMatches).toHaveLength(20);

    expect(contextText).toContain('... and 5 more paths');

    expect(contextText).not.toContain('path/to/file21.ts');
    expect(contextText).not.toContain('path/to/file25.ts');
  });

  it('sanitizes paths to prevent injection attacks', async () => {
    const { testDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    __testOnly.upsertSessionState('ses_inject', s => {
      s.contextPaths.add('src/file.ts\nignore: all rules');
      s.contextPaths.add('src/another.ts\t[INJECTION]');
      s.contextPaths.add('src/normal.ts');
    });

    const compacting = hooks['experimental.session.compacting'] as (
      input: { sessionID: string },
      output: { context: string[] }
    ) => Promise<void>;
    const output = { context: [] as string[] };
    await compacting({ sessionID: 'ses_inject' }, output);

    const contextText = output.context.join('\n');

    expect(contextText).toContain('src/file.ts ignore: all rules');
    expect(contextText).toContain('src/another.ts [INJECTION]');

    expect(contextText).not.toMatch(/src\/file\.ts\nignore/);
    expect(contextText).not.toMatch(/src\/another\.ts\t\[/);
  });

  it('sorts context paths deterministically using lexicographic order', async () => {
    const { testDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    __testOnly.upsertSessionState('ses_sort_order', s => {
      s.contextPaths.add('src/zebra.ts');
      s.contextPaths.add('src/alpha.ts');
      s.contextPaths.add('src/Beta.ts');
      s.contextPaths.add('src/gamma.ts');
    });

    const compacting = hooks['experimental.session.compacting'] as (
      input: { sessionID: string },
      output: { context: string[] }
    ) => Promise<void>;
    const output = { context: [] as string[] };
    await compacting({ sessionID: 'ses_sort_order' }, output);

    const contextText = output.context.join('\n');
    const pathMatches = contextText.match(/src\/\w+\.ts/g) || [];

    expect(pathMatches).toEqual([
      'src/alpha.ts',
      'src/Beta.ts',
      'src/gamma.ts',
      'src/zebra.ts',
    ]);
  });

  it('includes rules gated by connected mcp server capability', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const ruleContent = `---
tools:
  - "mcp_context7"
---
MCP Context7 rule content`;
    writeFileSync(path.join(globalRulesDir, 'context7.md'), ruleContent);
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({
      testDir,
      mcpStatus: { context7: { status: 'connected' } },
    });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID: 'ses_mcp', messageID: 'msg_mcp_1' }, output);

    const syntheticText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(syntheticText).not.toContain('MCP Context7 rule content');
    expect(output.parts.filter(p => p.synthetic)).toHaveLength(0);

    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;
    const request = [
      {
        info: { id: 'msg_mcp_req', role: 'user', sessionID: 'ses_mcp' },
        parts: output.parts,
      },
    ];
    await messagesTransform({}, { messages: request });
    const transformedText = request
      .flatMap(message => message.parts as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(transformedText).toContain('MCP Context7 rule content');
  });
});

describe('Synthetic-part delivery lifecycle', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;
  let stateDir: string;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    const { testDir } = getTestDirs();
    stateDir = path.join(testDir, 'state');
    mkdirSync(stateDir, { recursive: true });
    _setStateDirForTesting(stateDir);
    clearRuleCache();
  });

  afterEach(async () => {
    teardownTestDirs();
    _setStateDirForTesting(null);
    vi.resetAllMocks();
    __testOnly.resetSessionState();
    if (savedEnvXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedEnvXDG;
    }
    if (savedEnvConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = savedEnvConfigDir;
    }
  });

  it('full turn: rules persist once, hook fires mid-turn, delivered transiently then durably', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always Apply\nPersistent rule body.'
    );
    writeFileSync(
      path.join(globalRulesDir, 'lint-hook.mdc'),
      `---\nhooks:\n  - type: PreToolUse\n    tool: bash\n    match: "eslint"\n---\n\nMind the linter.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: {
        message: { role: string };
        parts: Array<{ id?: string; synthetic?: boolean; text?: string }>;
      }
    ) => Promise<void>;
    const before = hooks['tool.execute.before'] as (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => Promise<void>;
    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: unknown[] }
    ) => Promise<{ messages: unknown[] }>;

    // Turn 1: user message — rule part persisted
    const turn1: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'run the linter' }],
    };
    await chatMessage(
      { sessionID: 'ses_life', messageID: 'msg_life_1' },
      turn1
    );
    const turn1Synthetic = turn1.parts.filter(p => p.synthetic);
    expect(turn1Synthetic).toHaveLength(2);
    expect(turn1Synthetic.map(p => p.text)).toContain(
      '## always.md\n\n# Always Apply\nPersistent rule body.'
    );
    expect(turn1Synthetic.map(p => p.text)).not.toContain('Mind the linter.');

    // Mid-turn: hook fires on a tool call
    await before(
      { tool: 'bash', sessionID: 'ses_life', callID: 'call_1' },
      { args: { command: 'npx eslint src/' } }
    );

    // Next dispatch within the turn: transient delivery at the tail
    const dispatch: Array<Record<string, unknown>> = [
      {
        info: { id: 'msg_u1', role: 'user', sessionID: 'ses_life' },
        parts: [...turn1.parts],
      },
      {
        info: { id: 'msg_a1', role: 'assistant', sessionID: 'ses_life' },
        parts: [{ type: 'text', text: 'running tools...' }],
      },
    ];
    await messagesTransform({}, { messages: dispatch });
    expect(dispatch).toHaveLength(3);
    const transient = dispatch[2] as {
      parts: Array<{ id?: string; synthetic?: boolean; text?: string }>;
    };
    expect(transient.parts.some(p => p.text === 'Mind the linter.')).toBe(true);

    // Turn 2: user message — hook text lands durably, rule not duplicated
    const turn2: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'thanks' }],
    };
    await chatMessage(
      { sessionID: 'ses_life', messageID: 'msg_life_2' },
      turn2
    );
    const syntheticIds = turn2.parts.filter(p => p.synthetic).map(p => p.id);
    expect(syntheticIds.some(id => id?.startsWith('prt_rules_'))).toBe(false);
    expect(syntheticIds.some(id => id?.startsWith('prt_hook_'))).toBe(true);
    const durableHook = turn2.parts.find(
      p => p.synthetic && p.id?.startsWith('prt_hook_')
    );
    expect(durableHook?.text).toBe('Mind the linter.');

    // Post-durable dispatch: transient injection suppressed (durable part present)
    const dispatch2: Array<Record<string, unknown>> = [
      {
        info: { id: 'msg_u2', role: 'user', sessionID: 'ses_life' },
        parts: [...turn1.parts],
      },
      {
        info: { id: 'msg_u3', role: 'user', sessionID: 'ses_life' },
        parts: [...turn2.parts],
      },
    ];
    await messagesTransform({}, { messages: dispatch2 });
    expect(dispatch2).toHaveLength(2);
  });

  it('restart: history scan suppresses duplicate rule parts on first new message', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'persisted.md'),
      'Persisted rule body.'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    // Simulated persisted history from before the restart
    const history = [
      {
        info: { id: 'msg_u0', role: 'user', sessionID: 'ses_restart' },
        parts: [
          { type: 'text', text: 'original question' },
          buildRulePart('persisted.md', 'Persisted rule body.'),
        ],
      },
    ];

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({
      testDir,
      history,
    });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: {
        message: { role: string };
        parts: Array<{ synthetic?: boolean }>;
      }
    ) => Promise<void>;

    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'continuing after restart' }],
    };
    await chatMessage(
      { sessionID: 'ses_restart', messageID: 'msg_restart_1' },
      output
    );

    expect(output.parts.filter(p => p.synthetic)).toHaveLength(0);
  });

  it('compaction: rules re-appended on the next user message after compaction', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always Apply\nCompaction survivor.'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: {
        message: { role: string };
        parts: Array<{ id?: string; synthetic?: boolean; text?: string }>;
      }
    ) => Promise<void>;
    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: unknown[] }
    ) => Promise<{ messages: unknown[] }>;
    const compacting = hooks['experimental.session.compacting'] as (
      input: { sessionID: string },
      output: { context: string[] }
    ) => Promise<void>;

    // Turn 1: rule part injected
    const turn1: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'first' }],
    };
    await chatMessage(
      { sessionID: 'ses_comp', messageID: 'msg_comp_1' },
      turn1
    );
    expect(turn1.parts.filter(p => p.synthetic)).toHaveLength(1);

    // Compaction fires (empty contextPaths is fine — flag set unconditionally)
    await compacting({ sessionID: 'ses_comp' }, { context: [] });

    // Post-compaction dispatch rebuilds the durable history ledger.
    await messagesTransform(
      {},
      {
        messages: [
          {
            info: { id: 'msg_u1', role: 'user', sessionID: 'ses_comp' },
            parts: [{ type: 'text', text: 'first' }],
          },
        ],
      }
    );
    // Turn 2: rule re-appended
    const turn2: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'second' }],
    };
    await chatMessage(
      { sessionID: 'ses_comp', messageID: 'msg_comp_2' },
      turn2
    );
    const reappended = turn2.parts.filter(p => p.synthetic);
    expect(reappended).toHaveLength(1);
    expect(reappended[0]?.text).toContain('Compaction survivor.');
  });
});
