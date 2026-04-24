/**
 * Tests for OpenCodeRulesPlugin runtime behavior and session state management.
 * Split from index.test.ts for maintainability.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { writeFileSync, mkdirSync, readdirSync } from 'fs';
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
import * as runtimeContextModule from './runtime-context.js';
import * as runtimeChatModule from './runtime-chat.js';
import { __testOnly } from './index.js';
import {
  _setStateDirForTesting,
  readActiveRulesState,
} from './active-rules-state.js';
import { clearRuleCache } from './utils.js';

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

  it('should re-export readAndFormatRules from rule-filter module', () => {
    expect(ruleFilterModule.readAndFormatRules).toBeDefined();
    expect(typeof ruleFilterModule.readAndFormatRules).toBe('function');
    expect(utilsModule.readAndFormatRules).toBe(
      ruleFilterModule.readAndFormatRules
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

  it('should re-export RuleFilterContext type via utils facade', () => {
    const context: utilsModule.RuleFilterContext = {
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
  it('should export buildFilterContext from runtime-context module', () => {
    expect(runtimeContextModule.buildFilterContext).toBeDefined();
    expect(typeof runtimeContextModule.buildFilterContext).toBe('function');
  });

  it('should export detectCiEnvironment from runtime-context module', () => {
    expect(runtimeContextModule.detectCiEnvironment).toBeDefined();
    expect(typeof runtimeContextModule.detectCiEnvironment).toBe('function');
  });

  it('should export handleChatMessage from runtime-chat module', () => {
    expect(runtimeChatModule.handleChatMessage).toBeDefined();
    expect(typeof runtimeChatModule.handleChatMessage).toBe('function');
  });

  it('should export extractUserPromptFromParts from runtime-chat module', () => {
    expect(runtimeChatModule.extractUserPromptFromParts).toBeDefined();
    expect(typeof runtimeChatModule.extractUserPromptFromParts).toBe(
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

  it('should extract user prompt from parts via runtime-chat module', () => {
    const parts = [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
    ];
    const result = runtimeChatModule.extractUserPromptFromParts(parts);
    expect(result).toBe('Hello world');
  });

  it('should return empty string for undefined parts in runtime-chat module', () => {
    const result = runtimeChatModule.extractUserPromptFromParts(undefined);
    expect(result).toBe('');
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
    expect(hooks).toHaveProperty('experimental.chat.messages.transform');
    expect(hooks).toHaveProperty('experimental.chat.system.transform');
    expect(typeof hooks['experimental.chat.messages.transform']).toBe(
      'function'
    );
    expect(typeof hooks['experimental.chat.system.transform']).toBe('function');
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
    expect(hooks).toHaveProperty('experimental.chat.messages.transform');
    expect(hooks).toHaveProperty('experimental.chat.system.transform');
  });

  it('should inject rules into system prompt via system.transform hook', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'rule.md'),
      '# Test Rule\nDo this always'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      {},
      { system: 'You are a helpful assistant.' }
    );

    expect(result.system).toContain('You are a helpful assistant.');
    expect(result.system).toContain('OpenCode Rules');
    expect(result.system).toContain('Test Rule');
  });

  it('should append rules to existing system prompt', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# My Rule');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      {},
      { system: 'Original system prompt.' }
    );

    expect(result.system).toMatch(/^Original system prompt\./);
    expect(result.system).toContain('My Rule');
  });

  it('should handle empty system prompt', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule Content');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );
    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: '' });

    expect(result.system).toContain('OpenCode Rules');
    expect(result.system).toContain('Rule Content');
  });

  it('should not modify messages in messages.transform hook', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });

    const originalMessages = [
      {
        role: 'user',
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

    expect(__testOnly.getSeedCount('ses_seed')).toBe(1);
  });
  it('queues PreToolUse hook injection when bash command matches', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    // Clear rule cache to ensure fresh reads
    utilsModule.clearRuleCache();

    writeFileSync(
      path.join(globalRulesDir, 'security.mdc'),
      `---\nhooks:\n  - type: PreToolUse\n    tool: bash\n    match: "0\\\\.0\\\\.0\\\\.0"\n---\n\nDo not bind to 0.0.0.0.`
    );

    const {
      default: { server: plugin },
      __testOnly,
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
      { tool: 'bash', sessionID: 'ses_pre', callID: 'call_1' },
      { args: { command: 'node server.js --host 0.0.0.0' } }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_pre');
    expect(snapshot?.pendingHookInjections).toHaveLength(1);
    expect(snapshot?.pendingHookInjections?.[0]).toContain(
      'Do not bind to 0.0.0.0'
    );
  });

  it('registers tool.execute.after hook and queues PostToolUse injection', async () => {
    clearRuleCache();
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    writeFileSync(
      path.join(globalRulesDir, 'steering.mdc'),
      `---\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "grep"\n---\n\nUse ripgrep (rg) instead of grep.`
    );

    const {
      default: { server: plugin },
      __testOnly,
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
        tool: 'bash',
        sessionID: 'ses_post',
        callID: 'call_1',
        args: { command: 'grep foo' },
      },
      { title: '', output: '', metadata: {} }
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_post');
    expect(snapshot?.pendingHookInjections).toHaveLength(1);
    expect(snapshot?.pendingHookInjections?.[0]).toContain('Use ripgrep');
  });

  it('delivers pending PreToolUse injection in system transform', async () => {
    clearRuleCache();
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    writeFileSync(
      path.join(globalRulesDir, 'security.mdc'),
      `---\nhooks:\n  - type: PreToolUse\n    tool: bash\n    match: "0\\\\.0\\\\.0\\\\.0"\n---\n\nDo not bind to 0.0.0.0.`
    );

    const {
      default: { server: plugin },
      __testOnly,
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
      { tool: 'bash', sessionID: 'ses_deliver', callID: 'call_1' },
      { args: { command: 'node server.js --host 0.0.0.0' } }
    );

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      { sessionID: 'ses_deliver' },
      { system: 'Base prompt.' }
    );

    expect(result.system).toContain('Do not bind to 0.0.0.0');

    // Pending injections should be cleared after delivery
    const snapshot = __testOnly.getSessionStateSnapshot('ses_deliver');
    expect(snapshot?.pendingHookInjections).toHaveLength(0);
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

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      { sessionID: 'ses_1' },
      { system: 'Base prompt.' }
    );

    expect(result.system).toContain('React best practices');
  });

  it('skips full rule injection when session is compacting', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always\nAlways apply this'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
      __testOnly,
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    __testOnly.upsertSessionState(
      'ses_compact',
      s => void (s.isCompacting = true)
    );

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform(
      { sessionID: 'ses_compact' },
      { system: 'Base prompt.' }
    );

    expect(result.system).toBe('Base prompt.');
  });
});

describe('Active rules state persistence', () => {
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
  });

  afterEach(async () => {
    teardownTestDirs();
    _setStateDirForTesting(null);
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const sessionID = 'ses-state-match';
    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;

    const result = await systemTransform(
      { sessionID },
      { system: 'Base prompt.' }
    );

    expect(result.system).toContain('Always Apply');

    // Wait for fire-and-forget write to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const state = await readActiveRulesState(sessionID);
    expect(state).not.toBeNull();
    expect(state?.sessionId).toBe(sessionID);
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

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const sessionID = 'ses-state-nomatch';
    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;

    const result = await systemTransform(
      { sessionID },
      { system: 'Base prompt.' }
    );

    // No rules should match (model is not gpt-5)
    expect(result.system).not.toContain('Conditional rule');

    // Wait for fire-and-forget write to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const state = await readActiveRulesState(sessionID);
    expect(state).not.toBeNull();
    expect(state?.sessionId).toBe(sessionID);
    expect(state?.matchedRulePaths).toHaveLength(0);
  });

  it('does not write state when sessionID is missing', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Test Rule\nContent');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({ testDir });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: { sessionID?: string },
      output: { system: string }
    ) => Promise<{ system: string }>;

    // Call without sessionID
    await systemTransform({}, { system: 'Base prompt.' });

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
      'extractFilePathsFromMessages',
      'parseRuleMetadata',
      'promptMatchesKeywords',
      'readAndFormatRules',
      'toolsMatchAvailable',
    ]);
  });
});

describe('session-store runtime exports', () => {
  it('exports only SessionStore and createSessionStore at runtime', () => {
    const exportedKeys = Object.keys(sessionStoreModule).sort();
    expect(exportedKeys).toEqual(['SessionStore', 'createSessionStore']);
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

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).toContain('CI-specific guidelines');
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

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).not.toContain('CI-only guidelines');
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

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).not.toContain('CI-zero guidelines');
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

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).toContain('CI-fallback guidelines');
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

    const systemTransform = hooks['experimental.chat.system.transform'] as (
      input: unknown,
      output: { system: string }
    ) => Promise<{ system: string }>;
    const result = await systemTransform({}, { system: 'Base prompt.' });

    expect(result.system).not.toContain('CI-build-number guidelines');
  });
});
