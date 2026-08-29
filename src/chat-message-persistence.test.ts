/**
 * chat.message durable rule persistence tests.
 * Split from index.runtime.test.ts for maintainability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  createHooksWithStore,
  createMockPluginInput,
  getTestDirs,
  setupTestDirs,
  teardownTestDirs,
  type HookChatMessage,
  type HookChatOutput,
} from './test-fixtures.js';
import {
  MatchedRulesStateStore,
  readMatchedRulesState,
} from './matched-rules-state.js';
import { buildDurableDeliveryPart } from './rule-delivery-codec.js';
import { clearRuleCache } from './utils.js';
import { __testOnly } from './index.js';

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
    return createHooksWithStore(
      createMockPluginInput({ testDir }),
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;

    const output: HookChatOutput = {
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;

    const output: HookChatOutput = {
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
      output: HookChatOutput
    ) => Promise<void>;

    const output: HookChatOutput = {
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
      output: HookChatOutput
    ) => Promise<void>;

    const output: HookChatOutput = {
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
    const persisted: HookChatOutput['parts'] = [];
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;

    const first: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'first' }],
    };
    await chatMessage(
      { sessionID: 'ses_dedup', messageID: 'msg_dedup_1' },
      first
    );
    expect(first.parts.filter(p => p.synthetic)).toHaveLength(1);
    persisted.push(...first.parts.filter(p => p.synthetic));

    const second: HookChatOutput = {
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

    const chatMessage = hooks['chat.message'] as HookChatMessage;
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
    expect(snapshot?.workingContextPaths.has('src/restarted.ts')).toBe(true);
  });

  it('restores supported tool paths from history without replaying matching', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    writeFileSync(
      path.join(globalRulesDir, 'tools-dir.md'),
      `---\nglobs:\n  - "src/tools/**"\n---\n\nTools directory guidance.`
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
              tool: 'write',
              state: {
                status: 'completed',
                input: { filePath: 'src/tools/index.ts', content: 'export;' },
              },
            },
          ],
        },
      ],
    });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'continue' }],
    };
    await chatMessage(
      { sessionID: 'ses_bash_restart', messageID: 'msg_bash_restart' },
      output
    );

    const snapshot = __testOnly.getSessionStateSnapshot('ses_bash_restart');
    expect(snapshot?.workingContextPaths.has('src/tools/index.ts')).toBe(true);
    const syntheticText = output.parts
      .filter(p => p.synthetic)
      .map(p => p.text ?? '')
      .join('\n');
    expect(syntheticText).not.toContain('Tools directory guidance');
  });

  it('keeps the original rule content after an in-process file edit', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'changing.md');
    writeFileSync(rulePath, 'Version one.');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const hooks = await getHooks(testDir);
    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const first: HookChatOutput = {
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
    const second: HookChatOutput = {
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: unknown,
      output: { messages: Array<Record<string, unknown>> }
    ) => Promise<void>;

    const planOutput: HookChatOutput = {
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

    const buildOutput: HookChatOutput = {
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
    const persisted: HookChatOutput['parts'] = [];
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;

    const first: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'add testing here' }],
    };
    await chatMessage({ sessionID: 'ses_kw', messageID: 'msg_kw_1' }, first);
    expect(first.parts.filter(p => p.synthetic)).toHaveLength(1);
    persisted.push(...first.parts.filter(p => p.synthetic));

    const second: HookChatOutput = {
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

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;
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

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
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
    const hooks = await createHooksWithStore(mockInput, matchedRulesStateStore);

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;

    const output: HookChatOutput = {
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;
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
      s.lastAgentType = 'plan';
    });

    await after(
      {
        tool: 'read',
        sessionID: 'ses_hook_mixed',
        callID: 'call_read_1',
        args: { filePath: 'src/index.ts' },
      },
      { title: '', output: 'const x = 1;', metadata: {} }
    );
    await after(
      {
        tool: 'bash',
        sessionID: 'ses_hook_mixed',
        callID: 'call_1',
        args: { command: 'npx eslint src/' },
      },
      { title: '', output: '', metadata: {} }
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const output: HookChatOutput = {
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;

    const first: HookChatOutput = {
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

    const second: HookChatOutput = {
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
    const chatMessage = hooks['chat.message'] as HookChatMessage;
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
