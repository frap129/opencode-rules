import { describe, it, expect } from 'vitest';
import { evaluateHooks, serializeToolArgs } from './rule-hooks.js';
import type { RuleHook } from './rule-metadata.js';

describe('rule-hooks', () => {
  describe('serializeToolArgs', () => {
    it('serializes args to JSON string', () => {
      const result = serializeToolArgs({
        command: 'node server.js --host 0.0.0.0',
      });
      expect(result).toBe('{"command":"node server.js --host 0.0.0.0"}');
    });
  });

  describe('evaluateHooks', () => {
    const hooks: RuleHook[] = [
      { type: 'PreToolUse', tool: 'bash', match: '0\\.0\\.0\\.0' },
      { type: 'PreToolUse', tool: 'bash', match: '\\bgrep\\b' },
      { type: 'PostToolUse', tool: 'bash', match: 'error' },
      { type: 'PreToolUse', tool: '*', match: 'dangerous' },
    ];

    it('matches PreToolUse hook by tool name and regex', () => {
      const result = evaluateHooks(hooks, {
        toolName: 'bash',
        serializedArgs: '{"command":"node server.js --host 0.0.0.0"}',
        hookType: 'PreToolUse',
      });
      expect(result).toHaveLength(1);
      expect(result[0].tool).toBe('bash');
    });

    it('does not match PostToolUse when evaluating PreToolUse', () => {
      const result = evaluateHooks(hooks, {
        toolName: 'bash',
        serializedArgs: '{"command":"grep foo"}',
        hookType: 'PostToolUse',
      });
      expect(result).toHaveLength(0);
    });

    it('returns empty array when no hooks match', () => {
      const result = evaluateHooks(hooks, {
        toolName: 'read',
        serializedArgs: '{"filePath":"src/main.ts"}',
        hookType: 'PreToolUse',
      });
      expect(result).toHaveLength(0);
    });

    it('matches wildcard tool', () => {
      const result = evaluateHooks(hooks, {
        toolName: 'write',
        serializedArgs: '{"dangerous": true}',
        hookType: 'PreToolUse',
      });
      expect(result).toHaveLength(1);
      expect(result[0].tool).toBe('*');
    });
  });
});
