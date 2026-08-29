import { describe, it, expect } from 'vitest';
import { createFileObservationContext } from './file-observation-context.js';

describe('FileObservationContext', () => {
  it('normalizes live events once and returns the stored observation', () => {
    const context = createFileObservationContext({ projectDirectory: '/repo' });
    expect(
      context.recordToolEvent('ses_1', {
        tool: 'write',
        args: { filePath: '/repo/src/a.ts', content: 'alpha' },
      })
    ).toEqual([{ path: 'src/a.ts', tool: 'write', content: 'alpha' }]);
    expect(context.getForMatching('ses_1')).toEqual([
      { path: 'src/a.ts', tool: 'write', content: 'alpha' },
    ]);
  });

  it('returns sorted detached observations', () => {
    const context = createFileObservationContext({ projectDirectory: '/repo' });
    context.recordObservations('ses_1', [
      { path: 'z.ts', tool: 'read', content: 'z' },
      { path: 'a.ts', tool: 'read', content: 'a' },
    ]);
    const first = context.getForMatching('ses_1');
    first[0]!.content = 'mutated';
    expect(context.getForMatching('ses_1')).toEqual([
      { path: 'a.ts', tool: 'read', content: 'a' },
      { path: 'z.ts', tool: 'read', content: 'z' },
    ]);
  });

  it('retains repeated-path observations monotonically', () => {
    const context = createFileObservationContext({ projectDirectory: '/repo' });
    context.recordObservations('ses_1', [
      { path: 'src/a.ts', tool: 'write', content: 'first literal' },
      { path: 'src/a.ts', tool: 'edit', content: 'second literal' },
    ]);
    expect(context.getForMatching('ses_1')).toEqual([
      { path: 'src/a.ts', tool: 'write', content: 'first literal' },
      { path: 'src/a.ts', tool: 'edit', content: 'second literal' },
    ]);
  });

  it('evicts the least-recently-used session at the bound', () => {
    const context = createFileObservationContext({
      projectDirectory: '/repo',
      maxSessions: 2,
    });
    context.recordObservations('ses_a', [
      { path: 'a.ts', tool: 'read', content: 'a' },
    ]);
    context.recordObservations('ses_b', [
      { path: 'b.ts', tool: 'read', content: 'b' },
    ]);
    context.getForMatching('ses_a');
    context.recordObservations('ses_c', [
      { path: 'c.ts', tool: 'read', content: 'c' },
    ]);
    expect(context.getForMatching('ses_a')).toEqual([
      { path: 'a.ts', tool: 'read', content: 'a' },
    ]);
    expect(context.getForMatching('ses_c')).toEqual([
      { path: 'c.ts', tool: 'read', content: 'c' },
    ]);
    expect(context.getForMatching('ses_b')).toEqual([]);
  });
});
