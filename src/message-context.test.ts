import { describe, it, expect } from 'vitest';

import {
  sanitizePathForContext,
  extractLatestUserPrompt,
  extractSessionID,
  toExtractableMessages,
  extractSlashCommand,
  extractTextFromParts,
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

describe('extractTextFromParts', () => {
  it('extracts text from parts with type text', () => {
    const parts = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ];
    expect(extractTextFromParts(parts)).toBe('hello world');
  });

  it('extracts text from parts without type (implicit text)', () => {
    const parts = [{ text: 'foo' }, { text: 'bar' }];
    expect(extractTextFromParts(parts)).toBe('foo bar');
  });

  it('skips synthetic parts', () => {
    const parts = [
      { type: 'text', text: 'real', synthetic: false },
      { type: 'text', text: 'skip', synthetic: true },
      { type: 'text', text: 'also real' },
    ];
    expect(extractTextFromParts(parts)).toBe('real also real');
  });

  it('handles mixed part shapes', () => {
    const parts = [
      { type: 'text', text: 'typed' },
      { text: 'untyped' },
      { type: 'image', data: 'binary' },
      { type: 'text', text: 'more', synthetic: true },
    ];
    expect(extractTextFromParts(parts)).toBe('typed untyped');
  });

  it('returns empty string for empty array', () => {
    expect(extractTextFromParts([])).toBe('');
  });

  it('returns empty string when all parts are synthetic', () => {
    const parts = [{ type: 'text', text: 'skip', synthetic: true }];
    expect(extractTextFromParts(parts)).toBe('');
  });

  it('trims and filters whitespace-only text', () => {
    const parts = [
      { type: 'text', text: '  hello  ' },
      { type: 'text', text: '   ' },
    ];
    expect(extractTextFromParts(parts)).toBe('hello');
  });

  it('returns undefined when result is empty after trimming', () => {
    const parts = [{ type: 'text', text: '   ' }];
    expect(extractTextFromParts(parts)).toBe('');
  });
});

describe('extractSlashCommand', () => {
  it('extracts leading slash command from prompt', () => {
    expect(extractSlashCommand('/fix lint errors')).toBe('/fix');
    expect(extractSlashCommand('/plan implement filters')).toBe('/plan');
    expect(extractSlashCommand('/review')).toBe('/review');
  });

  it('returns undefined for non-slash prompt', () => {
    expect(extractSlashCommand('hello world')).toBeUndefined();
    expect(extractSlashCommand('fix the bug')).toBeUndefined();
  });

  it('returns undefined for blank or whitespace input', () => {
    expect(extractSlashCommand('')).toBeUndefined();
    expect(extractSlashCommand('   ')).toBeUndefined();
    expect(extractSlashCommand(undefined)).toBeUndefined();
  });

  it('returns undefined for bare slash inputs', () => {
    expect(extractSlashCommand('/')).toBeUndefined();
    expect(extractSlashCommand('/   ')).toBeUndefined();
    expect(extractSlashCommand('/  \t  ')).toBeUndefined();
  });

  it('handles punctuation and format edge cases', () => {
    // Trailing punctuation is part of token (not stripped)
    expect(extractSlashCommand('/plan,')).toBe('/plan,');
    // Double slash is a valid token (starts with /, length > 1)
    expect(extractSlashCommand('//plan')).toBe('//plan');
    // Slash with only punctuation is still valid (length > 1)
    expect(extractSlashCommand('/!')).toBe('/!');
  });
});
