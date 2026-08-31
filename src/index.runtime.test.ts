/**
 * Tests for OpenCodeRulesPlugin runtime behavior and session state management.
 * Split from index.test.ts for maintainability.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  createMockPluginInput,
  createHooksWithStore,
  saveCiEnvVars,
  clearCiEnvVars,
  restoreCiEnvVars,
  type CiEnvSnapshot,
} from './test-fixtures.js';

import * as ruleDiscoveryModule from './rules/rule-discovery.js';
import * as ruleMetadataModule from './rules/rule-metadata.js';
import * as ruleFilterModule from './rules/rule-filter.js';
import * as messagePathsModule from './session/message-extraction.js';
import * as ruleHooksModule from './rules/rule-hooks.js';
import * as sessionStoreModule from './session/session-store.js';
import * as matchedRulesStateModule from './session/matched-rules-state.js';
import * as runtimeContextModule from './runtime/match-context.js';
import * as runtimeChatModule from './runtime/chat-capture.js';
import { __testOnly } from './index.js';
import {
  MatchedRulesStateStore,
  readMatchedRulesState,
} from './session/matched-rules-state.js';
import { clearRuleCache } from './rules/rule-discovery.js';
import { buildDurableDeliveryPart } from './delivery/rule-delivery-codec.js';

describe('module boundary tests', () => {
  it('should export discoverRuleFiles from rule-discovery module', () => {
    expect(ruleDiscoveryModule.discoverRuleFiles).toBeDefined();
    expect(typeof ruleDiscoveryModule.discoverRuleFiles).toBe('function');
  });

  it('should export parseRuleMetadata from rule-metadata module', () => {
    expect(ruleMetadataModule.parseRuleMetadata).toBeDefined();
    expect(typeof ruleMetadataModule.parseRuleMetadata).toBe('function');
  });

  it('should export promptMatchesKeywords and toolsMatchAvailable from rule-filter module', () => {
    expect(ruleFilterModule.promptMatchesKeywords).toBeDefined();
    expect(ruleFilterModule.toolsMatchAvailable).toBeDefined();
    expect(typeof ruleFilterModule.promptMatchesKeywords).toBe('function');
    expect(typeof ruleFilterModule.toolsMatchAvailable).toBe('function');
  });

  it('should export extractFilePathsFromMessages from message-extraction module', () => {
    expect(messagePathsModule.extractFilePathsFromMessages).toBeDefined();
    expect(typeof messagePathsModule.extractFilePathsFromMessages).toBe(
      'function'
    );
  });

  it('should export clearRuleCache from rule-discovery module', () => {
    expect(ruleDiscoveryModule.clearRuleCache).toBeDefined();
    expect(typeof ruleDiscoveryModule.clearRuleCache).toBe('function');
  });

  it('should export DiscoveredRule type from rule-discovery module', () => {
    const rule: ruleDiscoveryModule.DiscoveredRule = {
      filePath: '/test/rule.md',
      relativePath: 'rule.md',
    };
    expect(rule.filePath).toBe('/test/rule.md');
  });

  it('should export RuleMatchContext type from rule-filter module', () => {
    const context: ruleFilterModule.RuleMatchContext = {
      userPrompt: 'test',
      fileObservations: [{ path: 'src/test.ts', tool: 'read', content: '' }],
    };
    expect(context.userPrompt).toBe('test');
  });

  it('should export Message and MessagePart types from message-extraction module', () => {
    const msg: messagePathsModule.Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    };
    expect(msg.role).toBe('user');
  });

  it('should export buildRuleMatchContext from match-context module', () => {
    expect(runtimeContextModule.buildRuleMatchContext).toBeDefined();
    expect(typeof runtimeContextModule.buildRuleMatchContext).toBe('function');
  });

  it('should export detectCiEnvironment from match-context module', () => {
    expect(runtimeContextModule.detectCiEnvironment).toBeDefined();
    expect(typeof runtimeContextModule.detectCiEnvironment).toBe('function');
  });

  it('should export updateSessionFromChatMessage from chat-capture module', () => {
    expect(runtimeChatModule.updateSessionFromChatMessage).toBeDefined();
    expect(typeof runtimeChatModule.updateSessionFromChatMessage).toBe(
      'function'
    );
  });

  it('should detect CI environment correctly via match-context module', () => {
    const originalCI = process.env.CI;

    process.env.CI = 'true';
    expect(runtimeContextModule.detectCiEnvironment()).toBe(true);

    process.env.CI = 'false';
    expect(runtimeContextModule.detectCiEnvironment()).toBe(false);

    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
  });

  it('should export evaluateHooks and serializeToolArgs from rule-hooks module', () => {
    expect(ruleHooksModule.evaluateHooks).toBeDefined();
    expect(ruleHooksModule.serializeToolArgs).toBeDefined();
    expect(typeof ruleHooksModule.evaluateHooks).toBe('function');
    expect(typeof ruleHooksModule.serializeToolArgs).toBe('function');
  });
});

describe('OpenCodeRulesPlugin', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  afterEach(() => {
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

  it('should export a plugin module with id and server', async () => {
    const { default: pluginModule } = await import('./index.js');
    expect(pluginModule).toHaveProperty('id', 'opencode-rules');
    expect(typeof pluginModule.server).toBe('function');
  });

  it('should return transform hooks even when no rules exist', async () => {
    const { testDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, 'empty-config');
    mkdirSync(path.join(testDir, 'empty-config', 'opencode', 'rules'), {
      recursive: true,
    });

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({
      testDir: path.join(testDir, 'empty-project'),
    });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    expect(hooks['experimental.chat.messages.transform']).toBeDefined();
    expect(typeof hooks['experimental.chat.messages.transform']).toBe(
      'function'
    );
    expect(hooks['chat.message']).toBeDefined();
    expect(typeof hooks['chat.message']).toBe('function');
  });

  it('should register all six runtime host hooks', async () => {
    const { testDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    expect(Object.keys(hooks).sort()).toEqual([
      'chat.message',
      'event',
      'experimental.chat.messages.transform',
      'experimental.session.compacting',
      'tool.execute.after',
      'tool.execute.before',
    ]);
    for (const hook of Object.values(hooks)) {
      expect(typeof hook).toBe('function');
    }
  });

  it('should return transform hooks when rules exist', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Test Rule');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    expect(hooks['experimental.chat.messages.transform']).toBeDefined();
    expect(hooks['chat.message']).toBeDefined();
  });

  it('does not register experimental.chat.system.transform', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Test Rule');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    expect(hooks['experimental.chat.system.transform']).toBeUndefined();
    expect(hooks['chat.message']).toBeDefined();
  });

  it('modifies messages only by appending transient synthetic parts', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const originalMessages = [
      {
        info: { role: 'user' },
        parts: [{ sessionID: 'test-123', type: 'text', text: 'Hello' }],
      },
    ];

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const messagesTransform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: unknown[] }
    ) => Promise<{ messages: unknown[] }>;
    const result = await messagesTransform({}, { messages: originalMessages });

    expect(result.messages).toEqual(originalMessages);
  });

  it('seeds session state once from messages.transform and does not rescan', async () => {
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    let historyReads = 0;
    mockInput.client.session.messages = async () => {
      historyReads++;
      return { data: [] };
    };

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: unknown[] }
    ) => Promise<{ messages: unknown[] }>;

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

    await transform({}, messages);
    await transform({}, messages);

    expect(historyReads).toBe(0);
  });

  it('seeds context paths from current OpenCode tool parts', async () => {
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: unknown[] }
    ) => Promise<{ messages: unknown[] }>;

    await transform(
      {},
      {
        messages: [
          {
            info: { role: 'assistant' },
            parts: [
              {
                sessionID: 'ses_current_seed',
                type: 'tool',
                tool: 'read',
                state: {
                  status: 'completed',
                  input: { filePath: 'src/current.ts' },
                },
              },
            ],
          },
        ],
      }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_current_seed');
    expect(snapshot?.workingContextPaths.has('src/current.ts')).toBe(true);
    expect(snapshot?.workingContextSeeded).toBe(true);
  });

  it('throws when PreToolUse hook has block: true', async () => {
    clearRuleCache();
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    writeFileSync(
      path.join(globalRulesDir, 'blocker.mdc'),
      `---\nhooks:\n  - type: PreToolUse\n    tool: bash\n    match: "0\\\\.0\\\\.0\\\\.0"\n    block: true\n---\n\nBlocked.`
    );

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const before = hooks['tool.execute.before'] as (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => Promise<void>;

    await expect(
      before(
        { tool: 'bash', sessionID: 'ses_block', callID: 'call_1' },
        { args: { command: 'node server.js --host 0.0.0.0' } }
      )
    ).rejects.toThrow('[opencode-rules] Blocked by rule');
  });

  it('executes run side-effect when PostToolUse hook fires', async () => {
    clearRuleCache();
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    const markerFile = path.join(testDir, 'side-effect-marker.txt');

    writeFileSync(
      path.join(globalRulesDir, 'side-effect.mdc'),
      `---\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "grep"\n    run: "echo fired > ${markerFile}"\n---\n\nSide effect rule.`
    );

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;

    await after(
      {
        tool: 'bash',
        sessionID: 'ses_run',
        callID: 'call_1',
        args: { command: 'grep foo' },
      },
      { title: '', output: '', metadata: {} }
    );

    await new Promise(resolve => setTimeout(resolve, 100));

    const { readFileSync } = await import('fs');
    const marker = readFileSync(markerFile, 'utf-8').trim();
    expect(marker).toBe('fired');
  });
});

describe('SessionState', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  afterEach(async () => {
    teardownTestDirs();
    const { __testOnly } = await import('./index.js');
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

  it('prunes session state when over limit', async () => {
    const { __testOnly } = await import('./index.js');

    __testOnly.setSessionStateLimit(2);
    __testOnly.upsertSessionState('ses_1', () => {});
    __testOnly.upsertSessionState('ses_2', () => {});
    __testOnly.upsertSessionState('ses_3', () => {});

    const ids = __testOnly.getSessionStateIDs();
    expect(ids).toHaveLength(2);
    expect(ids).toContain('ses_2');
    expect(ids).toContain('ses_3');
  });

  it('updates lastUserPrompt from chat.message', async () => {
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const hook = hooks['chat.message'] as (
      input: { sessionID: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;
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

  it('extracts text from mixed parts using shared extraction logic', async () => {
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const hook = hooks['chat.message'] as (
      input: { sessionID: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;

    await hook(
      { sessionID: 'ses_mixed' },
      {
        message: { role: 'user' },
        parts: [
          { type: 'text', text: 'typed' },
          { text: 'untyped' },
          { type: 'image', data: 'binary' },
          { type: 'text', text: 'skip', synthetic: true },
          { type: 'text', text: 'final' },
        ],
      }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_mixed');
    expect(snapshot?.lastUserPrompt).toBe('typed untyped final');
  });

  it('stores lastModelID from chat.message for user messages', async () => {
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const hook = hooks['chat.message'] as (
      input: { sessionID: string; model?: { modelID: string } },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;

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
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const hook = hooks['chat.message'] as (
      input: { sessionID: string; agent?: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;

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
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const hook = hooks['chat.message'] as (
      input: { sessionID: string; model?: { modelID: string }; agent?: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;

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
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const hook = hooks['chat.message'] as (
      input: { sessionID: string; model?: { modelID: string }; agent?: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;

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
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const hook = hooks['chat.message'] as (
      input: { sessionID: string; model?: { modelID: string }; agent?: string },
      output: { message: { role: string }; parts: unknown[] }
    ) => Promise<void>;

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

  it('includes glob-conditional rule when the after-hook records a matching file', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    writeFileSync(
      path.join(globalRulesDir, 'typescript.mdc'),
      `---\nglobs:\n  - "src/components/**/*.tsx"\n---\n\nUse React best practices.`
    );

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;
    expect(after).toBeDefined();

    await after(
      {
        tool: 'read',
        sessionID: 'ses_1',
        callID: 'call_1',
        args: { filePath: 'src/components/Button.tsx' },
      },
      { title: '', output: 'export const Button;', metadata: {} }
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'check this' }],
    };
    await chatMessage({ sessionID: 'ses_1', messageID: 'msg_ses1_1' }, output);

    expect(output.parts.filter(p => p.synthetic)[0]?.text).toContain(
      'React best practices'
    );
  });

  it('supported file tools produce observations; excluded tools do not', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    writeFileSync(
      path.join(globalRulesDir, 'legacy.mdc'),
      `---\nglobs:\n  - "src/legacy/**"\n---\n\nLegacy module guidance.`
    );

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const before = hooks['tool.execute.before'] as (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => Promise<void>;
    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;

    await before(
      { tool: 'glob', sessionID: 'ses_glob_live', callID: 'call_glob_1' },
      { args: { pattern: 'src/legacy/**/*.ts' } }
    );
    const snapshot = __testOnly.getSessionStateSnapshot('ses_glob_live');
    expect(snapshot?.workingContextPaths.size ?? 0).toBe(0);

    const afterOutput: { title: string; output: string; metadata: unknown } = {
      title: 'legacy.ts',
      output: 'const legacy = true;',
      metadata: {},
    };
    await after(
      {
        tool: 'write',
        sessionID: 'ses_glob_live',
        callID: 'call_glob_1',
        args: {
          filePath: 'src/legacy/module.ts',
          content: 'const legacy = true;',
        },
      },
      afterOutput
    );

    const snapshotAfter = __testOnly.getSessionStateSnapshot('ses_glob_live');
    expect(snapshotAfter?.workingContextPaths.has('src/legacy/module.ts')).toBe(
      true
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'check this' }],
    };
    await chatMessage(
      { sessionID: 'ses_glob_live', messageID: 'msg_ses_glob_live_1' },
      output
    );

    expect(output.parts.filter(p => p.synthetic)[0]?.text).toContain(
      'Legacy module guidance'
    );
  });
});

