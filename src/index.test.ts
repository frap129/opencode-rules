/**
 * Coordinator test file for opencode-rules.
 *
 * This file was refactored from a large 6000+ line monolithic test suite.
 * Tests are now organized into focused test files:
 *
 * - index.rules.test.ts: Rule parsing, metadata extraction, filtering logic
 * - index.runtime.test.ts: Runtime behavior, session state, module boundaries
 * - index.integration.test.ts: End-to-end integration tests
 *
 * This file retains tests that have complex plugin-level setup or
 * are not yet migrated. New tests should be added to the appropriate
 * focused test file above.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { readAndFormatRules, clearRuleCache } from './utils.js';
import { __testOnly } from './index.js';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  toRules,
  saveCiEnvVars,
  clearCiEnvVars,
  restoreCiEnvVars,
  type CiEnvSnapshot,
} from './test-fixtures.js';

// Retained plugin-level tests with complex runtime filter context
describe('Runtime filter context integration (plugin-level)', () => {
  let savedEnvXDG: string | undefined;
  let savedCiEnv: CiEnvSnapshot;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedCiEnv = saveCiEnvVars();
    clearRuleCache();
  });

  afterEach(async () => {
    teardownTestDirs();
    vi.resetAllMocks();
    __testOnly.resetSessionState();
    restoreCiEnvVars(savedCiEnv);
    if (savedEnvXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedEnvXDG;
    }
  });

  it('should include model-conditional rule when session has matching modelID', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'model-rule.mdc'),
      `---
model:
  - claude-opus
---

Model-specific guidelines.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: testDir,
      worktree: testDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; model?: { modelID: string } },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;
    await chatMessage(
      { sessionID: 'ses_model_test', model: { modelID: 'claude-opus' } },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'hello' }],
      }
    );

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      { sessionID: 'ses_model_test' },
      { system: 'Base prompt.' }
    );

    expect(result.system).toContain('Model-specific guidelines');
  });

  it('should include agent-conditional rule when session has matching agentType', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'agent-rule.mdc'),
      `---
agent:
  - programmer
---

Agent-specific guidelines.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: testDir,
      worktree: testDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; agent?: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;
    await chatMessage(
      { sessionID: 'ses_agent_test', agent: 'programmer' },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'hello' }],
      }
    );

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      { sessionID: 'ses_agent_test' },
      { system: 'Base prompt.' }
    );

    expect(result.system).toContain('Agent-specific guidelines');
  });

  it('should include command-conditional rule when user prompt starts with matching slash command', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'plan-rule.mdc'),
      `---
command:
  - /plan
---

Planning guidelines.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: testDir,
      worktree: testDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;
    await chatMessage(
      { sessionID: 'ses_cmd_test' },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: '/plan implement a new feature' }],
      }
    );

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      { sessionID: 'ses_cmd_test' },
      { system: 'Base prompt.' }
    );

    expect(result.system).toContain('Planning guidelines');
  });

  it('should include os-conditional rule when current platform matches', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const currentPlatform = process.platform;
    writeFileSync(
      path.join(globalRulesDir, 'os-rule.mdc'),
      `---
os:
  - ${currentPlatform}
---

Platform-specific guidelines.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: testDir,
      worktree: testDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).toContain('Platform-specific guidelines');
  });

  it('should NOT include ci:true rule when CI="false" even with GITHUB_ACTIONS set', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'ci-auth-rule.mdc'),
      `---
ci: true
---

CI-authoritative guidelines.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    clearCiEnvVars();
    process.env.CI = 'false';
    process.env.GITHUB_ACTIONS = 'true';

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: testDir,
      worktree: testDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).not.toContain('CI-authoritative guidelines');
  });

  it('should combine model, agent, and command filters with match: all', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
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
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: testDir,
      worktree: testDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; model?: { modelID: string }; agent?: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;
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

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      { sessionID: 'ses_all' },
      { system: 'Base prompt.' }
    );

    expect(result.system).toContain('All dimensions must match');
  });

  it('should exclude match: all rule when one dimension is missing', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
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
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: testDir,
      worktree: testDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; model?: { modelID: string }; agent?: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;
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

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      { sessionID: 'ses_fail' },
      { system: 'Base prompt.' }
    );

    expect(result.system).not.toContain('All dimensions must match');
  });

  it('should include project-conditional rule when project has matching tags', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
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
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: projectDir,
      worktree: projectDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).toContain('Node.js project guidelines');
  });

  it('should include branch-conditional rule when getGitBranch returns matching branch', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'feature-branch-rule.mdc'),
      `---
branch:
  - feature/*
---

Feature branch guidelines.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const gitBranchModule = await import('./git-branch.js');
    const getGitBranchSpy = vi
      .spyOn(gitBranchModule, 'getGitBranch')
      .mockResolvedValue('feature/add-login');

    try {
      const { default: plugin } = await import('./index.js');
      const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
      const hooks = await plugin({
        client: mockClient as unknown,
        project: {},
        directory: testDir,
        worktree: testDir,
        $: {},
        serverUrl: new URL('http://localhost'),
      } as Parameters<typeof plugin>[0]);

      const systemTransform = hooks['experimental.chat.system.transform'] as (
        input: unknown,
        output: { system: string }
      ) => Promise<{ system: string }>;
      const result = await systemTransform({}, { system: 'Base prompt.' });

      expect(result.system).toContain('Feature branch guidelines');
      expect(getGitBranchSpy).toHaveBeenCalled();
    } finally {
      getGitBranchSpy.mockRestore();
    }
  });

  it('should log warnings via console.warn for tool query failures', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'unconditional.md'),
      'Always apply.'
    );
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
        client: mockClient as unknown,
        project: {},
        directory: testDir,
        worktree: testDir,
        $: {},
        serverUrl: new URL('http://localhost'),
      } as Parameters<typeof plugin>[0]);

      const systemTransform = hooks['experimental.chat.system.transform'] as (
        input: unknown,
        output: { system: string }
      ) => Promise<{ system: string }>;
      await systemTransform({}, { system: 'Base prompt.' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Failed to query tool IDs')
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('should not throw when project tags detection fails', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'unconditional.md'),
      'Always apply this rule.'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: path.join(testDir, 'nonexistent-project'),
      worktree: testDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).toContain('Always apply this rule');
  });

  it('should not throw when git branch detection fails', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'unconditional.md'),
      'Always apply this rule.'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const nonGitDir = path.join(testDir, 'not-a-git-repo');
    mkdirSync(nonGitDir, { recursive: true });

    const { default: plugin } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: nonGitDir,
      worktree: nonGitDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).toContain('Always apply this rule');
  });
});

// Retained API contract tests
describe('readAndFormatRules API contract', () => {
  let savedEnvXDG: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    clearRuleCache();
  });

  afterEach(() => {
    teardownTestDirs();
    if (savedEnvXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedEnvXDG;
    }
  });

  it('should only accept RuleFilterContext object as second argument', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'tools-rule.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - mcp_websearch
---

Tools rule.`
    );

    const formatted = await readAndFormatRules(toRules([rulePath]), {
      userPrompt: 'some prompt',
      availableToolIDs: ['mcp_websearch', 'mcp_bash'],
    });

    expect(formatted).toContain('tools-rule.mdc');
    expect(formatted).toContain('Tools rule');
  });

  it('should ignore array passed as second arg (legacy positional pattern rejected)', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'legacy-reject-globs.mdc');
    writeFileSync(
      rulePath,
      `---
globs:
  - "src/**/*.ts"
---

Legacy globs rule.`
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formatted = await readAndFormatRules(toRules([rulePath]), [
      'src/app.ts',
    ] as any);

    expect(formatted).toBe('');
  });

  it('should ignore third positional arg (legacy userPrompt rejected)', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'legacy-reject-keywords.mdc');
    writeFileSync(
      rulePath,
      `---
keywords:
  - testing
---

Legacy keywords rule.`
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formatted = await (readAndFormatRules as any)(
      toRules([rulePath]),
      {},
      'help with testing'
    );

    expect(formatted).toBe('');
  });

  it('should ignore fourth positional arg (legacy availableToolIDs rejected)', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'legacy-reject-tools.mdc');
    writeFileSync(
      rulePath,
      `---
tools:
  - mcp_websearch
---

Legacy tools rule.`
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formatted = await (readAndFormatRules as any)(
      toRules([rulePath]),
      {},
      undefined,
      ['mcp_websearch', 'mcp_bash']
    );

    expect(formatted).toBe('');
  });
});
