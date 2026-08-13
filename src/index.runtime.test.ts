/**
 * Tests for OpenCodeRulesRuntime (v2) behavior and session state management.
 * Split from index.test.ts for maintainability.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  createRuntime,
  createMockSessionContext,
  createMockToolExecuteBefore,
  createMockToolExecuteAfter,
  systemText,
  toRules,
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
import * as ruleHooksModule from './rule-hooks.js';
import { __testOnly } from './index.js';
import {
  _setStateDirForTesting,
  readActiveRulesState,
} from './active-rules-state.js';
import { RuleBlockError } from './runtime.js';
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

describe('runtime context and tool hooks (v2)', () => {
  beforeEach(() => {
    setupTestDirs();
    _setStateDirForTesting(path.join(getTestDirs().testDir, 'state'));
    __testOnly.resetSessionState();
    clearRuleCache();
  });

  afterEach(() => {
    teardownTestDirs();
    _setStateDirForTesting(null);
    __testOnly.resetSessionState();
  });

  describe('context hook', () => {
    it('injects rules into the system prompt', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'rule.md');
      writeFileSync(rulePath, '# Test Rule\nDo this always');
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      const ctx = createMockSessionContext({
        sessionID: 'ses_inject',
        system: [{ type: 'text', text: 'You are a helpful assistant.' }],
      });
      await hookRegistry.context!(ctx);

      expect(systemText(ctx.system)).toContain('You are a helpful assistant.');
      expect(systemText(ctx.system)).toContain('OpenCode Rules');
      expect(systemText(ctx.system)).toContain('Test Rule');
    });

    it('appends rules to existing system prompt', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'rule.md');
      writeFileSync(rulePath, '# My Rule');
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      const ctx = createMockSessionContext({
        sessionID: 'ses_append',
        system: [{ type: 'text', text: 'Original system prompt.' }],
      });
      await hookRegistry.context!(ctx);

      expect(systemText(ctx.system)).toMatch(/^Original system prompt\./);
      expect(systemText(ctx.system)).toContain('My Rule');
    });

    it('injects rules when the system prompt is empty', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'rule.md');
      writeFileSync(rulePath, '# Rule Content');
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      const ctx = createMockSessionContext({ sessionID: 'ses_empty' });
      await hookRegistry.context!(ctx);

      expect(systemText(ctx.system)).toContain('OpenCode Rules');
      expect(systemText(ctx.system)).toContain('Rule Content');
    });

    it('does not modify messages during context dispatch', async () => {
      const { hookRegistry } = await createRuntime({
        sessionDirectory: getTestDirs().testDir,
      });
      const originalMessages = [
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];

      const ctx = createMockSessionContext({
        sessionID: 'ses_messages',
        messages: originalMessages,
      });
      await hookRegistry.context!(ctx);

      expect(ctx.messages).toEqual(originalMessages);
    });

    it('seeds session state once from message history and does not rescan', async () => {
      const { hookRegistry } = await createRuntime({
        sessionDirectory: getTestDirs().testDir,
      });
      const messages = [
        {
          role: 'assistant' as const,
          content: [
            {
              type: 'tool-call' as const,
              id: 'c1',
              name: 'read',
              input: { filePath: 'src/a.ts' },
            },
          ],
        },
      ];

      await hookRegistry.context!(
        createMockSessionContext({ sessionID: 'ses_seed', messages })
      );
      await hookRegistry.context!(
        createMockSessionContext({ sessionID: 'ses_seed', messages })
      );

      expect(__testOnly.getSeedCount('ses_seed')).toBe(1);
      const snapshot = __testOnly.getSessionStateSnapshot('ses_seed');
      expect(snapshot?.contextPaths.has('src/a.ts')).toBe(true);
    });

    it('delivers pending PreToolUse injection in the next context dispatch', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'security.mdc');
      writeFileSync(
        rulePath,
        `---\nhooks:\n  - type: PreToolUse\n    tool: bash\n    match: "0\\\\.0\\\\.0\\\\.0"\n---\n\nDo not bind to 0.0.0.0.`
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      await hookRegistry['execute.before']!(
        createMockToolExecuteBefore({
          tool: 'bash',
          sessionID: 'ses_deliver',
          input: { command: 'node server.js --host 0.0.0.0' },
        })
      );

      const ctx = createMockSessionContext({
        sessionID: 'ses_deliver',
        system: [{ type: 'text', text: 'Base prompt.' }],
      });
      await hookRegistry.context!(ctx);

      expect(systemText(ctx.system)).toContain('Do not bind to 0.0.0.0');

      // Pending injections should be cleared after delivery
      const snapshot = __testOnly.getSessionStateSnapshot('ses_deliver');
      expect(snapshot?.pendingHookInjections).toHaveLength(0);
    });
  });

  describe('tool.execute.before', () => {
    it('queues PreToolUse hook injection when bash command matches', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'security.mdc');
      writeFileSync(
        rulePath,
        `---\nhooks:\n  - type: PreToolUse\n    tool: bash\n    match: "0\\\\.0\\\\.0\\\\.0"\n---\n\nDo not bind to 0.0.0.0.`
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      await hookRegistry['execute.before']!(
        createMockToolExecuteBefore({
          tool: 'bash',
          sessionID: 'ses_pre',
          input: { command: 'node server.js --host 0.0.0.0' },
        })
      );

      const snapshot = __testOnly.getSessionStateSnapshot('ses_pre');
      expect(snapshot?.pendingHookInjections).toHaveLength(1);
      expect(snapshot?.pendingHookInjections?.[0]).toContain(
        'Do not bind to 0.0.0.0'
      );
    });

    it('throws when PreToolUse hook has block: true', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'blocker.mdc');
      writeFileSync(
        rulePath,
        `---\nhooks:\n  - type: PreToolUse\n    tool: bash\n    match: "0\\\\.0\\\\.0\\\\.0"\n    block: true\n---\n\nBlocked.`
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      const blocked = hookRegistry['execute.before']!(
        createMockToolExecuteBefore({
          tool: 'bash',
          sessionID: 'ses_block',
          input: { command: 'node server.js --host 0.0.0.0' },
        })
      );
      await expect(blocked).rejects.toBeInstanceOf(RuleBlockError);
      await expect(blocked).rejects.toThrow('[opencode-rules] Blocked by rule');
    });

    it('includes glob-conditional rule when tool hook records matching file path', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'typescript.mdc');
      writeFileSync(
        rulePath,
        `---\nglobs:\n  - "src/components/**/*.tsx"\n---\n\nUse React best practices.`
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      await hookRegistry['execute.before']!(
        createMockToolExecuteBefore({
          tool: 'read',
          sessionID: 'ses_glob',
          input: { filePath: 'src/components/Button.tsx' },
        })
      );

      const ctx = createMockSessionContext({ sessionID: 'ses_glob' });
      await hookRegistry.context!(ctx);

      expect(systemText(ctx.system)).toContain('React best practices');
    });
  });

  describe('tool.execute.after', () => {
    it('queues PostToolUse injection', async () => {
      const { globalRulesDir } = getTestDirs();
      const rulePath = path.join(globalRulesDir, 'steering.mdc');
      writeFileSync(
        rulePath,
        `---\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "grep"\n---\n\nUse ripgrep (rg) instead of grep.`
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      await hookRegistry['execute.after']!(
        createMockToolExecuteAfter({
          tool: 'bash',
          sessionID: 'ses_post',
          input: { command: 'grep foo' },
        })
      );

      const snapshot = __testOnly.getSessionStateSnapshot('ses_post');
      expect(snapshot?.pendingHookInjections).toHaveLength(1);
      expect(snapshot?.pendingHookInjections?.[0]).toContain('Use ripgrep');
    });

    it('executes run side-effect when PostToolUse hook fires', async () => {
      const { testDir, globalRulesDir } = getTestDirs();
      const markerFile = path.join(testDir, 'side-effect-marker.txt');
      const rulePath = path.join(globalRulesDir, 'side-effect.mdc');
      writeFileSync(
        rulePath,
        `---\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "grep"\n    run: "echo fired > ${markerFile}"\n---\n\nSide effect rule.`
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: testDir,
      });

      await hookRegistry['execute.after']!(
        createMockToolExecuteAfter({
          tool: 'bash',
          sessionID: 'ses_run',
          input: { command: 'grep foo' },
        })
      );

      const marker = readFileSync(markerFile, 'utf-8').trim();
      expect(marker).toBe('fired');
    });
  });
});

