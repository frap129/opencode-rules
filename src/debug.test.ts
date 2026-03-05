import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebugLog, createWarnLog } from './debug.js';

describe('createDebugLog', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let debugSpy: any;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    delete process.env.OPENCODE_RULES_DEBUG;
  });

  it('logs when OPENCODE_RULES_DEBUG is set', () => {
    process.env.OPENCODE_RULES_DEBUG = '1';
    const log = createDebugLog();
    log('test message');
    expect(debugSpy).toHaveBeenCalledWith('[opencode-rules] test message');
  });

  it('does not log when OPENCODE_RULES_DEBUG is unset', () => {
    const log = createDebugLog();
    log('test message');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('uses custom prefix', () => {
    process.env.OPENCODE_RULES_DEBUG = '1';
    const log = createDebugLog('[custom]');
    log('hello');
    expect(debugSpy).toHaveBeenCalledWith('[custom] hello');
  });
});

describe('createWarnLog', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let warnSpy: any;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('always logs warnings regardless of debug mode', () => {
    const warn = createWarnLog();
    warn('warning message');
    expect(warnSpy).toHaveBeenCalledWith(
      '[opencode-rules] Warning: warning message'
    );
  });

  it('uses custom prefix', () => {
    const warn = createWarnLog('[custom]');
    warn('warning message');
    expect(warnSpy).toHaveBeenCalledWith('[custom] Warning: warning message');
  });

  it('logs even when OPENCODE_RULES_DEBUG is unset', () => {
    delete process.env.OPENCODE_RULES_DEBUG;
    const warn = createWarnLog();
    warn('should still appear');
    expect(warnSpy).toHaveBeenCalledWith(
      '[opencode-rules] Warning: should still appear'
    );
  });
});
