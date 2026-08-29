/**
 * Observation-time rule admission and no-reply persistence tests.
 * Split from index.runtime.test.ts for maintainability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
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

describe('observation admission and noReply persistence', () => {
  let savedXDG: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedXDG = process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    teardownTestDirs();
    process.env.XDG_CONFIG_HOME = savedXDG;
  });

  it('does not replay historical observations into file matching', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'history-secret.mdc'),
      `---\nfileContains: "history-secret"\n---\n\nSecret guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    const promptCalls: Array<{
      body: { parts: Array<Record<string, unknown>> };
    }> = [];
    const sessionID = 'ses_no_history_replay';
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const hooks = await plugin(
      createMockPluginInput({
        testDir,
        history: [
          {
            info: { role: 'assistant', sessionID },
            parts: [
              {
                type: 'tool',
                tool: 'write',
                state: {
                  status: 'completed',
                  input: {
                    filePath: 'src/history.ts',
                    content: 'history-secret',
                  },
                  output: 'Wrote file successfully.',
                },
              },
            ],
          },
        ],
        sessionPrompt: async args => {
          promptCalls.push(args);
          return { data: {} };
        },
      }) as unknown as Parameters<typeof plugin>[0]
    );
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: Record<string, never>,
      output: { messages: Array<{ info?: unknown; parts?: unknown[] }> }
    ) => Promise<{ messages: Array<{ info?: unknown; parts?: unknown[] }> }>;
    const messages = [
      {
        info: { role: 'user', id: 'msg_history', sessionID },
        parts: [{ type: 'text', text: 'continue' }],
      },
    ];
    await transform({}, { messages });
    const chatOutput: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'continue' }],
    };
    await (hooks['chat.message'] as HookChatMessage)(
      { sessionID, messageID: 'msg_history' },
      chatOutput
    );

    expect(promptCalls).toHaveLength(0);
    expect(chatOutput.parts.some(part => part.synthetic)).toBe(false);

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
        tool: 'write',
        sessionID: 'ses_no_history_replay',
        callID: 'call_live',
        args: { filePath: 'src/live.ts', content: 'history-secret' },
      },
      { title: '', output: 'Wrote file successfully.', metadata: {} }
    );

    expect(promptCalls).toHaveLength(1);
  });

  it('persists a matched fileContains rule via awaited session.prompt noReply', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'rust-unsafe.mdc'),
      `---\nglobs:\n  - "**/*.rs"\nfileContains: "unsafe {"\n---\n\nRust unsafe guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const promptCalls: Array<{
      path: { id: string };
      body: { noReply?: boolean; parts: Array<Record<string, unknown>> };
    }> = [];
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({
      testDir,
      sessionPrompt: async args => {
        promptCalls.push(args);
        return { data: { info: { id: 'msg_admitted' } } };
      },
    });
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
        tool: 'write',
        sessionID: 'ses_admit_e2e',
        callID: 'call_admit_1',
        args: { filePath: 'src/lib.rs', content: 'fn f() { unsafe { } }' },
      },
      { title: '', output: 'Wrote file successfully.', metadata: {} }
    );

    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0]?.path.id).toBe('ses_admit_e2e');
    expect(promptCalls[0]?.body.noReply).toBe(true);
    const part = promptCalls[0]?.body.parts[0] ?? {};
    expect(part.synthetic).toBe(true);
    expect(part.metadata).toMatchObject({
      ruleKeys: [expect.any(String)],
      ruleAdmission: true,
    });
    expect(String(part.text)).toContain('Rust unsafe guidance.');
  });

  it('ignores its own admission message in chat.message', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'rust-unsafe.mdc'),
      `---\nglobs:\n  - "**/*.rs"\nfileContains: "unsafe {"\n---\n\nRust unsafe guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    let promptCount = 0;
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({
      testDir,
      sessionPrompt: async () => {
        promptCount++;
        return { data: {} };
      },
    });
    const hooks = await plugin(
      mockInput as unknown as Parameters<typeof plugin>[0]
    );

    const chatMessage = hooks['chat.message'] as HookChatMessage;
    const admissionPart = {
      id: 'prt_rules_abc_msg_admission',
      type: 'text',
      text: '<system-message>\n<rule name="rust-unsafe">guide</rule>\n</system-message>',
      synthetic: true,
      metadata: { ruleKeys: ['abc'], ruleAdmission: true },
    };
    const output: HookChatOutput = {
      message: { role: 'user' },
      parts: [admissionPart],
    };
    await chatMessage(
      { sessionID: 'ses_own_admit', messageID: 'msg_admission' },
      output
    );
    expect(promptCount).toBe(0);
  });

  it('falls back pending admission into the next transform and retries persistence', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'rust-unsafe.mdc'),
      `---\nglobs:\n  - "**/*.rs"\nfileContains: "unsafe {"\n---\n\nRust unsafe guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    let failPrompt = true;
    const promptCalls: Array<{
      body: { parts: Array<Record<string, unknown>> };
    }> = [];
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const mockInput = createMockPluginInput({
      testDir,
      sessionPrompt: async args => {
        promptCalls.push(args);
        if (failPrompt) throw new Error('server unavailable');
        return { data: {} };
      },
    });
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
        tool: 'write',
        sessionID: 'ses_fallback',
        callID: 'call_fb_1',
        args: { filePath: 'src/lib.rs', content: 'unsafe { }' },
      },
      { title: '', output: 'ok', metadata: {} }
    );
    expect(promptCalls).toHaveLength(1);

    // Next transform dispatch carries the pending admission transiently and
    // retries persistence on a later dispatch.
    const transform = hooks['experimental.chat.messages.transform'] as (
      input: Record<string, never>,
      output: { messages: Array<{ info?: unknown; parts?: unknown[] }> }
    ) => Promise<{ messages: Array<{ info?: unknown; parts?: unknown[] }> }>;
    const messages = [
      {
        info: { role: 'user', id: 'msg_fb_real', sessionID: 'ses_fallback' },
        parts: [{ type: 'text', text: 'continue' }],
      },
    ];
    const transformed = await transform({}, { messages });
    const fallbackText = transformed.messages
      .slice(1)
      .flatMap(message => message.parts)
      .map((part): string => String((part as { text?: string }).text ?? ''))
      .join('\n');
    expect(fallbackText).toContain('Rust unsafe guidance.');

    failPrompt = false;
    await transform({}, { messages: [...messages] });
    expect(promptCalls).toHaveLength(3);
  });

  it('refreshes matched-rules sidebar state after successful admission', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'rust-unsafe.mdc'),
      `---\nglobs:\n  - "**/*.rs"\nfileContains: "unsafe {"\n---\n\nRust unsafe guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const store = new MatchedRulesStateStore({
      stateDir: path.join(testDir, 'matched-state'),
    });
    const mockInput = createMockPluginInput({
      testDir,
      sessionPrompt: async () => ({ data: {} }),
    });
    const hooks = await createHooksWithStore(mockInput, store);

    await (
      hooks['tool.execute.after'] as (
        input: {
          tool: string;
          sessionID: string;
          callID: string;
          args: Record<string, unknown>;
        },
        output: { title: string; output: string; metadata: unknown }
      ) => Promise<void>
    )(
      {
        tool: 'write',
        sessionID: 'ses_sidebar',
        callID: 'call_sb_1',
        args: { filePath: 'src/lib.rs', content: 'unsafe { }' },
      },
      { title: '', output: 'ok', metadata: {} }
    );

    await vi.waitFor(async () => {
      const snapshot = await readMatchedRulesState('ses_sidebar', {
        stateDir: path.join(testDir, 'matched-state'),
      });
      expect(snapshot?.matchedRulePaths).toContainEqual(
        expect.stringContaining('rust-unsafe.mdc')
      );
    });
  });

  it('admits a globs-only durable rule at observation time', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'typescript.mdc'),
      `---\nglobs:\n  - "**/*.ts"\n---\n\nTypeScript guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    const promptCalls: Array<{
      body: { noReply?: boolean; parts: Array<Record<string, unknown>> };
    }> = [];
    const {
      default: { server: plugin },
    } = await import('./index.js');
    const hooks = await plugin(
      createMockPluginInput({
        testDir,
        sessionPrompt: async args => {
          promptCalls.push(args);
          return { data: {} };
        },
      }) as unknown as Parameters<typeof plugin>[0]
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
        tool: 'read',
        sessionID: 'ses_glob_admit',
        callID: 'call_glob_admit',
        args: { filePath: 'src/a.ts' },
      },
      {
        title: 'src/a.ts',
        output: '<content>1: export const value = 1;</content>',
        metadata: {},
      }
    );

    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0]?.body.noReply).toBe(true);
    expect(promptCalls[0]?.body.parts[0]?.metadata).toMatchObject({
      ruleAdmission: true,
    });
  });

  it('merges admission state with previously matched rules', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    const alwaysRulePath = path.join(globalRulesDir, 'always.md');
    const fileRulePath = path.join(globalRulesDir, 'file.mdc');
    writeFileSync(alwaysRulePath, 'Always guidance.');
    writeFileSync(
      fileRulePath,
      `---\nfileContains: "admit-me"\n---\n\nFile guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    const stateDir = path.join(testDir, 'matched-state');
    const store = new MatchedRulesStateStore({ stateDir });
    const mockInput = createMockPluginInput({
      testDir,
      sessionPrompt: async () => ({ data: {} }),
    });
    const hooks = await createHooksWithStore(mockInput, store);
    const sessionID = 'ses_state_merge';
    const chatOutput: HookChatOutput = {
      message: { role: 'user' },
      parts: [{ type: 'text', text: 'start' }],
    };
    await (hooks['chat.message'] as HookChatMessage)(
      { sessionID, messageID: 'msg_state_merge' },
      chatOutput
    );
    await (
      hooks['tool.execute.after'] as (
        input: {
          tool: string;
          sessionID: string;
          callID: string;
          args: Record<string, unknown>;
        },
        output: { title: string; output: string; metadata: unknown }
      ) => Promise<void>
    )(
      {
        tool: 'write',
        sessionID,
        callID: 'call_state_merge',
        args: { filePath: 'src/a.ts', content: 'admit-me' },
      },
      { title: '', output: 'Wrote file successfully.', metadata: {} }
    );
    const state = await readMatchedRulesState(sessionID, { stateDir });

    expect(state?.matchedRulePaths).toEqual(
      expect.arrayContaining([alwaysRulePath, fileRulePath])
    );
    expect(state?.matchedRulePaths).toHaveLength(2);
  });
});
