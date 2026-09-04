/**
 * Durable rule persistence tests (v2: prompt hook -> ctx.session.synthetic;
 * restart dedupe via ledger seeding from synthetic history).
 * Split from index.runtime.test.ts for maintainability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  createMockPluginInput,
  getTestDirs,
  setupTestDirs,
  teardownTestDirs,
} from '../test-fixtures.js';
import { createRuntime } from '../runtime/create-runtime.js';
import {
  MatchedRulesStateStore,
  readMatchedRulesState,
} from '../session/matched-rules-state.js';
import { buildDurableDeliveryPart } from '../delivery/rule-delivery-codec.js';
import { clearRuleCache } from '../rules/rule-discovery.js';
import { SessionStore } from '../session/session-store.js';

describe('durable rule persistence', () => {
  let savedEnvXDG: string | undefined;
  let savedEnvConfigDir: string | undefined;
  let stateDir: string;
  let matchedRulesStateStore: MatchedRulesStateStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    setupTestDirs();
    savedEnvXDG = process.env.XDG_CONFIG_HOME;
    savedEnvConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    const { testDir } = getTestDirs();
    stateDir = path.join(testDir, 'state');
    mkdirSync(stateDir, { recursive: true });
    matchedRulesStateStore = new MatchedRulesStateStore({ stateDir });
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

  async function wire(
    mockInput: ReturnType<typeof createMockPluginInput>
  ): Promise<void> {
    const runtime = await createRuntime({
      client: mockInput.context,
      directory: mockInput.context.location.directory,
      projectDirectory: mockInput.context.location.directory,
      matchedRulesStateStore,
      sessionStore,
    });
    await runtime.wire(mockInput.context as never);
  }

  it('delivers all matched rules as one named synthetic event', async () => {
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

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_append',
      messageID: 'msg_append_1',
      prompt: { text: 'hello' },
    });

    const synthetic = mockInput.syntheticCalls;
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]?.sessionID).toBe('ses_append');
    expect(synthetic[0]?.id.startsWith('msg_prt_rules_')).toBe(true);
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
    expect(synthetic[0]?.delivery).toBe('steer');
  });

  it('skips injection without a messageID (no part owner)', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'sans_message_id',
      prompt: { text: 'hello' },
    } as never);

    expect(mockInput.syntheticCalls).toHaveLength(0);
  });

  it('deduplicates rules already injected on earlier messages', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    const prompt = mockInput.hooks.sessionPrompt[0]!;

    await prompt({
      sessionID: 'ses_dedup',
      messageID: 'msg_dedup_1',
      prompt: { text: 'first' },
    });
    expect(mockInput.syntheticCalls).toHaveLength(1);
    const delivered = mockInput.syntheticCalls[0];

    // Model the server: the delivered synthetic message is now in history.
    const mockInput2 = createMockPluginInput({
      testDir,
      history: [
        {
          id: delivered.id,
          type: 'synthetic',
          text: delivered.text,
          metadata: delivered.metadata,
        },
      ],
    });
    await wire(mockInput2);
    await mockInput2.hooks.sessionPrompt[0]!({
      sessionID: 'ses_dedup',
      messageID: 'msg_dedup_2',
      prompt: { text: 'second' },
    });
    expect(mockInput2.syntheticCalls).toHaveLength(0);
  });

  it('rehydrates current v2 tool paths during the first durable turn', async () => {
    const { testDir } = getTestDirs();
    const mockInput = createMockPluginInput({
      testDir,
      history: [
        {
          id: 'msg_a1',
          type: 'assistant',
          agent: 'build',
          model: { providerID: 'p', id: 'm' },
          content: [
            {
              type: 'tool',
              id: 'call_hist',
              name: 'edit',
              state: {
                status: 'completed',
                input: { filePath: 'src/restarted.ts' },
              },
            },
          ],
        },
      ],
    });
    await wire(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_current_restart',
      messageID: 'msg_current_restart',
      prompt: { text: 'continue' },
    });

    const snapshot = sessionStore.snapshot('ses_current_restart');
    expect(snapshot?.workingContextSeeded).toBe(true);
    expect(snapshot?.workingContextPaths.has('src/restarted.ts')).toBe(true);
  });

  it('restores supported tool paths from history without replaying matching', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    writeFileSync(
      path.join(globalRulesDir, 'tools-dir.md'),
      `---\nglobs:\n  - "src/tools/**"\n---\n\nTools directory guidance.`
    );

    const mockInput = createMockPluginInput({
      testDir,
      history: [
        {
          id: 'msg_a1',
          type: 'assistant',
          agent: 'build',
          model: { providerID: 'p', id: 'm' },
          content: [
            {
              type: 'tool',
              id: 'call_hist',
              name: 'write',
              state: {
                status: 'completed',
                input: { filePath: 'src/tools/index.ts', content: 'export;' },
              },
            },
          ],
        },
      ],
    });
    await wire(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_bash_restart',
      messageID: 'msg_bash_restart',
      prompt: { text: 'continue' },
    });

    const snapshot = sessionStore.snapshot('ses_bash_restart');
    expect(snapshot?.workingContextPaths.has('src/tools/index.ts')).toBe(true);
    const admittedText = mockInput.promptCalls.map(c => c.text).join('\n');
    expect(admittedText).not.toContain('Tools directory guidance');
  });

  it('keeps the original rule content after an in-process file edit', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'changing.md');
    writeFileSync(rulePath, 'Version one.');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    const prompt = mockInput.hooks.sessionPrompt[0]!;

    await prompt({
      sessionID: 'ses_change',
      messageID: 'msg_change_1',
      prompt: { text: 'first' },
    });
    expect(
      mockInput.syntheticCalls.some(part => part.text.includes('Version one.'))
    ).toBe(true);

    writeFileSync(rulePath, 'Version two.');
    clearRuleCache();
    await prompt({
      sessionID: 'ses_change',
      messageID: 'msg_change_2',
      prompt: { text: 'second' },
    });

    expect(
      mockInput.syntheticCalls.some(part => part.text.includes('Version two.'))
    ).toBe(false);
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

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    const ctx = mockInput.hooks.sessionContext[0]!;
    const prompt = mockInput.hooks.sessionPrompt[0]!;

    // Plan turn: durable keyword rule persists; plan rule stays ephemeral.
    await ctx({
      sessionID: 'ses_route',
      agent: 'plan',
      model: { id: 'm' },
      messages: [],
    });
    await prompt({
      sessionID: 'ses_route',
      messageID: 'msg_plan',
      prompt: { text: 'please plan the testing work' },
    });

    const planSynthetic = mockInput.syntheticCalls.map(c => c.text).join('\n');
    expect(planSynthetic).not.toContain('Plan-only');
    expect(planSynthetic).toContain('Testing guidance');

    // Build turn: the build rule delivers transiently on the dispatch and
    // the keyword rule dedupes; neither agent rule persists durably.
    await ctx({
      sessionID: 'ses_route',
      agent: 'build',
      model: { id: 'm' },
      messages: [],
    });
    await prompt({
      sessionID: 'ses_route',
      messageID: 'msg_build',
      prompt: { text: 'implement it' },
    });
    const buildSynthetic = mockInput.syntheticCalls.map(c => c.text).join('\n');
    expect(buildSynthetic).not.toContain('Build-only guidance.');
    expect(buildSynthetic).not.toContain('Plan-only guidance.');
  });

  it('persists keyword rules once across turns', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'testing.mdc'),
      `---\nkeywords: [testing]\n---\n\nTesting guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    const prompt = mockInput.hooks.sessionPrompt[0]!;

    await prompt({
      sessionID: 'ses_kw',
      messageID: 'msg_kw_1',
      prompt: { text: 'add testing here' },
    });
    expect(mockInput.syntheticCalls).toHaveLength(1);

    await prompt({
      sessionID: 'ses_kw',
      messageID: 'msg_kw_2',
      prompt: { text: 'still testing' },
    });
    expect(mockInput.syntheticCalls).toHaveLength(1);
  });

  it('still flushes queued durable hooks for text-less prompt events', async () => {
    clearRuleCache();
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'hooky.mdc'),
      `---\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "grep"\n---\n\nHook rule body.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);

    // PostToolUse hook queues the rule content for the durable turn.
    await mockInput.hooks.toolAfter[0]!({
      tool: 'bash',
      sessionID: 'ses_textless',
      id: 'call_1',
      input: { command: 'grep foo' },
      status: 'completed',
      result: { content: '' },
    });
    expect(mockInput.syntheticCalls).toHaveLength(0);

    // The durable turn flushes queued hook content even without a prompt
    // text? v2: the prompt hook requires prompt.text; hook content rides
    // the next prompt turn instead (queue routing unchanged).
    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_textless',
      messageID: 'msg_textless_1',
      prompt: { text: 'continue' },
    });

    const durableParts = mockInput.syntheticCalls.filter(c =>
      c.id.startsWith('msg_prt_rules_')
    );
    expect(durableParts).toHaveLength(1);
    expect(durableParts[0]?.text).toContain('Hook rule body.');
  });

  it('still delivers queued transient Hook content when rule evaluation fails', async () => {
    clearRuleCache();
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'hooky.mdc'),
      `---\nagent: [plan]\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "grep"\n---\n\nHook rule body.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    let failToolQuery = false;
    // v2 has no tool.ids RPC; break the MCP query instead to force a
    // match-context failure during evaluation.
    if (mockInput.context.mcp) {
      mockInput.context.mcp.list = () => {
        if (failToolQuery) throw new Error('mcp list unavailable');
        return Promise.resolve({ data: [] });
      };
    }
    await wire(mockInput);

    const ctx = mockInput.hooks.sessionContext[0]!;
    await ctx({
      sessionID: 'ses_eval_fail',
      agent: 'plan',
      messages: [
        {
          id: 'msg_u1',
          role: 'user',
          content: [{ type: 'text', text: 'prompt' }],
        },
      ],
    });

    await mockInput.hooks.toolAfter[0]!({
      tool: 'bash',
      sessionID: 'ses_eval_fail',
      id: 'call_1',
      input: { command: 'grep foo' },
      status: 'completed',
      result: { content: '' },
    });

    // Only now does rule evaluation fail: the context-time query throws,
    // but queued transient Hook content must still be delivered.
    failToolQuery = true;
    const messages = [
      {
        id: 'msg_eval_fail',
        role: 'user',
        content: [{ type: 'text', text: 'prompt' }],
      },
    ];
    await ctx({ sessionID: 'ses_eval_fail', messages });

    expect(messages).toHaveLength(2);
    // The v2 context append carries the transient delivery as a user
    // message: its id is the ephemeral message id, not a part id.
    const appended = messages[1] as {
      id?: string;
      content: Array<{ text?: string }>;
    };
    expect(appended.id).toMatch(/^msg_rule_ephemeral_/);
    expect(appended.content[0]?.text).toContain('Hook rule body.');
  });

  it('writes matched-rules-state with matched rule paths', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'always-apply.md');
    writeFileSync(rulePath, '# Always Apply\nThis rule always applies.');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses-state-match',
      messageID: 'msg_state_match_1',
      prompt: { text: 'hello' },
    });

    await vi.waitFor(async () => {
      const state = await readMatchedRulesState('ses-state-match', {
        stateDir,
      });
      expect(state?.sessionID).toBe('ses-state-match');
      expect(state?.matchedRulePaths).toEqual([rulePath]);
    });
  });

  it('deduplicates against history fetched from the client on first message', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'persisted.md'),
      'Persisted rule body.'
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const durablePart = buildDurableDeliveryPart(
      [
        {
          relativePath: 'persisted.md',
          content: 'Persisted rule body.',
        },
      ],
      [],
      { sessionID: 'ses_restart', messageID: 'msg_1' }
    );
    const mockInput = createMockPluginInput({
      testDir,
      history: [
        {
          id: durablePart.id,
          type: 'synthetic',
          text: durablePart.text,
          metadata: durablePart.metadata,
        },
      ],
    });
    await wire(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_restart',
      messageID: 'msg_restart_1',
      prompt: { text: 'post-restart message' },
    });

    expect(mockInput.syntheticCalls).toHaveLength(0);
  });

  it('does not project matched rules when the durable delivery is rejected', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    if (mockInput.context.session) {
      mockInput.context.session.context = async () => {
        throw new Error('server down');
      };
    }
    await wire(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_fetchfail',
      messageID: 'msg_fetchfail_1',
      prompt: { text: 'hello' },
    });

    expect(mockInput.syntheticCalls).toHaveLength(0);
    expect(
      await readMatchedRulesState('ses_fetchfail', { stateDir })
    ).toBeNull();
  });

  it('invokes session.context and session.prompt with bound receivers', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'always.md'), '# Always Apply');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    // Simulate the real SDK: prototype-style methods reading instance state
    // via `this` (arrow functions would mask the detachment bug). The whole
    // session object is replaced, mirroring how the plugin context exposes
    // SDK session namespaces; the hook recorder is carried over so the
    // runtime's registrations stay observable.
    const syntheticCalls: Array<Record<string, unknown>> = [];
    const hookRecorder = mockInput.context.session.hook;
    const sessionApi = {
      _client: { ready: true },
      hook: hookRecorder,
      async context(this: { _client?: { ready: boolean } }, _args?: unknown) {
        if (!this || !this._client) {
          throw new TypeError(
            "undefined is not an object (evaluating 'this._client')"
          );
        }
        return { data: [] };
      },
      async synthetic(input: Record<string, unknown>) {
        syntheticCalls.push(input);
        return { id: input.id };
      },
    };
    mockInput.context.session = sessionApi as never;
    await wire(mockInput);

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_receiver',
      messageID: 'msg_receiver_1',
      prompt: { text: 'hello' },
    });

    expect(syntheticCalls).toHaveLength(1);
  });

  it('does not persist hook text owned by an ephemeral rule', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'plan-hook.mdc'),
      `---\nagent: [plan]\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "eslint"\n---\n\nPlan hook guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    const ctx = mockInput.hooks.sessionContext[0]!;
    const prompt = mockInput.hooks.sessionPrompt[0]!;
    const after = mockInput.hooks.toolAfter[0]!;

    await ctx({
      sessionID: 'ses_hook_eph',
      agent: 'plan',
      messages: [],
    });
    await prompt({
      sessionID: 'ses_hook_eph',
      messageID: 'msg_hook_user',
      prompt: { text: 'work on linting' },
    });
    await after({
      tool: 'bash',
      sessionID: 'ses_hook_eph',
      id: 'call_1',
      input: { command: 'npx eslint src/' },
      status: 'completed',
      result: { content: '' },
    });

    const dispatch = [
      {
        id: 'msg_after_tool',
        role: 'assistant',
        content: [{ type: 'text', text: 'tool completed' }],
      },
    ];
    await ctx({ sessionID: 'ses_hook_eph', messages: dispatch });
    const transientText = dispatch
      .slice(1)
      .flatMap(message => message.content as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(transientText).toContain('Plan hook guidance.');

    // A later durable turn must not persist the ephemeral hook text.
    await prompt({
      sessionID: 'ses_hook_eph',
      messageID: 'msg_hook_next',
      prompt: { text: 'continue' },
    });
    expect(
      mockInput.syntheticCalls.some(part => part.text.includes('Plan hook'))
    ).toBe(false);
  });

  it('keeps a mixed any hook durable when a durable condition matches', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'mixed-hook.mdc'),
      `---\nglobs:\n  - "src/**/*.ts"\nagent: [plan]\nmatch: any\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "eslint"\n---\n\nMixed hook guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    const ctx = mockInput.hooks.sessionContext[0]!;
    const after = mockInput.hooks.toolAfter[0]!;

    await ctx({
      sessionID: 'ses_hook_mixed',
      agent: 'plan',
      messages: [],
    });
    await after({
      tool: 'read',
      sessionID: 'ses_hook_mixed',
      id: 'call_read_1',
      input: { filePath: 'src/index.ts' },
      status: 'completed',
      result: { content: 'const x = 1;' },
    });
    await after({
      tool: 'bash',
      sessionID: 'ses_hook_mixed',
      id: 'call_1',
      input: { command: 'npx eslint src/' },
      status: 'completed',
      result: { content: '' },
    });

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_hook_mixed',
      messageID: 'msg_hook_mixed_1',
      prompt: { text: 'continue' },
    });
    expect(
      mockInput.syntheticCalls.some(
        part =>
          part.id.startsWith('msg_prt_rules_') &&
          part.text.includes('Mixed hook guidance.')
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

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    const prompt = mockInput.hooks.sessionPrompt[0]!;
    const after = mockInput.hooks.toolAfter[0]!;

    await prompt({
      sessionID: 'ses_hook_edit',
      messageID: 'msg_he_1',
      prompt: { text: 'first' },
    });
    expect(
      mockInput.syntheticCalls.some(part => part.text.includes('Version one.'))
    ).toBe(true);

    writeFileSync(
      rulePath,
      `---\nhooks:\n  - type: PostToolUse\n    tool: bash\n    match: "eslint"\n---\n\nVersion two.`
    );
    clearRuleCache();
    await after({
      tool: 'bash',
      sessionID: 'ses_hook_edit',
      id: 'call_1',
      input: { command: 'npx eslint src/' },
      status: 'completed',
      result: { content: '' },
    });

    await prompt({
      sessionID: 'ses_hook_edit',
      messageID: 'msg_he_2',
      prompt: { text: 'second' },
    });
    const hookPart = mockInput.syntheticCalls.find(part =>
      part.text.includes('Version one.')
    );
    expect(hookPart?.text).toContain('Version one.');
    expect(hookPart?.text).not.toContain('Version two.');
  });

  it('writes ephemeral matches to matched state without persisting their parts', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'plan-only.mdc');
    writeFileSync(rulePath, `---\nagent: [plan]\n---\n\nPlan guidance.`);
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    await mockInput.hooks.sessionContext[0]!({
      sessionID: 'ses_matched_eph',
      agent: 'plan',
      messages: [],
    });
    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_matched_eph',
      messageID: 'msg_matched_eph',
      prompt: { text: 'plan this' },
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    const state = await readMatchedRulesState('ses_matched_eph', { stateDir });
    expect(state?.matchedRulePaths).toEqual([rulePath]);
    expect(mockInput.syntheticCalls).toHaveLength(0);
  });
});
