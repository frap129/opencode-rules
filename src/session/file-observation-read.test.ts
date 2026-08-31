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
