import { describe, it, expect } from 'vitest';

import {
  sanitizePathForContext,
  extractLatestUserPrompt,
  extractSessionID,
  toExtractableMessages,
  MessageWithInfo,
} from './message-context.js';

describe('message-context', () => {
  it('sanitizes control characters and truncates', () => {
    const p = 'src/file.ts\nignore\tme\rplease';
    expect(sanitizePathForContext(p)).toBe('src/file.ts ignore me please');
  });

  it('extracts sessionID from message info', () => {
    expect(extractSessionID([{ info: { sessionID: 'ses_1' } }])).toBe('ses_1');
  });

  it('extracts latest non-synthetic user prompt', () => {
    const prompt = extractLatestUserPrompt([
      {
        parts: [{ type: 'text', text: 'older', synthetic: true }],
      },
      {
        parts: [{ type: 'text', text: 'hello world' }],
      },
    ]);
    expect(prompt).toBe('hello world');
  });
});

describe('toExtractableMessages', () => {
  it('passes through messages with role and parts', () => {
    const messages: MessageWithInfo[] = [
      { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ];
    const result = toExtractableMessages(messages);
    expect(result).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('filters out messages with missing role', () => {
    const messages: MessageWithInfo[] = [
      { parts: [{ type: 'text', text: 'hello' }] },
    ];
    expect(toExtractableMessages(messages)).toEqual([]);
  });

  it('filters out messages with missing parts', () => {
    const messages: MessageWithInfo[] = [{ role: 'user' }];
    expect(toExtractableMessages(messages)).toEqual([]);
  });

  it('filters out messages with empty parts array', () => {
    const messages: MessageWithInfo[] = [{ role: 'user', parts: [] }];
    expect(toExtractableMessages(messages)).toEqual([]);
  });

  it('handles mixed valid and invalid messages', () => {
    const messages: MessageWithInfo[] = [
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant' },
      { parts: [{ type: 'text', text: 'x' }] },
      { role: 'user', parts: [{ type: 'text', text: 'bye' }] },
    ];
    const result = toExtractableMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('user');
  });

  it('returns empty array for empty input', () => {
    expect(toExtractableMessages([])).toEqual([]);
  });
});
