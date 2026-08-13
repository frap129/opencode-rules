import { describe, it, expect } from 'vitest';
import {
  createMockSessionContext,
  createMockToolExecuteBefore,
} from './test-fixtures.js';

describe('v2 fixtures', () => {
  it('builds a session context with mutable system/messages/tools', () => {
    const ctx = createMockSessionContext({ sessionID: 's1' });
    expect(ctx.sessionID).toBe('s1');
    ctx.system.push({ type: 'text', text: 'x' });
    expect(ctx.system).toHaveLength(1);
  });

  it('builds a tool execute.before payload', () => {
    const e = createMockToolExecuteBefore({
      tool: 'bash',
      input: { workdir: '/tmp' },
    });
    expect(e.tool).toBe('bash');
    expect(e.input).toEqual({ workdir: '/tmp' });
  });
});
