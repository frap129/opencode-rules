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
  saveCiEnvVars,
  clearCiEnvVars,
  restoreCiEnvVars,
  type CiEnvSnapshot,
} from './test-fixtures.js';

// Import modules for boundary tests
import * as ruleDiscoveryModule from './rule-discovery.js';
import * as ruleMetadataModule from './rule-metadata.js';
import * as ruleFilterModule from './rule-filter.js';
import * as messagePathsModule from './message-paths.js';
import * as utilsModule from './utils.js';
import * as sessionStoreModule from './session-store.js';
import * as matchedRulesStateModule from './matched-rules-state.js';
import * as runtimeContextModule from './runtime-context.js';
import * as runtimeChatModule from './runtime-chat.js';
import * as ruleHooksModule from './rule-hooks.js';
import { __testOnly } from './index.js';
import {
  MatchedRulesStateStore,
  readMatchedRulesState,
} from './matched-rules-state.js';
import { clearRuleCache } from './utils.js';
import { buildDurableDeliveryPart } from './rule-delivery-codec.js';

function createHooksWithMatchedRulesStateStore(
  testDir: string,
  store: MatchedRulesStateStore
) {
  const mockInput = createMockPluginInput({ testDir });
  return __testOnly.createHooksWithMatchedRulesStateStore(
    mockInput as unknown as Parameters<
      typeof __testOnly.createHooksWithMatchedRulesStateStore
    >[0],
    store
  );
}

