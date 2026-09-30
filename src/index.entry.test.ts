/**
 * Plugin entry option wiring: `additionalRuleDirectories` read from the v2
 * context `options` and forwarded into discovery.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import openCodeRulesPlugin from './index.js';
import { createRuntime } from './runtime/create-runtime.js';
import { clearRuleCache } from './rules/rule-discovery.js';
import {
  createMockPluginInput,
  getTestDirs,
  restoreEnv,
  saveEnv,
  setupTestDirs,
  teardownTestDirs,
  type EnvSnapshot,
} from './test-fixtures.js';

let envSnapshot: EnvSnapshot;
let testDir: string;
let projectDir: string;

beforeEach(() => {
  testDir = setupTestDirs().testDir;
  projectDir = path.join(testDir, 'project');
  mkdirSync(projectDir, { recursive: true });
  envSnapshot = saveEnv('XDG_CONFIG_HOME', 'HOME', 'OPENCODE_CONFIG_DIR');
  delete process.env.OPENCODE_CONFIG_DIR;
  process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
  clearRuleCache();
});

afterEach(() => {
  teardownTestDirs();
  restoreEnv(envSnapshot);
  vi.resetAllMocks();
});

function makeRulesDir(...segments: string[]): string {
  const dir = path.join(testDir, ...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function promptOnce(
  mockInput: ReturnType<typeof createMockPluginInput>,
  sessionID: string
): Promise<void> {
  await mockInput.hooks.sessionPrompt[0]!({
    sessionID,
    messageID: 'msg_1',
    prompt: { text: 'hello' },
  });
}

describe('plugin entry additionalRuleDirectories option', () => {
  async function setupWithOptions(
    options?: Record<string, unknown>
  ): Promise<ReturnType<typeof createMockPluginInput>> {
    const mockInput = createMockPluginInput({
      testDir: projectDir,
      ...(options ? { options } : {}),
    });
    await openCodeRulesPlugin.setup(mockInput.context as never);
    return mockInput;
  }

  it('loads rules from an absolute directory listed in options', async () => {
    const extraDir = makeRulesDir('extra', 'abs');
    writeFileSync(path.join(extraDir, 'extra.md'), '# Extra Rule');

    const mockInput = await setupWithOptions({
      additionalRuleDirectories: [extraDir],
    });

    await promptOnce(mockInput, 'session-abs');

    expect(
      mockInput.syntheticCalls.some(call => call.text.includes('Extra Rule'))
    ).toBe(true);
  });

  it('resolves a relative entry against the project directory', async () => {
    const extraDir = path.join(projectDir, '.agents', 'rules');
    mkdirSync(extraDir, { recursive: true });
    writeFileSync(path.join(extraDir, 'relative.md'), '# Relative Rule');

    const mockInput = await setupWithOptions({
      additionalRuleDirectories: ['.agents/rules'],
    });

    await promptOnce(mockInput, 'session-relative');

    expect(
      mockInput.syntheticCalls.some(call => call.text.includes('Relative Rule'))
    ).toBe(true);
  });

  it('expands a leading ~ in an entry', async () => {
    const homeDir = makeRulesDir('home');
    process.env.HOME = homeDir;
    const extraDir = path.join(homeDir, 'shared-rules');
    mkdirSync(extraDir, { recursive: true });
    writeFileSync(path.join(extraDir, 'home.md'), '# Home Rule');

    const mockInput = await setupWithOptions({
      additionalRuleDirectories: '~/shared-rules',
    });

    await promptOnce(mockInput, 'session-home');

    expect(
      mockInput.syntheticCalls.some(call => call.text.includes('Home Rule'))
    ).toBe(true);
  });

  it('injects a rule reachable through two configured directories once', async () => {
    const extraDir = makeRulesDir('extra', 'dup');
    const nested = path.join(extraDir, 'nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, 'once.md'), '# Only Once');

    const mockInput = await setupWithOptions({
      additionalRuleDirectories: [extraDir, nested],
    });

    await promptOnce(mockInput, 'session-dup');

    const admissions = mockInput.syntheticCalls.filter(call =>
      call.text.includes('Only Once')
    );
    expect(admissions).toHaveLength(1);
  });

  it('still loads built-in rules when options are malformed', async () => {
    const { globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'builtin.md'), '# Builtin Rule');
    const hostile = {};
    Object.defineProperty(hostile, 'additionalRuleDirectories', {
      get() {
        throw new Error('boom');
      },
    });

    const mockInput = await setupWithOptions(hostile);

    await promptOnce(mockInput, 'session-malformed');

    expect(
      mockInput.syntheticCalls.some(call => call.text.includes('Builtin Rule'))
    ).toBe(true);
  });

  it('loads with no options at all', async () => {
    const { globalRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'builtin.md'), '# Builtin Rule');

    const mockInput = await setupWithOptions();

    await promptOnce(mockInput, 'session-none');

    expect(
      mockInput.syntheticCalls.some(call => call.text.includes('Builtin Rule'))
    ).toBe(true);
  });
});

describe('createRuntime additionalRuleDirectories forwarding', () => {
  async function wireAndPrompt(
    runtime: Awaited<ReturnType<typeof createRuntime>>,
    mockInput: ReturnType<typeof createMockPluginInput>,
    sessionID: string
  ): Promise<void> {
    await runtime.wire(mockInput.context as never);
    await promptOnce(mockInput, sessionID);
  }

  it('discovers additional directories when it runs discovery itself', async () => {
    const extraDir = path.join(testDir, 'extra');
    mkdirSync(extraDir, { recursive: true });
    writeFileSync(path.join(extraDir, 'forwarded.md'), '# Forwarded Rule');

    const mockInput = createMockPluginInput({ testDir: projectDir });
    const runtime = await createRuntime({
      client: mockInput.context,
      directory: projectDir,
      projectDirectory: projectDir,
      additionalRuleDirectories: [extraDir],
    });

    await wireAndPrompt(runtime, mockInput, 'session-forward');

    expect(
      mockInput.syntheticCalls.some(call =>
        call.text.includes('Forwarded Rule')
      )
    ).toBe(true);
  });

  it('ignores additional directories when ruleFiles are supplied', async () => {
    const extraDir = path.join(testDir, 'extra');
    mkdirSync(extraDir, { recursive: true });
    writeFileSync(path.join(extraDir, 'skipped.md'), '# Skipped Rule');
    const explicit = path.join(testDir, 'explicit.md');
    writeFileSync(explicit, '# Explicit Rule');

    const mockInput = createMockPluginInput({ testDir: projectDir });
    const runtime = await createRuntime({
      client: mockInput.context,
      directory: projectDir,
      projectDirectory: projectDir,
      additionalRuleDirectories: [extraDir],
      ruleFiles: [{ filePath: explicit, relativePath: 'explicit.md' }],
    });

    await wireAndPrompt(runtime, mockInput, 'session-explicit');

    const text = mockInput.syntheticCalls.map(call => call.text).join('\n');
    expect(text).toContain('Explicit Rule');
    expect(text).not.toContain('Skipped Rule');
  });
});
