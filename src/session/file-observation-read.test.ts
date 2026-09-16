import { describe, it, expect } from 'vitest';
import {
  normalizeObservations,
  type RawToolEvent,
} from './file-observation.js';

const readEvent = (overrides: Partial<RawToolEvent>): RawToolEvent => ({
  tool: 'read',
  args: { filePath: 'src/a.ts' },
  ...overrides,
});

describe('normalizeObservations: read reconstruction', () => {
  it('strips wrapper tags and line-number prefixes, joining returned lines', () => {
    const output = [
      '<file path="src/a.ts">',
      '<content>',
      '1: const a = 1;',
      '2: const b = 2;',
      '</content>',
      '</file>',
    ].join('\n');
    expect(normalizeObservations(readEvent({ output }))).toEqual([
      { path: 'src/a.ts', tool: 'read', content: 'const a = 1;\nconst b = 2;' },
    ]);
  });

  it('continuation reads contribute only returned lines', () => {
    const output = ['<content>', '5: later line', '</content>'].join('\n');
    const [obs] = normalizeObservations(readEvent({ output }));
    expect(obs?.content).toBe('later line');
  });

  it('parses v2 read output: header plus numbered lines', () => {
    const output = [
      'Read file /tmp/proj/src/a.ts, lines 1-2',
      '1: export const a = 1;',
      '2: export const b = 2;',
    ].join('\n');
    expect(normalizeObservations(readEvent({ output }))).toEqual([
      {
        path: 'src/a.ts',
        tool: 'read',
        content: 'export const a = 1;\nexport const b = 2;',
      },
    ]);
  });

  it('parses v2 continuation reads with offset numbering', () => {
    const output = [
      'Read file /tmp/proj/src/a.ts, lines 5-5',
      '5: later line',
    ].join('\n');
    const [obs] = normalizeObservations(readEvent({ output }));
    expect(obs?.content).toBe('later line');
  });

  it('parses v2 empty-file reads as empty content', () => {
    const output = 'Read file /tmp/proj/src/empty.ts, 0 lines';
    const [obs] = normalizeObservations(readEvent({ output }));
    expect(obs?.content).toBe('');
  });

  it('does not observe v2 directory reads', () => {
    const output = [
      'Read directory /tmp/proj/src, entries 1-2',
      'a.ts',
      'b.ts',
    ].join('\n');
    expect(normalizeObservations(readEvent({ output }))).toEqual([]);
  });

  it('makes unrecognized successful file results path-only', () => {
    const output = 'plain text result';
    const [obs] = normalizeObservations(readEvent({ output }));
    expect(obs?.content).toBe('');
  });

  it('does not observe directory reads', () => {
    const output = '<path>src</path>\n<type>directory</type>\nfile.ts';
    expect(normalizeObservations(readEvent({ output }))).toEqual([]);
  });

  it('binary/image/pdf reads produce path-only observations', () => {
    const output = '<file path="img.png">\n[Binary image]\n</file>';
    expect(normalizeObservations(readEvent({ output }))).toEqual([
      { path: 'src/a.ts', tool: 'read', content: '' },
    ]);
  });
});
