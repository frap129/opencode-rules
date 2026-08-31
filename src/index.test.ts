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
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from 'vitest';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { clearRuleCache } from './rules/rule-discovery.js';
import { __testOnly } from './index.js';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  saveCiEnvVars,
  clearCiEnvVars,
  restoreCiEnvVars,
  type CiEnvSnapshot,
} from './test-fixtures.js';

const originalDebugEnv = vi.hoisted(() => {
  const value = process.env.OPENCODE_RULES_DEBUG;
  delete process.env.OPENCODE_RULES_DEBUG;
  return value;
});

afterAll(() => {
  if (originalDebugEnv === undefined) {
    delete process.env.OPENCODE_RULES_DEBUG;
  } else {
    process.env.OPENCODE_RULES_DEBUG = originalDebugEnv;
  }
});

type ChatMessageOutputLike = {
  message: { role: string; model?: { modelID: string }; agent?: string };
  parts: Array<{
    id?: string;
    type?: string;
    text?: string;
    synthetic?: boolean;
  }>;
};

describe('Runtime match context integration (plugin-level)', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;
  let savedCiEnv: CiEnvSnapshot;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
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
    if (savedEnvConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = savedEnvConfigDir;
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
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
      input: {
        sessionID: string;
        model?: { modelID: string };
        messageID?: string;
      },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      {
        sessionID: 'ses_model_test',
        model: { modelID: 'claude-opus' },
        messageID: 'msg_model_test_1',
      },
      output
    );

    const injectedText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;
    const sessionID = 'ses_model_test';
    const expectedRuleText = 'Model-specific guidelines';
    const request = [
      {
        info: { id: 'msg_ephemeral_check', role: 'user', sessionID },
        parts: output.parts,
      },
    ];
    await messagesTransform({}, { messages: request });
    const transformedText = request
      .flatMap(message => message.parts as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(injectedText).not.toContain(expectedRuleText);
    expect(output.parts.filter(part => part.synthetic)).toHaveLength(0);
    expect(transformedText).toContain(expectedRuleText);
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
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
      input: { sessionID: string; agent?: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      {
        sessionID: 'ses_agent_test',
        agent: 'programmer',
        messageID: 'msg_agent_test_1',
      },
      output
    );

    const injectedText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;
    const sessionID = 'ses_agent_test';
    const expectedRuleText = 'Agent-specific guidelines';
    const request = [
      {
        info: { id: 'msg_ephemeral_check', role: 'user', sessionID },
        parts: output.parts,
      },
    ];
    await messagesTransform({}, { messages: request });
    const transformedText = request
      .flatMap(message => message.parts as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(injectedText).not.toContain(expectedRuleText);
    expect(output.parts.filter(part => part.synthetic)).toHaveLength(0);
    expect(transformedText).toContain(expectedRuleText);
  });

  it('should evaluate model and agent rules from output.message context', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'matching-context.mdc'),
      `---
model:
  - output-model
agent:
  - output-agent
---

Matching output context.`
    );
    writeFileSync(
      path.join(globalRulesDir, 'nonmatching-context.mdc'),
      `---
model:
  - another-model
agent:
  - another-agent
---

Nonmatching output context.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
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
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: {
        role: 'user',
        model: { modelID: 'output-model' },
        agent: 'output-agent',
      },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: 'ses_output_context', messageID: 'msg_output_context_1' },
      output
    );

    const injectedText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;
    const sessionID = 'ses_output_context';
    const request = [
      {
        info: { id: 'msg_ephemeral_check', role: 'user', sessionID },
        parts: output.parts,
      },
    ];
    await messagesTransform({}, { messages: request });
    const transformedText = request
      .flatMap(message => message.parts as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(injectedText).not.toContain('Matching output context.');
    expect(output.parts.filter(part => part.synthetic)).toHaveLength(0);
    expect(transformedText).toContain('Matching output context.');
    expect(transformedText).not.toContain('Nonmatching output context.');
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
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
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: '/plan implement a new feature' }],
    };
    await chatMessage(
      { sessionID: 'ses_cmd_test', messageID: 'msg_cmd_test_1' },
      output
    );

    const injectedText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(injectedText).toContain('Planning guidelines');
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
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
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const message: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID: 'ses_os', messageID: 'msg_os_1' }, message);

    const injectedText = message.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(injectedText).toContain('Platform-specific guidelines');
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
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
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const message: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: 'ses_ci_auth', messageID: 'msg_ci_auth_1' },
      message
    );

    const injectedText = message.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(injectedText).not.toContain('CI-authoritative guidelines');
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
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
      input: {
        sessionID: string;
        model?: { modelID: string };
        agent?: string;
        messageID?: string;
      },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: '/plan implement something' }],
    };
    await chatMessage(
      {
        sessionID: 'ses_all',
        model: { modelID: 'claude-opus' },
        agent: 'programmer',
        messageID: 'msg_all_1',
      },
      output
    );

    const injectedText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;
    const sessionID = 'ses_all';
    const expectedRuleText = 'All dimensions must match';
    const request = [
      {
        info: { id: 'msg_ephemeral_check', role: 'user', sessionID },
        parts: output.parts,
      },
    ];
    await messagesTransform({}, { messages: request });
    const transformedText = request
      .flatMap(message => message.parts as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(injectedText).not.toContain(expectedRuleText);
    expect(output.parts.filter(part => part.synthetic)).toHaveLength(0);
    expect(transformedText).toContain(expectedRuleText);
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
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
      input: {
        sessionID: string;
        model?: { modelID: string };
        agent?: string;
        messageID?: string;
      },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'just a regular prompt' }],
    };
    await chatMessage(
      {
        sessionID: 'ses_fail',
        model: { modelID: 'claude-opus' },
        agent: 'programmer',
        messageID: 'msg_fail_1',
      },
      output
    );

    const injectedText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(injectedText).not.toContain('All dimensions must match');
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: projectDir,
      worktree: projectDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const message: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: 'ses_proj_tags', messageID: 'msg_proj_tags_1' },
      message
    );

    const injectedText = message.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(injectedText).toContain('Node.js project guidelines');
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

    const gitBranchModule = await import('./detection/git-branch.js');
    const getGitBranchSpy = vi
      .spyOn(gitBranchModule, 'getGitBranch')
      .mockResolvedValue('feature/add-login');

    try {
      const {
        default: { server: plugin },
      } = await import('./index.js');
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
        input: { sessionID: string; messageID?: string },
        output: ChatMessageOutputLike
      ) => Promise<void>;
      const message: ChatMessageOutputLike = {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'hello' }],
      };
      await chatMessage(
        { sessionID: 'ses_branch', messageID: 'msg_branch_1' },
        message
      );

      const injectedText = message.parts
        .filter(p => p.synthetic)
        .map(p => p.text)
        .join('\n');
      const messagesTransform = hooks[
        'experimental.chat.messages.transform'
      ] as (
        input: unknown,
        output: { messages: Array<Record<string, unknown>> }
      ) => Promise<void>;
      const sessionID = 'ses_branch';
      const expectedRuleText = 'Feature branch guidelines';
      const request = [
        {
          info: { id: 'msg_ephemeral_check', role: 'user', sessionID },
          parts: message.parts,
        },
      ];
      await messagesTransform({}, { messages: request });
      const transformedText = request
        .flatMap(msg => msg.parts as Array<{ text?: string }>)
        .map(part => part.text ?? '')
        .join('\n');
      expect(injectedText).not.toContain(expectedRuleText);
      expect(message.parts.filter(part => part.synthetic)).toHaveLength(0);
      expect(transformedText).toContain(expectedRuleText);
      expect(getGitBranchSpy).toHaveBeenCalled();
    } finally {
      getGitBranchSpy.mockRestore();
    }
  });

  it('should suppress warnings via console.warn for tool query failures', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'unconditional.md'),
      'Always apply.'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const {
        default: { server: plugin },
      } = await import('./index.js');
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

      const chatMessage = hooks['chat.message'] as (
        input: { sessionID: string },
        output: ChatMessageOutputLike
      ) => Promise<void>;
      const message: ChatMessageOutputLike = {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'hello' }],
      };
      await chatMessage({ sessionID: 'ses_toolwarn' }, message);

      expect(warnSpy).not.toHaveBeenCalled();
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: path.join(testDir, 'nonexistent-project'),
      worktree: testDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const message: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: 'ses_tags_fail', messageID: 'msg_tags_fail_1' },
      message
    );

    const injectedText = message.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(injectedText).toContain('Always apply this rule');
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockClient = { tool: { ids: vi.fn(async () => ({ data: [] })) } };
    const hooks = await plugin({
      client: mockClient as unknown,
      project: {},
      directory: nonGitDir,
      worktree: nonGitDir,
      $: {},
      serverUrl: new URL('http://localhost'),
    } as Parameters<typeof plugin>[0]);

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;
    const message: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: 'ses_branch_fail', messageID: 'msg_branch_fail_1' },
      message
    );

    const injectedText = message.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(injectedText).toContain('Always apply this rule');
  });
});