describe('history scan and rescan', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;
  let stateDir: string;
  let matchedRulesStateStore: MatchedRulesStateStore;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    const { testDir } = getTestDirs();
    stateDir = path.join(testDir, 'state');
    mkdirSync(stateDir, { recursive: true });
    matchedRulesStateStore = new MatchedRulesStateStore({ stateDir });
  });

  afterEach(async () => {
    teardownTestDirs();
    const { __testOnly } = await import('./index.js');
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

  it('does not let a history rescan overwrite the last complete matched state', async () => {
    const { testDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    await matchedRulesStateStore.write('ses_state_reconcile', [
      '/rules/current.mdc',
    ]);

    const hooks = await createHooksWithStore(
      createMockPluginInput({ testDir }),
      matchedRulesStateStore
    );
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;
    await transform(
      {},
      {
        messages: [
          {
            info: {
              id: 'msg_history',
              role: 'user',
              sessionID: 'ses_state_reconcile',
            },
            parts: [
              { type: 'text', text: 'resume' },
              buildDurableDeliveryPart(
                [
                  {
                    relativePath: 'persisted.md',
                    content: 'Persisted rule body.',
                  },
                ],
                [],
                {
                  sessionID: 'ses_state_reconcile',
                  messageID: 'msg_history',
                }
              ),
            ],
          },
        ],
      }
    );

    const current = await readMatchedRulesState('ses_state_reconcile', {
      stateDir,
    });
    expect(current?.matchedRulePaths).toEqual(['/rules/current.mdc']);
  });

  it('recomputes ephemeral rules after compaction without persisting them', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always Apply\nCompaction survivor.'
    );
    writeFileSync(
      path.join(globalRulesDir, 'plan-only.mdc'),
      `---\nagent: [plan]\n---\n\nPlan guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await createHooksWithStore(
      createMockPluginInput({ testDir }),
      matchedRulesStateStore
    );
    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const compacting = hooks['experimental.session.compacting'] as (
      input: { sessionID: string },
      output: { context: string[] }
    ) => Promise<void>;
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;

    const output: HookChatOutput = {
      message: { role: 'user', agent: 'plan' },
      parts: [{ type: 'text', text: 'plan the testing work' }],
    };
    await chatMessage(
      { sessionID: 'ses_comp_eph', messageID: 'msg_ce_1' },
      output
    );
    expect(output.parts.filter(p => p.synthetic)).toHaveLength(1);

    await compacting({ sessionID: 'ses_comp_eph' }, { context: [] });

    const request = [
      {
        info: { id: 'msg_ce_2', role: 'user', sessionID: 'ses_comp_eph' },
        parts: [{ type: 'text', text: 'plan the testing work' }],
      },
    ];
    await transform({}, { messages: request });
    const transformedText = request
      .flatMap(message => message.parts as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(transformedText).toContain('Plan guidance.');
  });

  it('seeds Working context from history once and shares the read with delivery', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always Apply\nSeeded rule.'
    );

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({
      testDir,
      history: [
        {
          info: {
            role: 'assistant',
            sessionID: 'ses_shared_read',
          },
          parts: [
            {
              type: 'tool',
              tool: 'read',
              state: { input: { filePath: 'src/shared.ts' } },
            },
          ],
        },
      ],
    });
    let historyReads = 0;
    mockInput.client.session.messages = (async () => {
      historyReads++;
      return {
        data: [
          {
            info: { role: 'assistant', sessionID: 'ses_shared_read' },
            parts: [
              {
                type: 'tool',
                tool: 'read',
                state: { input: { filePath: 'src/shared.ts' } },
              },
            ],
          },
        ],
      };
    }) as unknown as typeof mockInput.client.session.messages;
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string; messageID?: string },
      output: HookChatOutput
    ) => Promise<void>;

    const first: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'continue work' }],
    };
    await chatMessage(
      { sessionID: 'ses_shared_read', messageID: 'msg_shared_1' },
      first
    );

    expect(historyReads).toBe(1);
    expect(first.parts.filter(p => p.synthetic)[0]?.text).toContain(
      'Seeded rule.'
    );
  });

  it('message removal does not subtract paths and still re-delivers durable rules', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    writeFileSync(
      path.join(globalRulesDir, 'gated.mdc'),
      `---\nglobs:\n  - "src/kept/**"\n---\n\nKept-directory guidance.`
    );

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;
    const event = hooks.event as (input: {
      event: {
        type: 'message.removed';
        properties: { sessionID: string; messageID: string };
      };
    }) => Promise<void>;
    const chatMessage = hooks['chat.message'] as HookChatMessage;

    await after(
      {
        tool: 'read',
        sessionID: 'ses_removal_paths',
        callID: 'call_before_removal',
        args: { filePath: 'src/kept/a.ts' },
      },
      { title: '', output: 'export;', metadata: {} }
    );
    await event({
      event: {
        type: 'message.removed',
        properties: {
          sessionID: 'ses_removal_paths',
          messageID: 'msg_removed_elsewhere',
        },
      },
    });

    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'check kept files' }],
    };
    await chatMessage(
      { sessionID: 'ses_removal_paths', messageID: 'msg_after_removal' },
      output
    );
    expect(output.parts.filter(p => p.synthetic)[0]?.text).toContain(
      'Kept-directory guidance.'
    );
  });

  it('compaction preserves Working context for later matching without re-delivering durable rules', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    writeFileSync(
      path.join(globalRulesDir, 'postcompact.mdc'),
      `---\nglobs:\n  - "src/keep/**"\n---\n\nPost-compaction guidance.`
    );

    const hooks = await createHooksWithStore(
      createMockPluginInput({ testDir }),
      matchedRulesStateStore
    );
    const compacting = hooks['experimental.session.compacting'] as (
      input: { sessionID: string },
      output: { context?: string[] }
    ) => Promise<void>;
    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;
    const chatMessage = hooks['chat.message'] as HookChatMessage;

    await after(
      {
        tool: 'read',
        sessionID: 'ses_compact_paths',
        callID: 'call_compact',
        args: { filePath: 'src/keep/zed.ts' },
      },
      { title: '', output: 'export;', metadata: {} }
    );

    const output: { context?: string[] } = { context: [] };
    await compacting({ sessionID: 'ses_compact_paths' }, output);
    expect(output.context?.join('\n')).toContain('src/keep/zed.ts');

    // The post-compaction dispatch refreshes the delivery ledger, then the
    // durable turn delivers the rule matched by the retained path.
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;
    const outputMessage: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'continue' }],
    };
    await transform(
      {},
      {
        messages: [
          {
            info: {
              id: 'msg_after_compact',
              role: 'user',
              sessionID: 'ses_compact_paths',
            },
            parts: outputMessage.parts,
          },
        ],
      }
    );
    await chatMessage(
      { sessionID: 'ses_compact_paths', messageID: 'msg_after_compact' },
      outputMessage
    );
    expect(
      outputMessage.parts.some(
        part =>
          part.synthetic && part.text?.includes('Post-compaction guidance.')
      )
    ).toBe(true);
  });
});

describe('Matched rules state persistence', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;
  let stateDir: string;
  let matchedRulesStateStore: MatchedRulesStateStore;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    const { testDir } = getTestDirs();
    stateDir = path.join(testDir, 'state');
    mkdirSync(stateDir, { recursive: true });
    matchedRulesStateStore = new MatchedRulesStateStore({ stateDir });
  });

  afterEach(async () => {
    teardownTestDirs();
    const { __testOnly } = await import('./index.js');
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

  it('writes matched rule paths to state file when rules match', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'always-apply.md');
    writeFileSync(rulePath, '# Always Apply\nThis rule always applies.');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await createHooksWithStore(
      createMockPluginInput({ testDir }),
      matchedRulesStateStore
    );

    const sessionID = 'ses-state-match';
    const chatMessage = hooks['chat.message'] as (
      input: { sessionID?: string; messageID?: string },
      output: HookChatOutput
    ) => Promise<void>;

    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID, messageID: 'msg_state_match_1' }, output);

    expect(output.parts.filter(p => p.synthetic)[0]?.text).toContain(
      'Always Apply'
    );

    // Wait for fire-and-forget write to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const state = await readMatchedRulesState(sessionID, { stateDir });
    expect(state).not.toBeNull();
    expect(state?.sessionID).toBe(sessionID);
    expect(state?.matchedRulePaths).toHaveLength(1);
    expect(state?.matchedRulePaths[0]).toBe(rulePath);
  });

  it('writes empty matchedPaths to state file when no rules match', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'conditional.mdc');
    writeFileSync(
      rulePath,
      `---
model:
  - gpt-5
---

Conditional rule for gpt-5 only.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await createHooksWithStore(
      createMockPluginInput({ testDir }),
      matchedRulesStateStore
    );

    const sessionID = 'ses-state-nomatch';
    const chatMessage = hooks['chat.message'] as (
      input: { sessionID?: string; messageID?: string },
      output: HookChatOutput
    ) => Promise<void>;

    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID, messageID: 'msg_state_nomatch_1' }, output);

    expect(output.parts.filter(p => p.synthetic)).toHaveLength(0);

    // Wait for fire-and-forget write to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const state = await readMatchedRulesState(sessionID, { stateDir });
    expect(state).not.toBeNull();
    expect(state?.sessionID).toBe(sessionID);
    expect(state?.matchedRulePaths).toHaveLength(0);
  });

  it('does not write state when sessionID is missing', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Test Rule\nContent');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await createHooksWithStore(
      createMockPluginInput({ testDir }),
      matchedRulesStateStore
    );

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID?: string },
      output: HookChatOutput
    ) => Promise<void>;

    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({}, output);

    await new Promise(resolve => setTimeout(resolve, 50));

    const files = readdirSync(stateDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    expect(jsonFiles).toHaveLength(0);
  });
});

