import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebugLog } from './debug.js';

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
