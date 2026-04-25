import { describe, it, expect } from 'vitest';
import { parseRuleMetadata } from './rule-metadata.js';

describe('hook metadata parsing', () => {
  it('parses PreToolUse and PostToolUse hooks', () => {
    const content = `---
hooks:
  - type: PreToolUse
    tool: bash
    match: "0\\\\.0\\\\.0\\\\.0"
    block: true
  - type: PostToolUse
    tool: bash
    match: "\\\\bgrep\\\\b"
    run: "canon remember 'use rg' --type pattern"
---

# Rule body
`;
    const meta = parseRuleMetadata(content);
    expect(meta).toBeDefined();
    expect(meta?.hooks).toBeDefined();
    expect(meta?.hooks).toHaveLength(2);
    expect(meta?.hooks?.[0]).toEqual({
      type: 'PreToolUse',
      tool: 'bash',
      match: '0\\.0\\.0\\.0',
      block: true,
      run: undefined,
    });
    expect(meta?.hooks?.[1]).toEqual({
      type: 'PostToolUse',
      tool: 'bash',
      match: '\\bgrep\\b',
      block: undefined,
      run: "canon remember 'use rg' --type pattern",
    });
  });

  it('ignores invalid hook entries', () => {
    const content = `---
hooks:
  - type: PreToolUse
    tool: bash
    match: "test"
  - not: valid
  - type: InvalidType
    tool: bash
    match: "test"
---
`;
    const meta = parseRuleMetadata(content);
    expect(meta?.hooks).toHaveLength(1);
  });
});
