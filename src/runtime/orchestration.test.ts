/**
 * Observation-time rule admission and awaited session.prompt (resume:false)
 * persistence tests.
 * Split from index.runtime.test.ts for maintainability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
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

describe('observation admission and noReply persistence', () => {
  let savedXDG: string | undefined;
  let stateDir: string;
  let matchedRulesStateStore: MatchedRulesStateStore;

  beforeEach(() => {
    setupTestDirs();
    savedXDG = process.env.XDG_CONFIG_HOME;
    const { testDir } = getTestDirs();
    stateDir = path.join(testDir, 'matched-state');
    matchedRulesStateStore = new MatchedRulesStateStore({ stateDir });
  });

  afterEach(() => {
    teardownTestDirs();
    process.env.XDG_CONFIG_HOME = savedXDG;
  });

  async function wire(
    mockInput: ReturnType<typeof createMockPluginInput>,
    store?: MatchedRulesStateStore
  ) {
    const runtime = await createRuntime({
      client: mockInput.context,
      directory: mockInput.context.location.directory,
      projectDirectory: mockInput.context.location.directory,
      ...(store !== undefined ? { matchedRulesStateStore: store } : {}),
    });
    await runtime.wire(mockInput.context as never);
    return mockInput;
  }

  it('does not replay historical observations into file matching', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'history-secret.mdc'),
      `---\nfileContains: "history-secret"\n---\n\nSecret guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    const sessionID = 'ses_no_history_replay';
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
                input: {
                  filePath: 'src/history.ts',
                  content: 'history-secret',
                },
              },
            },
          ],
        },
      ],
    });
    await wire(mockInput);

    // Real opencode order: the context hook seeds the working context from
    // history before the prompt and after-hook events. The historical write
    // never feeds the File observation store, so nothing admits yet.
    await mockInput.hooks.sessionContext[0]!({
      sessionID,
      messages: [
        {
          id: 'msg_u1',
          role: 'user',
          content: [{ type: 'text', text: 'continue' }],
        },
      ],
    });
    await mockInput.hooks.sessionPrompt[0]!({
      sessionID,
      messageID: 'msg_history',
      prompt: { text: 'continue' },
    });
    expect(mockInput.promptCalls).toHaveLength(0);
    expect(mockInput.syntheticCalls).toHaveLength(0);

    // The live write's fresh observation admits the rule.
    await mockInput.hooks.toolAfter[0]!({
      tool: 'write',
      sessionID,
      id: 'call_live',
      input: { filePath: 'src/live.ts', content: 'history-secret' },
      status: 'completed',
      result: { content: 'Wrote file successfully.' },
    });
    expect(mockInput.promptCalls).toHaveLength(1);
  });

  it('persists a matched fileContains rule via awaited session.prompt resume:false', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'rust-unsafe.mdc'),
      `---\nglobs:\n  - "**/*.rs"\nfileContains: "unsafe {"\n---\n\nRust unsafe guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);

    await mockInput.hooks.toolAfter[0]!({
      tool: 'write',
      sessionID: 'ses_admit_e2e',
      id: 'call_admit_1',
      input: { filePath: 'src/lib.rs', content: 'fn f() { unsafe { } }' },
      status: 'completed',
      result: { content: 'Wrote file successfully.' },
    });

    expect(mockInput.promptCalls).toHaveLength(1);
    expect(mockInput.promptCalls[0]?.sessionID).toBe('ses_admit_e2e');
    expect(mockInput.promptCalls[0]?.resume).toBe(false);
    expect(mockInput.promptCalls[0]?.metadata).toMatchObject({
      ruleKeys: [expect.any(String)],
      ruleAdmission: true,
    });
    expect(String(mockInput.promptCalls[0]?.text)).toContain(
      'Rust unsafe guidance.'
    );
  });

  it('ignores its own admission prompt text in the prompt hook', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'rust-unsafe.mdc'),
      `---\nglobs:\n  - "**/*.rs"\nfileContains: "unsafe {"\n---\n\nRust unsafe guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);

    // The admission prompt itself arrives at the prompt hook; it must be
    // treated as our own part, not a user turn.
    await mockInput.hooks.sessionPrompt[0]!({
      sessionID: 'ses_own_admit',
      messageID: 'msg_admission',
      prompt: {
        text: '<system-message>\n<rule name="rust-unsafe">guide</rule>\n</system-message>',
      },
    });
    expect(mockInput.promptCalls).toHaveLength(0);
    expect(mockInput.syntheticCalls).toHaveLength(0);
  });

  it('falls back pending admission into the next dispatch and retries persistence', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'rust-unsafe.mdc'),
      `---\nglobs:\n  - "**/*.rs"\nfileContains: "unsafe {"\n---\n\nRust unsafe guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    let failPrompt = true;
    if (mockInput.context.session?.prompt) {
      const inner = mockInput.context.session.prompt;
      mockInput.context.session.prompt = async input => {
        if (failPrompt) {
          mockInput.promptCalls.push(input);
          throw new Error('server unavailable');
        }
        return inner(input);
      };
    }
    await wire(mockInput);

    await mockInput.hooks.toolAfter[0]!({
      tool: 'write',
      sessionID: 'ses_fallback',
      id: 'call_fb_1',
      input: { filePath: 'src/lib.rs', content: 'unsafe { }' },
      status: 'completed',
      result: { content: 'ok' },
    });
    // Attempt 1 fired from the after-hook and failed (recorded by the
    // wrapper), leaving the admission pending.
    expect(mockInput.promptCalls).toHaveLength(1);

    // Next dispatch carries the pending admission transiently and retries
    // persistence on a later dispatch.
    const ctx = mockInput.hooks.sessionContext[0]!;
    const messages = [
      {
        id: 'msg_fb_real',
        role: 'user',
        content: [{ type: 'text', text: 'continue' }],
      },
    ];
    await ctx({ sessionID: 'ses_fallback', messages });
    const fallbackText = messages
      .slice(1)
      .flatMap(message => message.content as Array<{ text?: string }>)
      .map(part => part.text ?? '')
      .join('\n');
    expect(fallbackText).toContain('Rust unsafe guidance.');

    failPrompt = false;
    await ctx({
      sessionID: 'ses_fallback',
      messages: [...messages],
    });
    // Attempt 1 (after-hook) + attempt 2 (first dispatch retry, still
    // failing) + attempt 3 (second dispatch retry, succeeding).
    expect(mockInput.promptCalls).toHaveLength(3);
  });

  it('refreshes matched-rules sidebar state after successful admission', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'rust-unsafe.mdc'),
      `---\nglobs:\n  - "**/*.rs"\nfileContains: "unsafe {"\n---\n\nRust unsafe guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput, matchedRulesStateStore);

    await mockInput.hooks.toolAfter[0]!({
      tool: 'write',
      sessionID: 'ses_sidebar',
      id: 'call_sb_1',
      input: { filePath: 'src/lib.rs', content: 'unsafe { }' },
      status: 'completed',
      result: { content: 'ok' },
    });

    await vi.waitFor(async () => {
      const snapshot = await readMatchedRulesState('ses_sidebar', {
        stateDir,
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
    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput);
    const after = mockInput.hooks.toolAfter[0]!;

    await after({
      tool: 'read',
      sessionID: 'ses_glob_admit',
      id: 'call_glob_admit',
      input: { filePath: 'src/a.ts' },
      status: 'completed',
      result: {
        content: '<content>1: export const value = 1;</content>',
      },
    });

    expect(mockInput.promptCalls).toHaveLength(1);
    expect(mockInput.promptCalls[0]?.resume).toBe(false);
    expect(mockInput.promptCalls[0]?.metadata).toMatchObject({
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
    const mockInput = createMockPluginInput({ testDir });
    await wire(mockInput, matchedRulesStateStore);
    const sessionID = 'ses_state_merge';

    await mockInput.hooks.sessionPrompt[0]!({
      sessionID,
      messageID: 'msg_state_merge',
      prompt: { text: 'start' },
    });
    await mockInput.hooks.toolAfter[0]!({
      tool: 'write',
      sessionID,
      id: 'call_state_merge',
      input: { filePath: 'src/a.ts', content: 'admit-me' },
      status: 'completed',
      result: { content: 'Wrote file successfully.' },
    });
    const state = await readMatchedRulesState(sessionID, { stateDir });

    expect(state?.matchedRulePaths).toEqual(
      expect.arrayContaining([alwaysRulePath, fileRulePath])
    );
    expect(state?.matchedRulePaths).toHaveLength(2);
  });
});
