import { describe, it, expect } from 'vitest';
import {
  normalizeObservations,
  type RawToolEvent,
} from './file-observation.js';

const readEvent = (overrides: Partial<RawToolEvent>): RawToolEvent => ({
  tool: 'apply_patch',
  args: {},
  ...overrides,
});

describe('normalizeObservations: apply_patch', () => {
  it('contributes full added-file content', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+const fresh = 1;',
      '+const second = 2;',
      '*** End Patch',
    ].join('\n');
    expect(
      normalizeObservations(
        readEvent({ tool: 'apply_patch', args: { patchText: patch } })
      )
    ).toEqual([
      {
        path: 'src/new.ts',
        tool: 'apply_patch',
        content: 'const fresh = 1;\nconst second = 2;',
      },
    ]);
  });

  it('contributes added, removed, and context lines for updates, excluding patch syntax', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      ' context line',
      '-old line',
      '+new line',
      '*** End Patch',
    ].join('\n');
    expect(
      normalizeObservations(
        readEvent({ tool: 'apply_patch', args: { patchText: patch } })
      )
    ).toEqual([
      {
        path: 'src/a.ts',
        tool: 'apply_patch',
        content: ' context line\nold line\nnew line',
      },
    ]);
  });

  it('keys hunks to the destination path for moves', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move To: src/new.ts',
      '@@',
      '-before',
      '+after',
      '*** End Patch',
    ].join('\n');
    expect(
      normalizeObservations(
        readEvent({ tool: 'apply_patch', args: { patchText: patch } })
      )
    ).toEqual([
      { path: 'src/new.ts', tool: 'apply_patch', content: 'before\nafter' },
    ]);
  });

  it('deleted files are path-only even with content-like lines', () => {
    const patch = [
      '*** Begin Patch',
      '*** Delete File: src/gone.ts',
      '-secret literal here',
      '-second removed line',
      '*** End Patch',
    ].join('\n');
    expect(
      normalizeObservations(
        readEvent({ tool: 'apply_patch', args: { patchText: patch } })
      )
    ).toEqual([{ path: 'src/gone.ts', tool: 'apply_patch', content: '' }]);
  });

  it('parses one observation per touched file across a multi-file patch', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: src/one.ts',
      '+alpha',
      '*** Add File: src/two.ts',
      '+beta',
      '*** End Patch',
    ].join('\n');
    expect(
      normalizeObservations(
        readEvent({ tool: 'apply_patch', args: { patchText: patch } })
      )
    ).toEqual([
      { path: 'src/one.ts', tool: 'apply_patch', content: 'alpha' },
      { path: 'src/two.ts', tool: 'apply_patch', content: 'beta' },
    ]);
  });
});

describe('normalizeObservations: malformed patch fallback', () => {
  it('recovers path-only observations parsed from A/D/M summary lines', () => {
    const output = [
      'A src/added.ts',
      'M src/modified.ts',
      'D src/deleted.ts',
      'R src/from.ts -> src/to.ts',
      'Done!',
    ].join('\n');
    expect(
      normalizeObservations(
        readEvent({
          tool: 'apply_patch',
          args: { patchText: 'not a patch' },
          output,
        })
      )
    ).toEqual([
      { path: 'src/added.ts', tool: 'apply_patch', content: '' },
      { path: 'src/modified.ts', tool: 'apply_patch', content: '' },
      { path: 'src/deleted.ts', tool: 'apply_patch', content: '' },
      { path: 'src/to.ts', tool: 'apply_patch', content: '' },
    ]);
  });

  it('yields no observation when the patch is unparseable and the summary has none', () => {
    expect(
      normalizeObservations(
        readEvent({
          tool: 'apply_patch',
          args: { patchText: 'not a patch' },
          output: 'Done!',
        })
      )
    ).toEqual([]);
  });
});
