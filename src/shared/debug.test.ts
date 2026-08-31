import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';

async function loadDebugModule(enabled: boolean) {
  vi.resetModules();
  if (enabled) {
    process.env.OPENCODE_RULES_DEBUG = '1';
  } else {
    delete process.env.OPENCODE_RULES_DEBUG;
  }
  return import('./debug.js');
}

describe('debug output', () => {
  let debugSpy: MockInstance;
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENCODE_RULES_DEBUG;
  });

  it('logs when OPENCODE_RULES_DEBUG is set', async () => {
    const { createDebugLog } = await loadDebugModule(true);
    const log = createDebugLog();
    log('test message');
    expect(debugSpy).toHaveBeenCalledWith('[opencode-rules] test message');
  });

  it('does not log when OPENCODE_RULES_DEBUG is unset', async () => {
    const { createDebugLog } = await loadDebugModule(false);
    const log = createDebugLog();
    log('test message');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('uses custom prefix', async () => {
    const { createDebugLog } = await loadDebugModule(true);
    const log = createDebugLog('[custom]');
    log('hello');
    expect(debugSpy).toHaveBeenCalledWith('[custom] hello');
  });

  it('does not use console.warn for debug messages', async () => {
    const { createDebugLog } = await loadDebugModule(true);
    const log = createDebugLog();
    log('debug only message');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs warnings when OPENCODE_RULES_DEBUG is set', async () => {
    const { logWarning } = await loadDebugModule(true);
    logWarning('A warning', new Error('warning details'));
    expect(warnSpy).toHaveBeenCalledWith(
      '[opencode-rules] Warning: A warning: warning details'
    );
  });

  it('suppresses warnings when OPENCODE_RULES_DEBUG is unset', async () => {
    const { logWarning } = await loadDebugModule(false);
    logWarning('A warning', new Error('warning details'));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs errors when OPENCODE_RULES_DEBUG is set', async () => {
    const { logError } = await loadDebugModule(true);
    const error = new Error('load failed');
    logError('Failed to load rules', error);
    expect(errorSpy).toHaveBeenCalledWith(
      '[opencode-rules] Failed to load rules:',
      error
    );
  });

  it('suppresses errors when OPENCODE_RULES_DEBUG is unset', async () => {
    const { logError } = await loadDebugModule(false);
    logError('Failed to load rules', new Error('load failed'));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('captures the enabled state when the module loads', async () => {
    const { createDebugLog } = await loadDebugModule(true);
    delete process.env.OPENCODE_RULES_DEBUG;

    createDebugLog()('still enabled');

    expect(debugSpy).toHaveBeenCalledWith('[opencode-rules] still enabled');
  });

  it('does not enable output when the variable is set after module load', async () => {
    const { createDebugLog } = await loadDebugModule(false);
    process.env.OPENCODE_RULES_DEBUG = '1';

    createDebugLog()('still disabled');

    expect(debugSpy).not.toHaveBeenCalled();
  });
});
