import { describe, it, expect } from 'vitest';
import { parseRuleMetadata } from './rule-metadata.js';

describe('rule identity metadata', () => {
  it('parses a trimmed rule name', () => {
    expect(
      parseRuleMetadata('---\nname: "  TypeScript safety  "\n---\nRule body')
    ).toEqual({ name: 'TypeScript safety' });
  });
});

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

describe('fileContains parsing', () => {
  it('parses a scalar string as a one-element array', () => {
    const content = `---
fileContains: "unsafe {"
---
rule`;
    expect(parseRuleMetadata(content)?.fileContains).toEqual(['unsafe {']);
  });

  it('parses an array of literals', () => {
    const content = `---
fileContains:
  - "TODO"
  - "FIXME"
---
rule`;
    expect(parseRuleMetadata(content)?.fileContains).toEqual(['TODO', 'FIXME']);
  });

  it('trims entries and deduplicates exact case-sensitive strings', () => {
    const content = `---
fileContains:
  - "  Foo  "
  - "Foo"
  - "foo"
---
rule`;
    expect(parseRuleMetadata(content)?.fileContains).toEqual(['Foo', 'foo']);
  });

  it('drops non-string and empty entries', () => {
    const content = `---
fileContains:
  - 123
  - true
  - ""
  - "  "
  - "keep"
---
rule`;
    expect(parseRuleMetadata(content)?.fileContains).toEqual(['keep']);
  });

  it('yields an empty array for a declared field with no valid literals', () => {
    const content = `---
fileContains: ""
---
rule`;
    expect(parseRuleMetadata(content)?.fileContains).toEqual([]);
  });

  it('yields an empty array when every entry is invalid', () => {
    const content = `---
fileContains:
  - ""
  - 42
---
rule`;
    expect(parseRuleMetadata(content)?.fileContains).toEqual([]);
  });

  it('drops non-scalar non-array values to an empty array', () => {
    const content = `---
fileContains:
  key: value
---
rule`;
    expect(parseRuleMetadata(content)?.fileContains).toEqual([]);
  });

  it('treats null as a declared empty field', () => {
    const content = `---
fileContains:
---
rule`;
    expect(parseRuleMetadata(content)?.fileContains).toEqual([]);
  });
});
