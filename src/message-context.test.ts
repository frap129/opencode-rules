import { describe, it, expect } from 'vitest';

import {
  sanitizePathForContext,
  extractLatestUserPrompt,
  extractSessionID,
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