describe('SessionState', () => {
  beforeEach(() => {
    setupTestDirs();
    _setStateDirForTesting(path.join(getTestDirs().testDir, 'state'));
    __testOnly.resetSessionState();
    clearRuleCache();
  });

  afterEach(() => {
    teardownTestDirs();
    _setStateDirForTesting(null);
    __testOnly.resetSessionState();
  });

  it('prunes session state when over limit', () => {
    __testOnly.setSessionStateLimit(2);
    __testOnly.upsertSessionState('ses_1', s => void (s.lastUpdated = 1));
    __testOnly.upsertSessionState('ses_2', s => void (s.lastUpdated = 2));
    __testOnly.upsertSessionState('ses_3', s => void (s.lastUpdated = 3));

    const ids = __testOnly.getSessionStateIDs();
    expect(ids).toHaveLength(2);
    expect(ids).toContain('ses_2');
    expect(ids).toContain('ses_3');
  });

  it('captures lastUserPrompt from user messages', async () => {
    const { hookRegistry } = await createRuntime({
      sessionDirectory: getTestDirs().testDir,
    });

    await hookRegistry.context!(
      createMockSessionContext({
        sessionID: 'ses_test',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'please add tests' }],
          },
        ],
      })
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_test');
    expect(snapshot?.lastUserPrompt).toBe('please add tests');
  });

  it('updates model and agent on subsequent context dispatches', async () => {
    const { hookRegistry } = await createRuntime({
      sessionDirectory: getTestDirs().testDir,
    });

    await hookRegistry.context!(
      createMockSessionContext({
        sessionID: 'ses_update',
        model: { id: 'model-v1', providerID: 'test' },
        agent: 'agent-v1',
      })
    );

    await hookRegistry.context!(
      createMockSessionContext({
        sessionID: 'ses_update',
        model: { id: 'model-v2', providerID: 'test' },
        agent: 'agent-v2',
      })
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_update');
    expect(snapshot?.lastModelID).toBe('model-v2');
    expect(snapshot?.lastAgentType).toBe('agent-v2');
  });

  it('skips full rule injection when session is compacting', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'always.md');
    writeFileSync(rulePath, '# Always\nAlways apply this');
    const { hookRegistry } = await createRuntime({
      globalRules: toRules([rulePath]),
      sessionDirectory: getTestDirs().testDir,
    });

    __testOnly.upsertSessionState(
      'ses_compact',
      s => void (s.isCompacting = true)
    );

    const ctx = createMockSessionContext({
      sessionID: 'ses_compact',
      system: [{ type: 'text', text: 'Base prompt.' }],
    });
    await hookRegistry.context!(ctx);

    expect(ctx.system).toHaveLength(1);
    expect(systemText(ctx.system)).toBe('Base prompt.');
  });
});

