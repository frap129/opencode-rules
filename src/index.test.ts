import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import pluginModule, { __testOnly } from './index.js';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  saveEnv,
  restoreEnv,
  type EnvSnapshot,
} from './test-fixtures.js';
import type { V2PluginContext } from './v2-types.js';
import { _setStateDirForTesting } from './active-rules-state.js';

describe('OpenCode Rules v2 plugin entrypoint', () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    setupTestDirs();
    envSnapshot = saveEnv('XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR');
    _setStateDirForTesting(path.join(getTestDirs().testDir, 'state'));
    __testOnly.resetSessionState();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    _setStateDirForTesting(null);
    teardownTestDirs();
    __testOnly.resetSessionState();
    vi.restoreAllMocks();
  });

  it('exports a Plugin.define result with id and setup', () => {
    expect(pluginModule.id).toBe('opencode-rules');
    expect(typeof pluginModule.setup).toBe('function');
  });

  it('registers session and tool hooks during setup', async () => {
    const registrations = vi.fn(async () => ({
      dispose: vi.fn(async () => {}),
    }));
    const sessionHook = vi.fn(registrations);
    const toolHook = vi.fn(registrations);
    const ctx = {
      session: { get: vi.fn(async () => undefined), hook: sessionHook },
      tool: { hook: toolHook },
    } as unknown as V2PluginContext;

    await pluginModule.setup(ctx);

    expect(sessionHook).toHaveBeenCalledTimes(1);
    expect(toolHook).toHaveBeenCalledTimes(2);
  });

  it('returns a cleanup that disposes registrations', async () => {
    const dispose = vi.fn(async () => {});
    const ctx = {
      session: {
        get: vi.fn(async () => undefined),
        hook: vi.fn(async () => ({ dispose })),
      },
      tool: { hook: vi.fn(async () => ({ dispose })) },
    } as unknown as V2PluginContext;

    const cleanup = await pluginModule.setup(ctx);
    expect(typeof cleanup).toBe('function');
    await (cleanup as () => Promise<void>)();
    expect(dispose).toHaveBeenCalledTimes(3);
  });

  it('setup never rejects when hook registration throws', async () => {
    const ctx = {
      session: {
        get: vi.fn(async () => undefined),
        hook: vi.fn(async () => {
          throw new Error('registration failure');
        }),
      },
      tool: {
        hook: vi.fn(async () => {
          throw new Error('registration failure');
        }),
      },
    } as unknown as V2PluginContext;

    // registerHooks logs the failure and still returns its (empty) cleanup fn
    await expect(pluginModule.setup(ctx)).resolves.toBeTypeOf('function');
  });

  it('setup resolves to a cleanup function when the global rules dir is missing', async () => {
    const ctx = {
      session: {
        get: vi.fn(async () => undefined),
        hook: vi.fn(async () => ({ dispose: vi.fn() })),
      },
      tool: { hook: vi.fn(async () => ({ dispose: vi.fn() })) },
    } as unknown as V2PluginContext;
    process.env.XDG_CONFIG_HOME = '/definitely/not/a/real/dir';

    await expect(pluginModule.setup(ctx)).resolves.toBeTypeOf('function');
  });

  it('injects a keyword-conditional rule end-to-end through the registered context hook', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
    delete process.env.OPENCODE_CONFIG_DIR;
    writeFileSync(
      path.join(globalRulesDir, 'keyword.md'),
      ['---', 'keywords:', '  - refactoring', '---', '# Refactor rule'].join(
        '\n'
      )
    );
    let capturedContext:
      | ((input: import('./v2-types.js').V2SessionContext) => Promise<void>)
      | undefined;
    const ctx = {
      session: {
        get: vi.fn(async () => ({ location: { directory: testDir } })),
        hook: vi.fn(
          async (
            _name: 'context',
            cb: (
              input: import('./v2-types.js').V2SessionContext
            ) => Promise<void>
          ) => {
            capturedContext = cb;
            return { dispose: vi.fn(async () => {}) };
          }
        ),
      },
      tool: { hook: vi.fn(async () => ({ dispose: vi.fn(async () => {}) })) },
    } as unknown as V2PluginContext;

    await pluginModule.setup(ctx);

    const payload = {
      sessionID: 'pipeline-session',
      agent: 'build',
      model: { id: 'gpt-5.3-codex', providerID: 'openai' },
      system: [],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'please help refactoring this code' },
          ],
        },
      ],
      tools: {},
    };
    await capturedContext!(payload);

    expect(payload.system).toHaveLength(1);
    expect(payload.system[0].text).toContain('Refactor rule');
  });
});
