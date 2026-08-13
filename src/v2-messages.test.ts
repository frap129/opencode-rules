// src/v2-messages.test.ts
import { describe, it, expect } from 'vitest';
import { toV1Messages } from './v2-messages.js';
import type { V2Message } from './v2-types.js';

describe('toV1Messages', () => {
  it('converts text parts', () => {
    const messages: V2Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'fix the login bug' }] },
    ];
    expect(toV1Messages(messages)).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'fix the login bug' }] },
    ]);
  });

  it('converts tool-call parts to tool-invocation', () => {
    const messages: V2Message[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            id: 'c1',
            name: 'read',
            input: { filePath: 'src/index.ts' },
          },
        ],
      },
    ];
    expect(toV1Messages(messages)).toEqual([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'read',
              args: { filePath: 'src/index.ts' },
            },
          },
        ],
      },
    ]);
  });

  it('uses empty args when tool-call input is not an object', () => {
    const messages: V2Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c2', name: 'bash', input: 'ls' }],
      },
    ];
    expect(toV1Messages(messages)).toEqual([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: { toolName: 'bash', args: {} },
          },
        ],
      },
    ]);
  });

  it('uses empty args for null tool-call input', () => {
    const messages: V2Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c3', name: 'read', input: null }],
      },
    ];
    expect(toV1Messages(messages)).toEqual([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: { toolName: 'read', args: {} },
          },
        ],
      },
    ]);
  });

  it('uses empty args for array tool-call input', () => {
    const messages: V2Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c4', name: 'bash', input: ['a'] }],
      },
    ];
    expect(toV1Messages(messages)).toEqual([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: { toolName: 'bash', args: {} },
          },
        ],
      },
    ]);
  });

  it('drops tool-result, media and reasoning parts', () => {
    const messages: V2Message[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id: 'r1',
            name: 'read',
            result: { value: 'x' },
          },
          { type: 'reasoning', text: 'thinking' },
          { type: 'media', mediaType: 'image/png', data: 'x' },
        ],
      },
    ];
    expect(toV1Messages(messages)).toEqual([{ role: 'tool', parts: [] }]);
  });

  it('preserves order and keeps only kept parts in mixed content', () => {
    const messages: V2Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'first' },
          {
            type: 'tool-call',
            id: 'c5',
            name: 'read',
            input: { filePath: 'a.ts' },
          },
          { type: 'reasoning', text: 'skip me' },
        ],
      },
    ];
    expect(toV1Messages(messages)).toEqual([
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'first' },
          {
            type: 'tool-invocation',
            toolInvocation: { toolName: 'read', args: { filePath: 'a.ts' } },
          },
        ],
      },
    ]);
  });

  it('handles empty content', () => {
    expect(toV1Messages([{ role: 'system', content: [] }])).toEqual([
      { role: 'system', parts: [] },
    ]);
  });
});
