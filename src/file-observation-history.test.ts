import { describe, it, expect } from 'vitest';
import {
  extractObservationsFromMessageParts,
  normalizeObservations,
  type RawToolEvent,
} from './file-observation.js';

describe('extractObservationsFromMessageParts', () => {
  it('yields one observation per history tool part', () => {
    const parts = [
      {
        type: 'tool',
        tool: 'read',
        state: {
          status: 'completed',
          input: { filePath: 'src/a.ts' },
          output: '<content>1: text</content>',
        },
      },
    ];
    expect(extractObservationsFromMessageParts(parts)).toEqual([
      { path: 'src/a.ts', tool: 'read', content: 'text' },
    ]);
  });

  it('writes keyed from persisted input content', () => {
    const parts = [
      {
        type: 'tool',
        tool: 'write',
        state: {
          status: 'completed',
          input: { filePath: 'src/w.ts', content: 'body' },
        },
      },
    ];
    expect(extractObservationsFromMessageParts(parts)).toEqual([
      { path: 'src/w.ts', tool: 'write', content: 'body' },
    ]);
  });

  it('skips non-completed and malformed parts', () => {
    const parts = [
      {
        type: 'tool',
        tool: 'read',
        state: { status: 'pending', input: { filePath: 'x.ts' } },
      },
      { type: 'text', text: 'src/prose.ts' },
      { type: 'tool', tool: 'read' },
    ];
    expect(extractObservationsFromMessageParts(parts)).toEqual([]);
  });

  it('normalizes live events and history parts identically', () => {
    const event: RawToolEvent = {
      tool: 'write',
      args: { filePath: 'src/m.ts', content: 'same' },
    };
    const parts = [
      {
        type: 'tool',
        tool: 'write',
        state: {
          status: 'completed',
          input: { filePath: 'src/m.ts', content: 'same' },
        },
      },
    ];
    expect(normalizeObservations(event)).toEqual(
      extractObservationsFromMessageParts(parts)
    );
  });
});
