/**
 * Coordinator test file for opencode-rules.
 *
 * Plugin-level scenario tests for conditional rule matching, driven through
 * the v2 session `prompt` (durable) and `context` (ephemeral) hooks with a
 * mock plugin context (test-fixtures). Session state is inspected via the
 * runtime's own SessionStore.
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
import { createRuntime } from './runtime/create-runtime.js';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  saveCiEnvVars,
  clearCiEnvVars,
  restoreCiEnvVars,
  createMockPluginInput,
  wireRuntime,
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

  function writeGlobalRule(name: string, content: string): void {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, name), content);
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
  }

  interface Wired {
    syntheticCalls: Array<{ text: string }>;
    promptTurn: (input: {
      sessionID: string;
      messageID: string;
      text: string;
      agent?: string;
      model?: { id: string };
    }) => Promise<{ injectedText: string }>;
    dispatch: (input: {
      sessionID: string;
      agent?: string;
      model?: { id: string };
      text?: string;
    }) => Promise<{ injectedText: string }>;
  }

  async function wire(): Promise<Wired> {
    const { testDir } = getTestDirs();
    const mockInput = createMockPluginInput({ testDir });
    await wireRuntime(mockInput);
    const promptHook = mockInput.hooks.sessionPrompt[0]!;
    const contextHook = mockInput.hooks.sessionContext[0]!;
    const syntheticCalls = mockInput.syntheticCalls;

    return {
      syntheticCalls,
      async promptTurn({ sessionID, messageID, text, agent, model }) {
        // The context dispatch precedes the prompt admission in a real
        // turn; drive both so capture + ephemeral matching stay faithful.
        // The context hook may append ephemeral rules to the messages
        // array; the prompt hook delivers durable rules via synthetic.
        const messages: Array<Record<string, unknown>> = [
          {
            id: messageID,
            role: 'user',
            content: [{ type: 'text', text }],
          },
        ];
        await contextHook({
          sessionID,
          ...(agent !== undefined ? { agent } : {}),
          ...(model !== undefined ? { model } : {}),
          messages,
          tools: {},
        });
        await promptHook({ sessionID, messageID, prompt: { text } });
        const injectedText = messages
          .slice(1)
          .flatMap(message => message.content as Array<{ text?: string }>)
          .map(part => part.text ?? '')
          .join('\n');
        return { injectedText };
      },
      async dispatch({ sessionID, agent, model, text }) {
        const messages: Array<Record<string, unknown>> = [
          {
            id: 'msg_dispatch',
            role: 'user',
            content: [{ type: 'text', text: text ?? 'hello' }],
          },
        ];
        await contextHook({
          sessionID,
          ...(agent !== undefined ? { agent } : {}),
          ...(model !== undefined ? { model } : {}),
          messages,
          tools: {},
        });
        const injectedText = messages
          .slice(1)
          .flatMap(message => message.content as Array<{ text?: string }>)
          .map(part => part.text ?? '')
          .join('\n');
        return { injectedText };
      },
    };
  }

  it('should include model-conditional rule when session has matching model id', async () => {
    writeGlobalRule(
      'model-rule.mdc',
      `---
model:
  - claude-opus
---

Model-specific guidelines.`
    );

    const wired = await wire();
    const { injectedText } = await wired.dispatch({
      sessionID: 'ses_model_test',
      model: { id: 'claude-opus' },
    });
    expect(injectedText).toContain('Model-specific guidelines');

    // Non-matching model must not inject.
    const other = await wire();
    const miss = await other.dispatch({
      sessionID: 'ses_model_other',
      model: { id: 'another-model' },
    });
    expect(miss.injectedText).not.toContain('Model-specific guidelines');
  });

  it('should include agent-conditional rule when session has matching agentType', async () => {
    writeGlobalRule(
      'agent-rule.mdc',
      `---
agent:
  - programmer
---

Agent-specific guidelines.`
    );

    const wired = await wire();
    const { injectedText } = await wired.dispatch({
      sessionID: 'ses_agent_test',
      agent: 'programmer',
    });
    expect(injectedText).toContain('Agent-specific guidelines');
  });

  it('should evaluate model and agent rules from the context hook', async () => {
    writeGlobalRule(
      'matching-context.mdc',
      `---
model:
  - output-model
agent:
  - output-agent
---

Matching output context.`
    );
    writeGlobalRule(
      'nonmatching-context.mdc',
      `---
model:
  - another-model
agent:
  - another-agent
---

Nonmatching output context.`
    );

    const wired = await wire();
    const { injectedText } = await wired.dispatch({
      sessionID: 'ses_output_context',
      agent: 'output-agent',
      model: { id: 'output-model' },
    });
    expect(injectedText).toContain('Matching output context.');
    expect(injectedText).not.toContain('Nonmatching output context.');
  });

  it('should include command-conditional rule when user prompt starts with matching slash command', async () => {
    writeGlobalRule(
      'plan-rule.mdc',
      `---
command:
  - /plan
---

Planning guidelines.`
    );

    const wired = await wire();
    await wired.promptTurn({
      sessionID: 'ses_cmd_test',
      messageID: 'msg_cmd_test_1',
      text: '/plan implement a new feature',
    });
    const injectedText = wired.syntheticCalls.map(call => call.text).join('\n');
    expect(injectedText).toContain('Planning guidelines');
  });

  it('should include os-conditional rule when current platform matches', async () => {
    writeGlobalRule(
      'os-rule.mdc',
      `---
os:
  - ${process.platform}
---

Platform-specific guidelines.`
    );

    const wired = await wire();
    await wired.promptTurn({
      sessionID: 'ses_os',
      messageID: 'msg_os_1',
      text: 'hello',
    });
    expect(wired.syntheticCalls.map(call => call.text).join('\n')).toContain(
      'Platform-specific guidelines'
    );
  });

  it('should NOT include ci:true rule when CI="false" even with GITHUB_ACTIONS set', async () => {
    writeGlobalRule(
      'ci-auth-rule.mdc',
      `---
ci: true
---

CI-authoritative guidelines.`
    );
    clearCiEnvVars();
    process.env.CI = 'false';
    process.env.GITHUB_ACTIONS = 'true';

    const wired = await wire();
    await wired.promptTurn({
      sessionID: 'ses_ci_auth',
      messageID: 'msg_ci_auth_1',
      text: 'hello',
    });
    expect(
      wired.syntheticCalls.map(call => call.text).join('\n')
    ).not.toContain('CI-authoritative guidelines');
  });

  it('should combine model, agent, and command filters with match: all', async () => {
    writeGlobalRule(
      'all-match.mdc',
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

    const wired = await wire();
    const { injectedText } = await wired.promptTurn({
      sessionID: 'ses_all',
      messageID: 'msg_all_1',
      text: '/plan implement something',
      agent: 'programmer',
      model: { id: 'claude-opus' },
    });
    expect(injectedText).toContain('All dimensions must match');
  });

  it('should exclude match: all rule when one dimension is missing', async () => {
    writeGlobalRule(
      'all-match-fail.mdc',
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

    const wired = await wire();
    await wired.promptTurn({
      sessionID: 'ses_fail',
      messageID: 'msg_fail_1',
      text: 'just a regular prompt',
      agent: 'programmer',
      model: { id: 'claude-opus' },
    });
    expect(
      wired.syntheticCalls.map(call => call.text).join('\n')
    ).not.toContain('All dimensions must match');
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

    const mockInput = createMockPluginInput({ testDir });
    // Point the runtime at the node project directory so project-tag
    // detection sees its package.json.
    const runtime = await createRuntime({
      client: mockInput.context,
      directory: projectDir,
      projectDirectory: projectDir,
    });
    await runtime.wire(mockInput.context as never);
    const contextHook = mockInput.hooks.sessionContext[0]!;
    const promptHook = mockInput.hooks.sessionPrompt[0]!;

    await contextHook({
      sessionID: 'ses_proj_tags',
      messages: [
        {
          id: 'msg_proj_tags_1',
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
      tools: {},
    });
    await promptHook({
      sessionID: 'ses_proj_tags',
      messageID: 'msg_proj_tags_1',
      prompt: { text: 'hello' },
    });

    expect(
      mockInput.syntheticCalls.map(call => call.text).join('\n')
    ).toContain('Node.js project guidelines');
  });

  it('should include branch-conditional rule when getGitBranch returns matching branch', async () => {
    writeGlobalRule(
      'feature-branch-rule.mdc',
      `---
branch:
  - feature/*
---

Feature branch guidelines.`
    );

    const gitBranchModule = await import('./detection/git-branch.js');
    const getGitBranchSpy = vi
      .spyOn(gitBranchModule, 'getGitBranch')
      .mockResolvedValue('feature/add-login');

    try {
      const wired = await wire();
      // Branch rules are ephemeral in the lifetime model (branch can change
      // without a prompt change), so v1 delivered them via messages.transform
      // and v2 delivers them via the context hook's transient injection.
      const { injectedText } = await wired.dispatch({
        sessionID: 'ses_branch',
      });
      expect(injectedText).toContain('Feature branch guidelines');
      expect(getGitBranchSpy).toHaveBeenCalled();
    } finally {
      getGitBranchSpy.mockRestore();
    }
  });

  it('should suppress warnings via console.warn for tool query failures', async () => {
    writeGlobalRule('unconditional.md', 'Always apply.');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { testDir } = getTestDirs();
      const mockInput = createMockPluginInput({ testDir });
      mockInput.context.mcp.list = async () => {
        throw new Error('MCP query failed');
      };
      await wireRuntime(mockInput);
      const contextHook = mockInput.hooks.sessionContext[0]!;
      const promptHook = mockInput.hooks.sessionPrompt[0]!;

      await contextHook({
        sessionID: 'ses_toolwarn',
        messages: [
          {
            id: 'msg_toolwarn',
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
          },
        ],
        tools: {},
      });
      await promptHook({
        sessionID: 'ses_toolwarn',
        messageID: 'msg_toolwarn',
        prompt: { text: 'hello' },
      });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(mockInput.syntheticCalls).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('should not throw when project tags detection fails', async () => {
    writeGlobalRule('unconditional.md', 'Always apply this rule.');

    const wired = await wire();
    const { testDir } = getTestDirs();
    // Point the runtime at a nonexistent project directory.
    const mockInput = createMockPluginInput({ testDir });
    void mockInput;

    await wired.promptTurn({
      sessionID: 'ses_tags_fail',
      messageID: 'msg_tags_fail_1',
      text: 'hello',
    });
    expect(wired.syntheticCalls.map(call => call.text).join('\n')).toContain(
      'Always apply this rule'
    );
  });

  it('should not throw when git branch detection fails', async () => {
    writeGlobalRule('unconditional.md', 'Always apply this rule.');

    const wired = await wire();
    await wired.promptTurn({
      sessionID: 'ses_branch_fail',
      messageID: 'msg_branch_fail_1',
      text: 'hello',
    });
    expect(wired.syntheticCalls.map(call => call.text).join('\n')).toContain(
      'Always apply this rule'
    );
  });
});