describe('module boundary tests', () => {
  it('should re-export discoverRuleFiles from rule-discovery module', () => {
    expect(ruleDiscoveryModule.discoverRuleFiles).toBeDefined();
    expect(typeof ruleDiscoveryModule.discoverRuleFiles).toBe('function');
    expect(utilsModule.discoverRuleFiles).toBe(
      ruleDiscoveryModule.discoverRuleFiles
    );
  });

  it('should re-export parseRuleMetadata from rule-metadata module', () => {
    expect(ruleMetadataModule.parseRuleMetadata).toBeDefined();
    expect(typeof ruleMetadataModule.parseRuleMetadata).toBe('function');
    expect(utilsModule.parseRuleMetadata).toBe(
      ruleMetadataModule.parseRuleMetadata
    );
  });

  it('should re-export promptMatchesKeywords and toolsMatchAvailable from rule-filter module', () => {
    expect(ruleFilterModule.promptMatchesKeywords).toBeDefined();
    expect(ruleFilterModule.toolsMatchAvailable).toBeDefined();
    expect(typeof ruleFilterModule.promptMatchesKeywords).toBe('function');
    expect(typeof ruleFilterModule.toolsMatchAvailable).toBe('function');
    expect(utilsModule.promptMatchesKeywords).toBe(
      ruleFilterModule.promptMatchesKeywords
    );
    expect(utilsModule.toolsMatchAvailable).toBe(
      ruleFilterModule.toolsMatchAvailable
    );
  });

  it('should re-export extractFilePathsFromMessages from message-paths module', () => {
    expect(messagePathsModule.extractFilePathsFromMessages).toBeDefined();
    expect(typeof messagePathsModule.extractFilePathsFromMessages).toBe(
      'function'
    );
    expect(utilsModule.extractFilePathsFromMessages).toBe(
      messagePathsModule.extractFilePathsFromMessages
    );
  });

  it('should re-export clearRuleCache from rule-discovery module', () => {
    expect(ruleDiscoveryModule.clearRuleCache).toBeDefined();
    expect(typeof ruleDiscoveryModule.clearRuleCache).toBe('function');
    expect(utilsModule.clearRuleCache).toBe(ruleDiscoveryModule.clearRuleCache);
  });

  it('should re-export DiscoveredRule type via utils facade', () => {
    const rule: utilsModule.DiscoveredRule = {
      filePath: '/test/rule.md',
      relativePath: 'rule.md',
    };
    const ruleFromDiscovery: ruleDiscoveryModule.DiscoveredRule = rule;
    expect(ruleFromDiscovery.filePath).toBe('/test/rule.md');
  });

  it('should re-export RuleMatchContext type via utils facade', () => {
    const context: utilsModule.RuleMatchContext = {
      userPrompt: 'test',
      contextFilePaths: ['src/test.ts'],
    };
    expect(context.userPrompt).toBe('test');
  });

  it('should re-export Message and MessagePart types via utils facade', () => {
    const msg: utilsModule.Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    };
    expect(msg.role).toBe('user');
  });

  // Runtime decomposition module boundary tests
  it('should export buildRuleMatchContext from runtime-context module', () => {
    expect(runtimeContextModule.buildRuleMatchContext).toBeDefined();
    expect(typeof runtimeContextModule.buildRuleMatchContext).toBe('function');
  });

  it('should export detectCiEnvironment from runtime-context module', () => {
    expect(runtimeContextModule.detectCiEnvironment).toBeDefined();
    expect(typeof runtimeContextModule.detectCiEnvironment).toBe('function');
  });

  it('should export updateSessionFromChatMessage from runtime-chat module', () => {
    expect(runtimeChatModule.updateSessionFromChatMessage).toBeDefined();
    expect(typeof runtimeChatModule.updateSessionFromChatMessage).toBe(
      'function'
    );
  });

  it('should detect CI environment correctly via runtime-context module', () => {
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

  it('should re-export evaluateHooks and serializeToolArgs from rule-hooks module', () => {
    expect(ruleHooksModule.evaluateHooks).toBeDefined();
    expect(ruleHooksModule.serializeToolArgs).toBeDefined();
    expect(typeof ruleHooksModule.evaluateHooks).toBe('function');
    expect(typeof ruleHooksModule.serializeToolArgs).toBe('function');
    expect(utilsModule.evaluateHooks).toBe(ruleHooksModule.evaluateHooks);
    expect(utilsModule.serializeToolArgs).toBe(
      ruleHooksModule.serializeToolArgs
    );
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

    // No pending hook injections: nothing appended, nothing mutated.
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
    expect(snapshot?.workingContextPaths).toContain('src/current.ts');
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

    // Allow async side-effect to complete
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
    __testOnly.upsertSessionState('ses_1', s => void (s.lastUpdated = 1));
    __testOnly.upsertSessionState('ses_2', s => void (s.lastUpdated = 2));
    __testOnly.upsertSessionState('ses_3', s => void (s.lastUpdated = 3));

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

  it('includes glob-conditional rule when tool hook records matching file path', async () => {
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

    const before = hooks['tool.execute.before'] as (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => Promise<void>;
    expect(before).toBeDefined();

    await before(
      { tool: 'read', sessionID: 'ses_1', callID: 'call_1' },
      { args: { filePath: 'src/components/Button.tsx' } }
    );

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'check this' }],
    };
    await chatMessage({ sessionID: 'ses_1', messageID: 'msg_ses1_1' }, output);

    expect(output.parts.filter(p => p.synthetic)[0]?.text).toContain(
      'React best practices'
    );
  });

  it('records glob pattern-derived directory during live tool execution', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    writeFileSync(
      path.join(globalRulesDir, 'legacy.mdc'),
      `---\nglobs:\n  - "src/legacy"\n---\n\nLegacy module guidance.`
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

    await before(
      { tool: 'glob', sessionID: 'ses_glob_live', callID: 'call_glob_1' },
      { args: { pattern: 'src/legacy/**/*.ts' } }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_glob_live');
    expect(snapshot?.workingContextPaths).toContain('src/legacy');

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
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

    const hooks = await createHooksWithMatchedRulesStateStore(
      testDir,
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

    const hooks = await createHooksWithMatchedRulesStateStore(
      testDir,
      matchedRulesStateStore
    );
    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const compacting = hooks['experimental.session.compacting'] as (
      input: { sessionID: string },
      output: { context: string[] }
    ) => Promise<void>;
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;

    const output: ChatMessageOutputLike = {
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
      output: ChatMessageOutputLike
    ) => Promise<void>;

    const first: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'continue work' }],
    };
    await chatMessage(
      { sessionID: 'ses_shared_read', messageID: 'msg_shared_1' },
      first
    );

    // One history read seeded Working context and fed delivery's ledger.
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

    const before = hooks['tool.execute.before'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
      },
      output: { args: Record<string, unknown> }
    ) => Promise<void>;
    const event = hooks.event as (input: {
      event: {
        type: 'message.removed';
        properties: { sessionID: string; messageID: string };
      };
    }) => Promise<void>;
    const chatMessage = hooks['chat.message'] as ChatMessageHook;

    await before(
      {
        tool: 'read',
        sessionID: 'ses_removal_paths',
        callID: 'call_before_removal',
      },
      { args: { filePath: 'src/kept/a.ts' } }
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

    // Path observed before removal still drives matching after it.
    const output: ChatMessageOutputLike = {
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

    const hooks = await createHooksWithMatchedRulesStateStore(
      testDir,
      matchedRulesStateStore
    );
    const compacting = hooks['experimental.session.compacting'] as (
      input: { sessionID: string },
      output: { context?: string[] }
    ) => Promise<void>;
    const before = hooks['tool.execute.before'] as (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => Promise<void>;
    const chatMessage = hooks['chat.message'] as ChatMessageHook;

    await before(
      {
        tool: 'read',
        sessionID: 'ses_compact_paths',
        callID: 'call_compact',
      },
      { args: { filePath: 'src/keep/zed.ts' } }
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
    const after: ChatMessageOutputLike = {
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
            parts: after.parts,
          },
        ],
      }
    );
    await chatMessage(
      { sessionID: 'ses_compact_paths', messageID: 'msg_after_compact' },
      after
    );
    expect(
      after.parts.some(
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

    const hooks = await createHooksWithMatchedRulesStateStore(
      testDir,
      matchedRulesStateStore
    );

    const sessionID = 'ses-state-match';
    const chatMessage = hooks['chat.message'] as (
      input: { sessionID?: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;

    const output: ChatMessageOutputLike = {
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

    const hooks = await createHooksWithMatchedRulesStateStore(
      testDir,
      matchedRulesStateStore
    );

    const sessionID = 'ses-state-nomatch';
    const chatMessage = hooks['chat.message'] as (
      input: { sessionID?: string; messageID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;

    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID, messageID: 'msg_state_nomatch_1' }, output);

    // No rules should match (model is not gpt-5)
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

    const hooks = await createHooksWithMatchedRulesStateStore(
      testDir,
      matchedRulesStateStore
    );

    const chatMessage = hooks['chat.message'] as (
      input: { sessionID?: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;

    // Call without sessionID
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({}, output);

    // Wait briefly
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify no state files were created in the state directory
    const files = readdirSync(stateDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    expect(jsonFiles).toHaveLength(0);
  });
});

describe('utils runtime exports', () => {
  it('exports only expected functions at runtime', () => {
    const exportedKeys = Object.keys(utilsModule).sort();
    expect(exportedKeys).toEqual([
      'clearRuleCache',
      'discoverRuleFiles',
      'evaluateHooks',
      'extractFilePathsFromMessages',
      'getCachedRule',
      'hasConditions',
      'parseRuleMetadata',
      'promptMatchesKeywords',
      'readMatchedRulesState',
      'serializeToolArgs',
      'toolsMatchAvailable',
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

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
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

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
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

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
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

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
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

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
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

type ChatMessageHook = (
  input: { sessionID: string; messageID?: string },
  output: ChatMessageOutputLike
) => Promise<void>;

type ChatMessageOutputLike = {
  message: {
    role: string;
    id?: string;
    agent?: string;
    model?: { modelID?: string };
  };
  parts: Array<{
    id?: string;
    type?: string;
    text?: string;
    synthetic?: boolean;
    sessionID?: string;
    messageID?: string;
  }>;
};

describe('chat.message rule persistence', () => {
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
    vi.resetAllMocks();
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

  async function getHooks(testDir: string) {
    return createHooksWithMatchedRulesStateStore(
      testDir,
      matchedRulesStateStore
    );
  }

  it('appends all matched rules as one named delivery event', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always Apply\nThis rule always applies.'
    );
    writeFileSync(
      path.join(globalRulesDir, 'z-custom.mdc'),
      '---\nname: Custom label\n---\n\nCustom guidance.'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as ChatMessageHook;

    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: 'ses_append', messageID: 'msg_append_1' },
      output
    );

    const synthetic = output.parts.filter(p => p.synthetic);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]?.id?.startsWith('prt_rules_')).toBe(true);
    expect(synthetic[0]?.text).toBe(
      buildDurableDeliveryPart(
        [
          {
            relativePath: 'always.md',
            content: '# Always Apply\nThis rule always applies.',
          },
          {
            relativePath: 'z-custom.mdc',
            name: 'Custom label',
            content: 'Custom guidance.',
          },
        ],
        [],
        { sessionID: 'ses_append', messageID: 'msg_append_1' }
      ).text
    );
    expect(output.parts[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('stamps sessionID and messageID onto appended synthetic parts', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as ChatMessageHook;

    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: 'ses_stamp', messageID: 'msg_host_1' },
      output
    );

    const synthetic = output.parts.filter(p => p.synthetic);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]?.sessionID).toBe('ses_stamp');
    expect(synthetic[0]?.messageID).toBe('msg_host_1');
  });

  it('skips injection rather than emitting parts without a messageID', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;

    const output: ChatMessageOutputLike = {
      message: { role: 'user' }, // no id field
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage({ sessionID: 'sans_message_id' }, output);

    expect(output.parts.filter(p => p.synthetic)).toHaveLength(0);
  });

  it('falls back to output.message.id when input omits it', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as (
      input: { sessionID: string },
      output: ChatMessageOutputLike
    ) => Promise<void>;

    const output: ChatMessageOutputLike = {
      message: { role: 'user', id: 'msg_from_output' },
      parts: [{ type: 'text', text: 'hi' }],
    };
    await chatMessage({ sessionID: 'ses_msgfallback' }, output);

    const synthetic = output.parts.filter(p => p.synthetic);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]?.messageID).toBe('msg_from_output');
  });

  it('deduplicates rules already injected on earlier messages', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    // Model real persistence: the client's history returns whatever the
    // plugin has appended so far, so the first message's fetch scans the
    // persisted parts. After that fetch, in-memory injected keys are
    // authoritative for the session, so the second message dedups against
    // them without a second history fetch.
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const persisted: ChatMessageOutputLike['parts'] = [];
    mockInput.client.session.messages = async () => ({
      data: [
        {
          info: { id: 'msg_1', role: 'user', sessionID: 'ses_dedup' },
          parts: [...persisted],
        },
      ],
    });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const chatMessage = hooks['chat.message'] as ChatMessageHook;

    const first: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'first' }],
    };
    await chatMessage(
      { sessionID: 'ses_dedup', messageID: 'msg_dedup_1' },
      first
    );
    expect(first.parts.filter(p => p.synthetic)).toHaveLength(1);
    persisted.push(...first.parts.filter(p => p.synthetic));

    const second: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'second' }],
    };
    await chatMessage(
      { sessionID: 'ses_dedup', messageID: 'msg_dedup_2' },
      second
    );
    expect(second.parts.filter(p => p.synthetic)).toHaveLength(0);
  });

  it('rehydrates current OpenCode tool paths during the first chat message', async () => {
    const { testDir } = getTestDirs();
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({
      testDir,
      history: [
        {
          info: {
            role: 'assistant',
            sessionID: 'ses_current_restart',
          },
          parts: [
            {
              type: 'tool',
              tool: 'edit',
              state: {
                status: 'completed',
                input: { filePath: 'src/restarted.ts' },
              },
            },
          ],
        },
      ],
    });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    await chatMessage(
      {
        sessionID: 'ses_current_restart',
        messageID: 'msg_current_restart',
      },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'continue' }],
      }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_current_restart');
    expect(snapshot?.workingContextSeeded).toBe(true);
    expect(snapshot?.workingContextPaths).toContain('src/restarted.ts');
  });

  it('rehydrates bash workdirs from history and delivers directory-gated rules', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    writeFileSync(
      path.join(globalRulesDir, 'tools-dir.md'),
      `---\nglobs:\n  - "src/tools"\n---\n\nTools directory guidance.`
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
            sessionID: 'ses_bash_restart',
          },
          parts: [
            {
              type: 'tool',
              tool: 'bash',
              state: {
                status: 'completed',
                input: { command: 'ls', workdir: 'src/tools' },
              },
            },
          ],
        },
      ],
    });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'continue' }],
    };
    await chatMessage(
      { sessionID: 'ses_bash_restart', messageID: 'msg_bash_restart' },
      output
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_bash_restart');
    expect(snapshot?.workingContextPaths).toContain('src/tools');
    expect(output.parts.filter(p => p.synthetic)[0]?.text).toContain(
      'Tools directory guidance'
    );
  });

  it('keeps the original rule content after an in-process file edit', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'changing.md');
    writeFileSync(rulePath, 'Version one.');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const first: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'first' }],
    };
    await chatMessage(
      { sessionID: 'ses_change', messageID: 'msg_change_1' },
      first
    );
    expect(first.parts.some(part => part.text?.includes('Version one.'))).toBe(
      true
    );

    writeFileSync(rulePath, 'Version two.');
    const second: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'second' }],
    };
    await chatMessage(
      { sessionID: 'ses_change', messageID: 'msg_change_2' },
      second
    );

    expect(second.parts.some(part => part.text?.includes('Version two.'))).toBe(
      false
    );
    expect(second.parts.filter(part => part.synthetic)).toHaveLength(0);
  });

  it('keeps agent rules transient while persisting task rules', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'agent-plan.mdc'),
      `---\nagent: [plan]\n---\n\nPlan-only guidance.`
    );
    writeFileSync(
      path.join(globalRulesDir, 'agent-build.mdc'),
      `---\nagent: [build]\n---\n\nBuild-only guidance.`
    );
    writeFileSync(
      path.join(globalRulesDir, 'testing.mdc'),
      `---\nkeywords: [testing]\n---\n\nTesting guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;

    const planOutput: ChatMessageOutputLike = {
      message: { role: 'user', agent: 'plan' },
      parts: [{ type: 'text', text: 'please plan the testing work' }],
    };
    await chatMessage(
      { sessionID: 'ses_route', messageID: 'msg_plan' },
      planOutput
    );

    expect(planOutput.parts.filter(part => part.synthetic)).toHaveLength(1);
    expect(
      planOutput.parts.some(part => part.text?.includes('Plan-only'))
    ).toBe(false);
    expect(
      planOutput.parts.some(part => part.text?.includes('Testing guidance'))
    ).toBe(true);

    const planRequest = [
      {
        info: { id: 'msg_plan', role: 'user', sessionID: 'ses_route' },
        parts: planOutput.parts,
      },
    ];
    await transform({}, { messages: planRequest });
    expect(
      planRequest.some(message =>
        (message.parts as Array<{ text?: string }>).some(part =>
          part.text?.includes('Plan-only guidance.')
        )
      )
    ).toBe(true);

    const buildOutput: ChatMessageOutputLike = {
      message: { role: 'user', agent: 'build' },
      parts: [{ type: 'text', text: 'implement it' }],
    };
    await chatMessage(
      { sessionID: 'ses_route', messageID: 'msg_build' },
      buildOutput
    );
    expect(buildOutput.parts.filter(part => part.synthetic)).toHaveLength(0);

    const buildRequest = [
      {
        info: { id: 'msg_build', role: 'user', sessionID: 'ses_route' },
        parts: buildOutput.parts,
      },
    ];
    await transform({}, { messages: buildRequest });
    const transformedText = buildRequest
      .flatMap(message => message.parts as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(transformedText).toContain('Build-only guidance.');
    expect(transformedText).not.toContain('Plan-only guidance.');
  });

  it('persists keyword rules once across turns', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'testing.mdc'),
      `---\nkeywords: [testing]\n---\n\nTesting guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const persisted: ChatMessageOutputLike['parts'] = [];
    mockInput.client.session.messages = async () => ({
      data: [
        {
          info: { id: 'msg_1', role: 'user', sessionID: 'ses_kw' },
          parts: [...persisted],
        },
      ],
    });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const chatMessage = hooks['chat.message'] as ChatMessageHook;

    const first: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'add testing here' }],
    };
    await chatMessage({ sessionID: 'ses_kw', messageID: 'msg_kw_1' }, first);
    expect(first.parts.filter(p => p.synthetic)).toHaveLength(1);
    persisted.push(...first.parts.filter(p => p.synthetic));

    const second: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'still testing' }],
    };
    await chatMessage({ sessionID: 'ses_kw', messageID: 'msg_kw_2' }, second);
    expect(second.parts.filter(p => p.synthetic)).toHaveLength(0);
  });

  it('skips rule matching but still flushes hooks for text-less messages', async () => {
    clearRuleCache();
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always Apply\nRule body.'
    );
    writeFileSync(
      path.join(globalRulesDir, 'hooky.mdc'),
      `---\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "grep"\n---\n\nHook rule body.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

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
        sessionID: 'ses_textless',
        callID: 'call_1',
        args: { command: 'grep foo' },
      },
      { title: '', output: '', metadata: {} }
    );

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'synthetic only', synthetic: true }],
    };
    await chatMessage(
      { sessionID: 'ses_textless', messageID: 'msg_textless_1' },
      output
    );

    const syntheticIds = output.parts
      .filter(p => p.synthetic)
      .map(p => p.id ?? '');
    expect(syntheticIds.filter(id => id.startsWith('prt_rules_'))).toHaveLength(
      1
    );
    expect(
      output.parts.find(part => part.id?.startsWith('prt_rules_'))?.text
    ).toContain('Hook rule body.');
  });

  it('still delivers queued transient Hook content when rule evaluation fails', async () => {
    clearRuleCache();
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'hooky.mdc'),
      `---\nagent: [plan]\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "grep"\n---\n\nHook rule body.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    let failToolIds = false;
    mockInput.client.tool.ids = () => {
      if (failToolIds) throw new Error('tool ids unavailable');
      return Promise.resolve({ data: [] });
    };
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
        sessionID: 'ses_eval_fail',
        callID: 'call_1',
        args: { command: 'grep foo' },
      },
      { title: '', output: '', metadata: {} }
    );

    // Only now does rule evaluation fail: the transform-time context query
    // throws, but queued transient Hook content must still be delivered.
    failToolIds = true;
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;
    const messages = [
      {
        info: { id: 'msg_eval_fail', role: 'user', sessionID: 'ses_eval_fail' },
        parts: [{ type: 'text', text: 'prompt' }],
      },
    ];
    await transform({}, { messages });

    expect(messages).toHaveLength(2);
    const part = (
      messages[1]!.parts as Array<{ id?: string; text?: string }>
    )[0];
    expect(part?.id).toMatch(/^prt_rule_ephemeral_/);
    expect(part?.text).toContain('Hook rule body.');
  });

  it('writes matched-rules-state with matched rule paths', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'always-apply.md');
    writeFileSync(rulePath, '# Always Apply\nThis rule always applies.');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    await chatMessage(
      { sessionID: 'ses-state-match', messageID: 'msg_state_match_1' },
      {
        message: { role: 'user' },
        parts: [{ type: 'text', text: 'hello' }],
      }
    );

    await new Promise(resolve => setTimeout(resolve, 50));
    const state = await readMatchedRulesState('ses-state-match', { stateDir });
    expect(state?.sessionID).toBe('ses-state-match');
    expect(state?.matchedRulePaths).toEqual([rulePath]);
  });

  it('deduplicates against history fetched from the client on first message', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'persisted.md'),
      'Persisted rule body.'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({
      testDir,
      history: [
        {
          info: { id: 'msg_1', role: 'user', sessionID: 'ses_restart' },
          parts: [
            buildDurableDeliveryPart(
              [
                {
                  relativePath: 'persisted.md',
                  content: 'Persisted rule body.',
                },
              ],
              [],
              { sessionID: 'ses_restart', messageID: 'msg_1' }
            ),
          ],
        },
      ],
    });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'post-restart message' }],
    };
    await chatMessage(
      { sessionID: 'ses_restart', messageID: 'msg_restart_1' },
      output
    );

    expect(output.parts.filter(p => p.synthetic)).toHaveLength(0);
  });

  it('does not project matched rules when the durable delivery is rejected', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    mockInput.client.session.messages = async () => {
      throw new Error('server down');
    };
    const hooks = await __testOnly.createHooksWithMatchedRulesStateStore(
      mockInput as unknown as Parameters<
        typeof __testOnly.createHooksWithMatchedRulesStateStore
      >[0],
      matchedRulesStateStore
    );

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: 'ses_fetchfail', messageID: 'msg_fetchfail_1' },
      output
    );

    expect(output.parts.filter(p => p.synthetic)).toHaveLength(0);
    expect(
      await readMatchedRulesState('ses_fetchfail', { stateDir })
    ).toBeNull();
  });

  it('invokes session.messages with its receiver so sdk methods stay bound', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    // Simulate the real SDK: a prototype-style method that reads instance
    // state via `this` (arrow functions would mask the detachment bug).
    const sessionApi = {
      _client: { ready: true },
      async messages(this: { _client?: { ready: boolean } }, _args?: unknown) {
        if (!this || !this._client) {
          throw new TypeError(
            "undefined is not an object (evaluating 'this._client')"
          );
        }
        return { data: [] };
      },
    };
    mockInput.client.session =
      sessionApi as unknown as typeof mockInput.client.session;

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const chatMessage = hooks['chat.message'] as ChatMessageHook;

    const output: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'hello' }],
    };
    await chatMessage(
      { sessionID: 'ses_receiver', messageID: 'msg_receiver_1' },
      output
    );

    expect(output.parts.filter(p => p.synthetic)).toHaveLength(1);
  });

  it('does not persist hook text owned by an ephemeral rule', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'plan-hook.mdc'),
      `---\nagent: [plan]\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "eslint"\n---\n\nPlan hook guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;

    await chatMessage(
      { sessionID: 'ses_hook_eph', messageID: 'msg_hook_user' },
      {
        message: { role: 'user', agent: 'plan' },
        parts: [{ type: 'text', text: 'work on linting' }],
      }
    );
    await after(
      {
        tool: 'bash',
        sessionID: 'ses_hook_eph',
        callID: 'call_1',
        args: { command: 'npx eslint src/' },
      },
      { title: '', output: '', metadata: {} }
    );

    const dispatch = [
      {
        info: {
          id: 'msg_after_tool',
          role: 'assistant',
          sessionID: 'ses_hook_eph',
        },
        parts: [{ type: 'text', text: 'tool completed' }],
      },
    ];
    await transform({}, { messages: dispatch });
    expect(
      dispatch
        .flatMap(message => message.parts as Array<{ text?: string }>)
        .some(part => part.text?.includes('Plan hook guidance.'))
    ).toBe(true);

    const nextUserMessage = {
      message: { role: 'user', agent: 'plan' },
      parts: [{ type: 'text', text: 'continue' }],
    };
    await chatMessage(
      { sessionID: 'ses_hook_eph', messageID: 'msg_hook_next' },
      nextUserMessage
    );
    expect(
      nextUserMessage.parts.some(part => part.text === 'Plan hook guidance.')
    ).toBe(false);
  });

  it('keeps a mixed any hook durable when a durable condition matches', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'mixed-hook.mdc'),
      `---\nglobs:\n  - "src/**/*.ts"\nagent: [plan]\nmatch: any\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "eslint"\n---\n\nMixed hook guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;

    __testOnly.upsertSessionState('ses_hook_mixed', s => {
      s.workingContextPaths.add('src/index.ts');
      s.lastAgentType = 'plan';
    });

    await after(
      {
        tool: 'bash',
        sessionID: 'ses_hook_mixed',
        callID: 'call_1',
        args: { command: 'npx eslint src/' },
      },
      { title: '', output: '', metadata: {} }
    );

    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const output: ChatMessageOutputLike = {
      message: { role: 'user', agent: 'plan' },
      parts: [{ type: 'text', text: 'continue' }],
    };
    await chatMessage(
      { sessionID: 'ses_hook_mixed', messageID: 'msg_hook_mixed_1' },
      output
    );
    expect(
      output.parts.some(
        part =>
          part.synthetic &&
          part.id?.startsWith('prt_rules_') &&
          part.text?.includes('Mixed hook guidance.')
      )
    ).toBe(true);
  });

  it('uses the original snapshot body for hook text after an in-process edit', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'snap-hook.md');
    writeFileSync(
      rulePath,
      `---\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "eslint"\n---\n\nVersion one.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;

    const first: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'first' }],
    };
    await chatMessage(
      { sessionID: 'ses_hook_edit', messageID: 'msg_he_1' },
      first
    );
    expect(first.parts.some(part => part.text?.includes('Version one.'))).toBe(
      true
    );

    writeFileSync(
      rulePath,
      `---\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "eslint"\n---\n\nVersion two.`
    );
    await after(
      {
        tool: 'bash',
        sessionID: 'ses_hook_edit',
        callID: 'call_1',
        args: { command: 'npx eslint src/' },
      },
      { title: '', output: '', metadata: {} }
    );

    const second: ChatMessageOutputLike = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'second' }],
    };
    await chatMessage(
      { sessionID: 'ses_hook_edit', messageID: 'msg_he_2' },
      second
    );
    const hookPart = second.parts.find(
      p => p.synthetic && p.text?.includes('Version one.')
    );
    expect(hookPart?.text).toContain('Version one.');
    expect(hookPart?.text).not.toContain('Version two.');
  });

  it('writes ephemeral matches to matched state without persisting their parts', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'plan-only.mdc');
    writeFileSync(rulePath, `---\nagent: [plan]\n---\n\nPlan guidance.`);
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as ChatMessageHook;
    await chatMessage(
      { sessionID: 'ses_matched_eph', messageID: 'msg_matched_eph' },
      {
        message: { role: 'user', agent: 'plan' },
        parts: [{ type: 'text', text: 'plan this' }],
      }
    );

    await new Promise(resolve => setTimeout(resolve, 50));
    const state = await readMatchedRulesState('ses_matched_eph', { stateDir });
    expect(state?.matchedRulePaths).toEqual([rulePath]);
  });
});
