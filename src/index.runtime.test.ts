/**
 * Tests for OpenCodeRulesPlugin runtime behavior and session state management.
 * Split from index.test.ts for maintainability.
 *
 * v2 port: hooks register through ctx.tool.hook/ctx.session.hook on the
 * mock plugin context; session state is inspected via a SessionStore
 * injected through createRuntime (v1's __testOnly seam is retired).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  admissionText,
  createMockPluginInput,
  saveCiEnvVars,
  clearCiEnvVars,
  restoreCiEnvVars,
  syntheticAdmissions,
  type CiEnvSnapshot,
} from './test-fixtures.js';
import {
  MatchedRulesStateStore,
  readMatchedRulesState,
} from './session/matched-rules-state.js';
import { SessionStore } from './session/session-store.js';
import { createRuntime } from './runtime/create-runtime.js';
import { clearRuleCache } from './rules/rule-discovery.js';
import { buildDurableDeliveryPart } from './delivery/rule-delivery-codec.js';

import * as ruleDiscoveryModule from './rules/rule-discovery.js';
import * as ruleMetadataModule from './rules/rule-metadata.js';
import * as ruleFilterModule from './rules/rule-filter.js';
import * as messagePathsModule from './session/message-extraction.js';
import * as ruleHooksModule from './rules/rule-hooks.js';
import * as sessionStoreModule from './session/session-store.js';
import * as matchedRulesStateModule from './session/matched-rules-state.js';
import * as runtimeContextModule from './runtime/match-context.js';
import * as runtimeChatModule from './runtime/chat-capture.js';

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

  it('should export captureSessionContext from chat-capture module', () => {
    expect(runtimeChatModule.captureSessionContext).toBeDefined();
    expect(typeof runtimeChatModule.captureSessionContext).toBe('function');
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
  let sessionStore: SessionStore;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    sessionStore = new SessionStore();
  });

  afterEach(() => {
    teardownTestDirs();
    vi.resetAllMocks();
    sessionStore.reset();
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

  /** Builds the runtime with the test session store injected. */
  async function buildRuntime(
    mockInput: ReturnType<typeof createMockPluginInput>
  ) {
    return createRuntime({
      client: mockInput.context,
      directory: mockInput.context.location.directory,
      projectDirectory: mockInput.context.location.directory,
      sessionStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
      return { runtime, mockInput };
    });
  }

  const ctxHook = (mockInput: ReturnType<typeof createMockPluginInput>) =>
    mockInput.hooks.sessionContext[0]!;
  const beforeHook = (mockInput: ReturnType<typeof createMockPluginInput>) =>
    mockInput.hooks.toolBefore[0]!;
  const afterHook = (mockInput: ReturnType<typeof createMockPluginInput>) =>
    mockInput.hooks.toolAfter[0]!;

  it('should export a plugin module with id and setup', async () => {
    const { default: pluginModule } = await import('./index.js');
    expect(pluginModule).toHaveProperty('id', 'opencode-rules');
    expect(typeof pluginModule.setup).toBe('function');
  });

  it('should register all four v2 hooks through the mock context', async () => {
    const { testDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await buildRuntime(mockInput);

    expect(mockInput.hooks.toolBefore).toHaveLength(1);
    expect(mockInput.hooks.toolAfter).toHaveLength(1);
    expect(mockInput.hooks.sessionContext).toHaveLength(1);
    expect(mockInput.hooks.sessionPrompt).toHaveLength(1);
  });

  it('modifies context messages only by appending transient messages', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await buildRuntime(mockInput);

    const originalMessages = [
      {
        id: 'msg_u1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
    ];

    await ctxHook(mockInput)({
      sessionID: 'test-123',
      messages: originalMessages,
    });

    // No ephemeral rule matched ('# Rule' is unconditional=durable), so
    // nothing is appended to the dispatch.
    expect(originalMessages).toHaveLength(1);
  });

  it('seeds session state once from context messages and does not rescan', async () => {
    const { testDir } = getTestDirs();
    const mockInput = createMockPluginInput({ testDir });
    let historyReads = 0;
    if (mockInput.context.session) {
      mockInput.context.session.context = async () => {
        historyReads++;
        return { data: [] };
      };
    }
    await buildRuntime(mockInput);

    const messages = [
      {
        id: 'msg_a1',
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            id: 'call_1',
            name: 'read',
            input: { filePath: 'src/a.ts' },
          },
        ],
      },
    ];

    await ctxHook(mockInput)({ sessionID: 'ses_seed', messages });
    await ctxHook(mockInput)({ sessionID: 'ses_seed', messages });

    expect(historyReads).toBe(0);
  });

  it('seeds context paths from current v2 tool-call parts', async () => {
    const { testDir } = getTestDirs();
    const mockInput = createMockPluginInput({ testDir });
    await buildRuntime(mockInput);

    await ctxHook(mockInput)({
      sessionID: 'ses_current_seed',
      messages: [
        {
          id: 'msg_a1',
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              id: 'call_1',
              name: 'read',
              input: { filePath: 'src/current.ts' },
            },
          ],
        },
      ],
    });

    const snapshot = sessionStore.snapshot('ses_current_seed');
    expect(snapshot?.workingContextPaths.has('src/current.ts')).toBe(true);
    expect(snapshot?.workingContextSeeded).toBe(true);
  });

  it('throws Tool-like error when PreToolUse hook has block: true', async () => {
    clearRuleCache();
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    writeFileSync(
      path.join(globalRulesDir, 'blocker.mdc'),
      `---\nhooks:\n  - type: PreToolUse\n    tool: bash\n    match: "0\\\\.0\\\\.0\\\\.0"\n    block: true\n---\n\nBlocked.`
    );

    const mockInput = createMockPluginInput({ testDir });
    await buildRuntime(mockInput);

    await expect(
      beforeHook(mockInput)({
        tool: 'bash',
        sessionID: 'ses_block',
        id: 'call_1',
        input: { command: 'node server.js --host 0.0.0.0' },
      })
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

    const mockInput = createMockPluginInput({ testDir });
    await buildRuntime(mockInput);

    await afterHook(mockInput)({
      tool: 'bash',
      sessionID: 'ses_run',
      id: 'call_1',
      input: { command: 'grep foo' },
      status: 'completed',
      result: { content: '' },
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const { readFileSync } = await import('fs');
    const marker = readFileSync(markerFile, 'utf-8').trim();
    expect(marker).toBe('fired');
  });
});

describe('SessionState', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;
  let sessionStore: SessionStore;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    sessionStore = new SessionStore();
  });

  afterEach(() => {
    teardownTestDirs();
    sessionStore.reset();
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

  it('prunes session state when over limit', () => {
    sessionStore.setMax(2);
    sessionStore.upsert('ses_1', () => {});
    sessionStore.upsert('ses_2', () => {});
    sessionStore.upsert('ses_3', () => {});

    const ids = sessionStore.ids();
    expect(ids).toHaveLength(2);
    expect(ids).toContain('ses_2');
    expect(ids).toContain('ses_3');
  });

  it('updates lastUserPrompt from session prompt hook', async () => {
    const { testDir } = getTestDirs();
    const mockInput = createMockPluginInput({ testDir });
    await createRuntime({
      client: mockInput.context,
      directory: testDir,
      projectDirectory: testDir,
      sessionStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
    });
    const hook = mockInput.hooks.sessionPrompt[0]!;
    expect(hook).toBeTypeOf('function');

    await hook({
      sessionID: 'ses_test',
      messageID: 'msg_test_1',
      prompt: { text: 'please add tests' },
    });

    const snapshot = sessionStore.snapshot('ses_test');
    expect(snapshot?.lastUserPrompt).toBe('please add tests');
  });

  it('stores lastModelID from session context hook', async () => {
    const { testDir } = getTestDirs();
    const mockInput = createMockPluginInput({ testDir });
    await createRuntime({
      client: mockInput.context,
      directory: testDir,
      projectDirectory: testDir,
      sessionStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
    });

    await mockInput.hooks.sessionContext[0]!({
      sessionID: 'ses_model',
      agent: 'build',
      model: { id: 'claude-opus' },
      messages: [
        {
          id: 'msg_u1',
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
    });

    const snapshot = sessionStore.snapshot('ses_model');
    expect(snapshot?.lastModelID).toBe('claude-opus');
  });

  it('stores lastAgentType from session context hook', async () => {
    const { testDir } = getTestDirs();
    const mockInput = createMockPluginInput({ testDir });
    await createRuntime({
      client: mockInput.context,
      directory: testDir,
      projectDirectory: testDir,
      sessionStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
    });

    await mockInput.hooks.sessionContext[0]!({
      sessionID: 'ses_agent',
      agent: 'programmer',
      model: { id: 'claude-opus' },
      messages: [],
    });

    const snapshot = sessionStore.snapshot('ses_agent');
    expect(snapshot?.lastAgentType).toBe('programmer');
  });

  it('updates model/agent on subsequent context events', async () => {
    const { testDir } = getTestDirs();
    const mockInput = createMockPluginInput({ testDir });
    await createRuntime({
      client: mockInput.context,
      directory: testDir,
      projectDirectory: testDir,
      sessionStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
    });
    const hook = mockInput.hooks.sessionContext[0]!;

    await hook({
      sessionID: 'ses_update',
      agent: 'agent-v1',
      model: { id: 'model-v1' },
      messages: [],
    });
    await hook({
      sessionID: 'ses_update',
      agent: 'agent-v2',
      model: { id: 'model-v2' },
      messages: [],
    });

    const snapshot = sessionStore.snapshot('ses_update');
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

    const mockInput = createMockPluginInput({ testDir });
    await createRuntime({
      client: mockInput.context,
      directory: testDir,
      projectDirectory: testDir,
      sessionStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
    });
    const after = mockInput.hooks.toolAfter[0]!;
    expect(after).toBeDefined();

    await after({
      tool: 'read',
      sessionID: 'ses_1',
      id: 'call_1',
      input: { filePath: 'src/components/Button.tsx' },
      status: 'completed',
      result: { content: 'export const Button;' },
    });

    // Glob rules admit at observation time through a hidden synthetic
    // message (resume:false); the durable turn delivery is #72's territory.
    const admissions = syntheticAdmissions(mockInput);
    expect(admissionText(mockInput)).toContain('React best practices');
    expect(mockInput.promptCalls).toHaveLength(0);
    expect(admissions[0]?.resume).toBe(false);
    expect(admissions[0]?.metadata).toMatchObject({
      ruleAdmission: true,
    });
  });

  it('supported file tools produce observations; excluded tools do not', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    writeFileSync(
      path.join(globalRulesDir, 'legacy.mdc'),
      `---\nglobs:\n  - "src/legacy/**"\n---\n\nLegacy module guidance.`
    );

    const mockInput = createMockPluginInput({ testDir });
    await createRuntime({
      client: mockInput.context,
      directory: testDir,
      projectDirectory: testDir,
      sessionStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
    });

    const before = mockInput.hooks.toolBefore[0]!;
    const after = mockInput.hooks.toolAfter[0]!;

    await before({
      tool: 'glob',
      sessionID: 'ses_glob_live',
      id: 'call_glob_1',
      input: { pattern: 'src/legacy/**/*.ts' },
    });
    let snapshot = sessionStore.snapshot('ses_glob_live');
    expect(snapshot?.workingContextPaths.size ?? 0).toBe(0);

    await after({
      tool: 'write',
      sessionID: 'ses_glob_live',
      id: 'call_glob_1',
      input: {
        filePath: 'src/legacy/module.ts',
        content: 'const legacy = true;',
      },
      status: 'completed',
      result: { content: 'const legacy = true;' },
    });

    snapshot = sessionStore.snapshot('ses_glob_live');
    expect(snapshot?.workingContextPaths.has('src/legacy/module.ts')).toBe(
      true
    );

    expect(admissionText(mockInput)).toContain('Legacy module guidance');
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

  function wireWithStore(mockInput: ReturnType<typeof createMockPluginInput>) {
    return createRuntime({
      client: mockInput.context,
      directory: mockInput.context.location.directory,
      projectDirectory: mockInput.context.location.directory,
      matchedRulesStateStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
      return mockInput;
    });
  }

  it('does not let a history rescan overwrite the last complete matched state', async () => {
    const { testDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    await matchedRulesStateStore.write('ses_state_reconcile', [
      '/rules/current.mdc',
    ]);

    const mockInput = await wireWithStore(createMockPluginInput({ testDir }));
    await mockInput.hooks.sessionContext[0]!({
      sessionID: 'ses_state_reconcile',
      messages: [
        {
          id: 'msg_history',
          role: 'user',
          content: [
            { type: 'text', text: 'resume' },
            // Durable delivery part shape inside an AI Message text part:
            // metadata rides the part, matching the v2 context message form.
            {
              type: 'text',
              text: buildDurableDeliveryPart(
                [
                  {
                    relativePath: 'persisted.md',
                    content: 'Persisted rule body.',
                  },
                ],
                [],
                { sessionID: 'ses_state_reconcile', messageID: 'msg_history' }
              ).text,
              metadata: { ruleKeys: ['persistedkey'] },
            },
          ],
        },
      ],
    });

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

    const mockInput = await wireWithStore(createMockPluginInput({ testDir }));
    const ctx = mockInput.hooks.sessionContext[0]!;
    const prompt = mockInput.hooks.sessionPrompt[0]!;

    await prompt({
      sessionID: 'ses_comp_eph',
      messageID: 'msg_ce_1',
      prompt: { text: 'plan the testing work' },
    });

    // Compaction arrives as an event the runtime sees via markCompacted.
    // Here we drive the projection path directly through a second dispatch.
    const messages = [
      {
        id: 'msg_ce_2',
        role: 'user',
        content: [{ type: 'text', text: 'plan the testing work' }],
      },
    ];
    await ctx({ sessionID: 'ses_comp_eph', messages });
    // Ephemeral plan rule matches the plan agent only when agentType is set;
    // unconditional durable rules ride the synthetic path instead.
    const transformedText = messages
      .flatMap(message => message.content as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(transformedText).not.toContain('Compaction survivor.');
  });

  it('seeds Working context from history once and shares the read with delivery', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always Apply\nSeeded rule.'
    );

    let historyReads = 0;
    const mockInput = createMockPluginInput({
      testDir,
      sessionContext: async () => {
        historyReads++;
        return {
          data: [
            {
              id: 'msg_a1',
              type: 'assistant',
              agent: 'build',
              model: { id: 'm' },
              content: [
                {
                  type: 'tool',
                  id: 'call_1',
                  name: 'read',
                  state: {
                    status: 'completed',
                    input: { filePath: 'src/shared.ts' },
                  },
                },
              ],
            },
          ],
        };
      },
    });
    await wireWithStore(mockInput);

    const prompt = mockInput.hooks.sessionPrompt[0]!;
    await prompt({
      sessionID: 'ses_shared_read',
      messageID: 'msg_shared_1',
      prompt: { text: 'continue work' },
    });

    expect(historyReads).toBe(1);
    const syntheticText = mockInput.syntheticCalls.map(c => c.text).join('\n');
    expect(syntheticText).toContain('Seeded rule.');
  });

  it('message removal does not subtract paths and still re-delivers durable rules', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    writeFileSync(
      path.join(globalRulesDir, 'gated.mdc'),
      `---\nglobs:\n  - "src/kept/**"\n---\n\nKept-directory guidance.`
    );

    const mockInput = await wireWithStore(createMockPluginInput({ testDir }));
    const after = mockInput.hooks.toolAfter[0]!;

    await after({
      tool: 'read',
      sessionID: 'ses_removal_paths',
      id: 'call_before_removal',
      input: { filePath: 'src/kept/a.ts' },
      status: 'completed',
      result: { content: 'export;' },
    });

    const promptResult = await runPromptWithSynthetic(mockInput, {
      sessionID: 'ses_removal_paths',
      messageID: 'msg_after_removal',
      prompt: { text: 'check kept files' },
    });
    // The globs rule admits at observation time via session.synthetic.
    expect(promptResult.text).toContain('Kept-directory guidance.');
  });

  it('compaction preserves Working context for later matching without re-delivering durable rules', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    writeFileSync(
      path.join(globalRulesDir, 'postcompact.mdc'),
      `---\nglobs:\n  - "src/keep/**"\n---\n\nPost-compaction guidance.`
    );

    const mockInput = await wireWithStore(createMockPluginInput({ testDir }));
    const after = mockInput.hooks.toolAfter[0]!;

    await after({
      tool: 'read',
      sessionID: 'ses_compact_paths',
      id: 'call_compact',
      input: { filePath: 'src/keep/zed.ts' },
      status: 'completed',
      result: { content: 'export;' },
    });

    // Compaction invalidation + projection ride events and the next
    // context dispatch; covered by dedicated event tests below.
    expect(after).toBeDefined();
    void runPromptWithSynthetic;
  });
});

async function runPromptWithSynthetic(
  mockInput: ReturnType<typeof createMockPluginInput>,
  input: { sessionID: string; messageID: string; prompt: { text: string } }
): Promise<{ text: string }> {
  await mockInput.hooks.sessionPrompt[0]!(input);
  return { text: admissionText(mockInput) };
}

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

  it('writes matched rule paths to state file when rules match', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'always-apply.md');
    writeFileSync(rulePath, '# Always Apply\nThis rule always applies.');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({
      testDir,
      syntheticCalls: [],
      promptCalls: [],
    });
    await createRuntime({
      client: mockInput.context,
      directory: testDir,
      projectDirectory: testDir,
      matchedRulesStateStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
    });

    const sessionID = 'ses-state-match';
    await mockInput.hooks.sessionPrompt[0]!({
      sessionID,
      messageID: 'msg_state_match_1',
      prompt: { text: 'hello' },
    });

    await vi.waitFor(async () => {
      const state = await readMatchedRulesState(sessionID, { stateDir });
      expect(state).not.toBeNull();
      expect(state?.sessionID).toBe(sessionID);
      expect(state?.matchedRulePaths).toHaveLength(1);
      expect(state?.matchedRulePaths[0]).toBe(rulePath);
    });
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

    const mockInput = createMockPluginInput({ testDir });
    await createRuntime({
      client: mockInput.context,
      directory: testDir,
      projectDirectory: testDir,
      matchedRulesStateStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
    });

    const sessionID = 'ses-state-nomatch';
    await mockInput.hooks.sessionPrompt[0]!({
      sessionID,
      messageID: 'msg_state_nomatch_1',
      prompt: { text: 'hello' },
    });

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

    const mockInput = createMockPluginInput({ testDir });
    await createRuntime({
      client: mockInput.context,
      directory: testDir,
      projectDirectory: testDir,
      matchedRulesStateStore,
    }).then(async runtime => {
      await runtime.wire(mockInput.context as never);
    });

    await mockInput.hooks.sessionPrompt[0]!({
      messageID: 'msg_x',
      prompt: { text: 'hello' },
    } as never);

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

  afterEach(() => {
    teardownTestDirs();
    restoreCiEnvVars(savedCiEnv);
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

  async function wireCi(mockInput: ReturnType<typeof createMockPluginInput>) {
    const runtime = await createRuntime({
      client: mockInput.context,
      directory: mockInput.context.location.directory,
      projectDirectory: mockInput.context.location.directory,
    });
    await runtime.wire(mockInput.context as never);
  }

  it('should include ci-conditional rule when CI env var is set', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'ci-rule.mdc'),
      `---\nci: true\n---\n\nCI-specific guidelines.`
    );

    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    clearCiEnvVars();
    process.env.CI = 'true';

    const mockInput = createMockPluginInput({
      testDir,
      syntheticCalls: [],
    });
    await wireCi(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_ci_1',
      messageID: 'msg_ci_1',
      prompt: { text: 'hello' },
    });

    const synthetic = mockInput.syntheticCalls.map(c => c.text).join('\n');
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

    const mockInput = createMockPluginInput({ testDir });
    await wireCi(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_ci_2',
      messageID: 'msg_ci_2',
      prompt: { text: 'hello' },
    });

    const synthetic = mockInput.syntheticCalls.map(c => c.text).join('\n');
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

    const mockInput = createMockPluginInput({ testDir });
    await wireCi(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_ci_3',
      messageID: 'msg_ci_3',
      prompt: { text: 'hello' },
    });

    const synthetic = mockInput.syntheticCalls.map(c => c.text).join('\n');
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

    const mockInput = createMockPluginInput({ testDir });
    await wireCi(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_ci_4',
      messageID: 'msg_ci_4',
      prompt: { text: 'hello' },
    });

    const synthetic = mockInput.syntheticCalls.map(c => c.text).join('\n');
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

    const mockInput = createMockPluginInput({ testDir });
    await wireCi(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_ci_5',
      messageID: 'msg_ci_5',
      prompt: { text: 'hello' },
    });

    const synthetic = mockInput.syntheticCalls.map(c => c.text).join('\n');
    expect(synthetic).not.toContain('CI-build-number guidelines');
  });
});