describe('rule-discovery runtime exports', () => {
  it('exports only expected functions at runtime', () => {
    const exportedKeys = Object.keys(ruleDiscoveryModule).sort();
    expect(exportedKeys).toEqual([
      'clearRuleCache',
      'discoverRuleFiles',
      'getCachedRule',
      'loadRuleSnapshots',
    ]);
  });
});

describe('session-store runtime exports', () => {
  it('exports only SessionStore at runtime', () => {
    const exportedKeys = Object.keys(sessionStoreModule).sort();
    expect(exportedKeys).toEqual(['SessionStore']);
  });
});

describe('matched-rules-state runtime exports', () => {
  it('exports only the store and reader at runtime', () => {
    const exportedKeys = Object.keys(matchedRulesStateModule).sort();
    expect(exportedKeys).toEqual([
      'MatchedRulesStateStore',
      'readMatchedRulesState',
    ]);
  });
});

describe('CI environment detection', () => {
  let savedCiEnv: CiEnvSnapshot;
  let savedXDG: string | undefined;
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedCiEnv = saveCiEnvVars();
    savedXDG = process.env.XDG_CONFIG_HOME;
    savedConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  afterEach(async () => {
    teardownTestDirs();
    restoreCiEnvVars(savedCiEnv);
    const { __testOnly } = await import('./index.js');
    __testOnly.resetSessionState();
    if (savedXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXDG;
    }
    if (savedConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = savedConfigDir;
    }
  });

  it('should include ci-conditional rule when CI env var is set', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'ci-rule.mdc'),
      `---\nci: true\n---\n\nCI-specific guidelines.`
    );

    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    clearCiEnvVars();
    process.env.CI = 'true';

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID: 'ses_ci_1', messageID: 'msg_ci_1' }, output);

    const synthetic = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(synthetic).toContain('CI-specific guidelines');
  });

  it('should NOT include ci:true rule when CI env var is "false"', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'ci-only-rule.mdc'),
      `---\nci: true\n---\n\nCI-only guidelines.`
    );

    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    clearCiEnvVars();
    process.env.CI = 'false';

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID: 'ses_ci_2', messageID: 'msg_ci_2' }, output);

    const synthetic = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(synthetic).not.toContain('CI-only guidelines');
  });

  it('should NOT include ci:true rule when CI env var is "0"', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'ci-zero-rule.mdc'),
      `---\nci: true\n---\n\nCI-zero guidelines.`
    );

    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    clearCiEnvVars();
    process.env.CI = '0';

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID: 'ses_ci_3', messageID: 'msg_ci_3' }, output);

    const synthetic = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(synthetic).not.toContain('CI-zero guidelines');
  });

  it('should detect CI from provider vars when CI env var is not set', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'ci-fallback-rule.mdc'),
      `---\nci: true\n---\n\nCI-fallback guidelines.`
    );

    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    clearCiEnvVars();
    process.env.GITHUB_ACTIONS = 'true';

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID: 'ses_ci_4', messageID: 'msg_ci_4' }, output);

    const synthetic = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(synthetic).toContain('CI-fallback guidelines');
  });

  it('should NOT detect CI when BUILD_NUMBER is "false"', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'ci-build-number-rule.mdc'),
      `---\nci: true\n---\n\nCI-build-number guidelines.`
    );

    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    clearCiEnvVars();
    process.env.BUILD_NUMBER = 'false';

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID: 'ses_ci_5', messageID: 'msg_ci_5' }, output);

    const synthetic = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text)
      .join('\n');
    expect(synthetic).not.toContain('CI-build-number guidelines');
  });
});