describe('Active rules state persistence', () => {
  let stateDir: string;

  beforeEach(() => {
    setupTestDirs();
    __testOnly.resetSessionState();
    clearRuleCache();
    stateDir = path.join(getTestDirs().testDir, 'state');
    mkdirSync(stateDir, { recursive: true });
    _setStateDirForTesting(stateDir);
  });

  afterEach(() => {
    teardownTestDirs();
    _setStateDirForTesting(null);
    __testOnly.resetSessionState();
  });

  it('writes matched rule paths to state file when rules match', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'always-apply.md');
    writeFileSync(rulePath, '# Always Apply\nThis rule always applies.');
    const { hookRegistry } = await createRuntime({
      globalRules: toRules([rulePath]),
      sessionDirectory: testDir,
    });

    const sessionID = 'ses-state-match';
    const ctx = createMockSessionContext({ sessionID });
    await hookRegistry.context!(ctx);

    expect(systemText(ctx.system)).toContain('Always Apply');

    // Wait for fire-and-forget write to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const state = await readActiveRulesState(sessionID);
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
    const { hookRegistry } = await createRuntime({
      globalRules: toRules([rulePath]),
      sessionDirectory: testDir,
    });

    const sessionID = 'ses-state-nomatch';
    const ctx = createMockSessionContext({ sessionID });
    await hookRegistry.context!(ctx);

    // No rules should match (model is not gpt-5)
    expect(systemText(ctx.system)).toBe('');

    // Wait for fire-and-forget write to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const state = await readActiveRulesState(sessionID);
    expect(state).not.toBeNull();
    expect(state?.sessionID).toBe(sessionID);
    expect(state?.matchedRulePaths).toHaveLength(0);
  });

  it('does not write state when sessionID is missing', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Test Rule\nContent');
    const { hookRegistry } = await createRuntime({
      globalRules: toRules([path.join(globalRulesDir, 'rule.md')]),
      sessionDirectory: testDir,
    });

    // Call with empty sessionID
    await hookRegistry.context!(createMockSessionContext({ sessionID: '' }));

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
      'discoverProjectRuleFiles',
      'discoverRuleFiles',
      'evaluateHooks',
      'extractFilePathsFromMessages',
      'getCachedRule',
      'hasConditions',
      'parseRuleMetadata',
      'promptMatchesKeywords',
      'readActiveRulesState',
      'readAndFormatRules',
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

describe('CI environment detection', () => {
  let savedCiEnv: CiEnvSnapshot;

  beforeEach(() => {
    setupTestDirs();
    savedCiEnv = saveCiEnvVars();
    _setStateDirForTesting(path.join(getTestDirs().testDir, 'state'));
    __testOnly.resetSessionState();
    clearRuleCache();
  });

  afterEach(() => {
    teardownTestDirs();
    restoreCiEnvVars(savedCiEnv);
    _setStateDirForTesting(null);
    __testOnly.resetSessionState();
  });

  async function contextSystemWithRule(ruleContent: string): Promise<string> {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'ci-rule.mdc');
    writeFileSync(rulePath, ruleContent);
    const { hookRegistry } = await createRuntime({
      globalRules: toRules([rulePath]),
      sessionDirectory: getTestDirs().testDir,
    });

    const ctx = createMockSessionContext({ sessionID: 'ses-ci' });
    await hookRegistry.context!(ctx);
    return systemText(ctx.system);
  }

  it('should include ci-conditional rule when CI env var is set', async () => {
    clearCiEnvVars();
    process.env.CI = 'true';

    const system = await contextSystemWithRule(
      `---\nci: true\n---\n\nCI-specific guidelines.`
    );
    expect(system).toContain('CI-specific guidelines');
  });

  it('should NOT include ci:true rule when CI env var is "false"', async () => {
    clearCiEnvVars();
    process.env.CI = 'false';

    const system = await contextSystemWithRule(
      `---\nci: true\n---\n\nCI-only guidelines.`
    );
    expect(system).not.toContain('CI-only guidelines');
  });

  it('should NOT include ci:true rule when CI env var is "0"', async () => {
    clearCiEnvVars();
    process.env.CI = '0';

    const system = await contextSystemWithRule(
      `---\nci: true\n---\n\nCI-zero guidelines.`
    );
    expect(system).not.toContain('CI-zero guidelines');
  });

  it('should detect CI from provider vars when CI env var is not set', async () => {
    clearCiEnvVars();
    process.env.GITHUB_ACTIONS = 'true';

    const system = await contextSystemWithRule(
      `---\nci: true\n---\n\nCI-fallback guidelines.`
    );
    expect(system).toContain('CI-fallback guidelines');
  });

  it('should NOT detect CI when BUILD_NUMBER is "false"', async () => {
    clearCiEnvVars();
    process.env.BUILD_NUMBER = 'false';

    const system = await contextSystemWithRule(
      `---\nci: true\n---\n\nCI-build-number guidelines.`
    );
    expect(system).not.toContain('CI-build-number guidelines');
  });
});
