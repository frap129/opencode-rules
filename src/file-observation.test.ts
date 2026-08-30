import { describe, it, expect } from 'vitest';
import {
  normalizeObservations,
  type RawToolEvent,
} from './file-observation.js';

const readEvent = (overrides: Partial<RawToolEvent> = {}): RawToolEvent => ({
  tool: 'read',
  args: { filePath: 'src/lib.rs' },
  output: undefined,
  ...overrides,
});

describe('normalizeToolObservation: unsupported tools', () => {
  it('yields no observation for grep, glob, bash, and unknown tools', () => {
    for (const tool of ['grep', 'glob', 'bash', 'webfetch', 'custom_tool']) {
      expect(
        normalizeObservations(
          readEvent({ tool, args: { filePath: 'src/a.ts' }, output: 'text' })
        )
      ).toEqual([]);
    }
  });

  it('yields no observation for failed calls or empty paths', () => {
    expect(
      normalizeObservations(readEvent({ args: { filePath: '' } }))
    ).toEqual([]);
    expect(
      normalizeObservations(readEvent({ args: { filePath: 42 } }))
    ).toEqual([]);
    expect(normalizeObservations(readEvent({ args: undefined }))).toEqual([]);
    expect(normalizeObservations(readEvent({ args: null }))).toEqual([]);
  });
});

describe('normalizeToolObservation: write', () => {
  it('uses verbatim submitted content keyed to the submitted path', () => {
    expect(
      normalizeObservations(
        readEvent({
          tool: 'write',
          args: { filePath: 'src/a.ts', content: 'const x = 1;\n' },
        })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'write', content: 'const x = 1;\n' }]);
  });

  it('yields a path-only observation when content is not a string', () => {
    expect(
      normalizeObservations(
        readEvent({ tool: 'write', args: { filePath: 'src/a.ts' } })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'write', content: '' }]);
  });
});

describe('normalizeToolObservation: edit', () => {
  it('contributes removed oldString plus added newString', () => {
    expect(
      normalizeObservations(
        readEvent({
          tool: 'edit',
          args: {
            filePath: 'src/a.ts',
            oldString: 'foo\nbar',
            newString: 'baz',
          },
        })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'edit', content: 'foo\nbar\nbaz' }]);
  });

  it('preserves removed text for a pure-deletion edit', () => {
    expect(
      normalizeObservations(
        readEvent({
          tool: 'edit',
          args: {
            filePath: 'src/a.ts',
            oldString: 'TODO: remove\nsecond line',
            newString: '',
          },
        })
      )
    ).toEqual([
      {
        path: 'src/a.ts',
        tool: 'edit',
        content: 'TODO: remove\nsecond line',
      },
    ]);
  });

  it('degrades malformed old/new arguments to a path-only observation', () => {
    expect(
      normalizeObservations(
        readEvent({ tool: 'edit', args: { filePath: 'src/a.ts' } })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'edit', content: '' }]);
    expect(
      normalizeObservations(
        readEvent({
          tool: 'edit',
          args: { filePath: 'src/a.ts', oldString: 42, newString: 'baz' },
        })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'edit', content: '' }]);
  });
});

describe('normalizeToolObservation: lsp', () => {
  it('keys raw successful output to the queried file path', () => {
    const rawOutput = '<content>1: symbol</content>';
    expect(
      normalizeObservations(
        readEvent({
          tool: 'lsp',
          args: { filePath: 'src/a.ts' },
          output: rawOutput,
        })
      )
    ).toEqual([
      {
        path: 'src/a.ts',
        tool: 'lsp',
        content: rawOutput,
      },
    ]);
  });

  it('has no path arg mapped for lsp', () => {
    expect(normalizeObservations(readEvent({ tool: 'lsp', args: {} }))).toEqual(
      []
    );
  });
});
