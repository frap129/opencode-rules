import { describe, it, expect } from 'vitest';
import {
  hashContent,
  ruleKeyFor,
  buildRulePart,
  buildHookInjectionPart,
  buildTransientHookMessage,
  buildTransientRuleMessage,
  scanInjectedParts,
} from './synthetic-injection.js';

describe('hashContent / ruleKeyFor', () => {
  it('derives a deterministic 16-char digest', () => {
    expect(hashContent('Never commit secrets.')).toBe(
      hashContent('Never commit secrets.')
    );
    expect(hashContent('Never commit secrets.')).toHaveLength(16);
    expect(hashContent('other')).not.toBe(hashContent('Never commit secrets.'));
  });

  it('combines relative path and content digest into a rule key', () => {
    expect(ruleKeyFor('security.mdc', 'content')).toBe(
      `security.mdc:${hashContent('content')}`
    );
    expect(ruleKeyFor('a.md', 'x')).not.toBe(ruleKeyFor('b.md', 'x'));
    expect(ruleKeyFor('a.md', 'x')).not.toBe(ruleKeyFor('a.md', 'y'));
  });
});

describe('buildRulePart', () => {
  it('builds a deterministic synthetic part with per-rule block text', () => {
    const p1 = buildRulePart('security.mdc', 'Never commit secrets.');
    const p2 = buildRulePart('security.mdc', 'Never commit secrets.');
    expect(p1).toEqual(p2);
    expect(p1.id.startsWith('prt_rules_')).toBe(true);
    expect(p1.type).toBe('text');
    expect(p1.synthetic).toBe(true);
    expect(p1.text).toBe('## security.mdc\n\nNever commit secrets.');
  });

  it('changes the part id when content changes', () => {
    expect(buildRulePart('a.md', 'one').id).not.toBe(
      buildRulePart('a.md', 'two').id
    );
  });
});

describe('buildHookInjectionPart', () => {
  it('builds a durable hook part keyed by content hash', () => {
    const part = buildHookInjectionPart('Use pinned dependencies.');
    expect(part.id).toBe(`prt_hook_${hashContent('Use pinned dependencies.')}`);
    expect(part.type).toBe('text');
    expect(part.synthetic).toBe(true);
    expect(part.text).toBe('Use pinned dependencies.');
  });
});

describe('buildTransientRuleMessage', () => {
  it('creates a deterministic transient rule message outside the durable prefixes', () => {
    const message = buildTransientRuleMessage('agent-plan.md', 'Plan body.', {
      id: 'msg_user',
      role: 'user',
      sessionID: 'ses_1',
    });

    expect(message.info.id).toMatch(/^msg_rule_ephemeral_/);
    expect(message.parts[0]?.id).toMatch(/^prt_rule_ephemeral_/);
    expect(message.parts[0]?.id).not.toMatch(/^prt_rules_/);
    expect(message.parts[0]?.text).toBe(
      '# OpenCode transient rule: agent-plan.md\n\nPlan body.'
    );
    expect(message.parts[0]?.synthetic).toBe(true);

    const scan = scanInjectedParts([message]);
    expect(scan.ruleKeys.size).toBe(0);
    expect(scan.ruleRelativePaths.size).toBe(0);
  });

  it('does not let an id-less transient marker become a durable rule', () => {
    const message = buildTransientRuleMessage('agent-plan.md', 'Plan body.', {
      id: 'msg_user',
      role: 'user',
    });
    const partWithoutId = { ...message.parts[0] };
    delete partWithoutId.id;

    const scan = scanInjectedParts([
      { info: { role: 'user' }, parts: [partWithoutId] },
    ]);

    expect(scan.ruleKeys.size).toBe(0);
    expect(scan.ruleRelativePaths.size).toBe(0);
  });
});

describe('buildTransientHookMessage', () => {
  it('clones base info with deterministic message and part ids', () => {
    const baseInfo = {
      id: 'msg_123',
      role: 'user',
      sessionID: 'ses_1',
      modelID: 'claude-opus',
    };
    const message = buildTransientHookMessage(
      'Use pinned dependencies.',
      baseInfo
    );
    expect(message.info.id).toBe(
      `msg_rules_hook_${hashContent('Use pinned dependencies.')}`
    );
    expect(message.info.role).toBe('user');
    expect(message.info.modelID).toBe('claude-opus');
    expect(message.parts).toHaveLength(1);
    expect(message.parts[0]?.id).toBe(
      `prt_hook_transient_${hashContent('Use pinned dependencies.')}`
    );
    expect(message.parts[0]?.synthetic).toBe(true);
    expect(message.parts[0]?.text).toBe('Use pinned dependencies.');
  });

  it('never mutates the base info object', () => {
    const baseInfo = { id: 'msg_123', role: 'user' };
    buildTransientHookMessage('x', baseInfo);
    expect(baseInfo).toEqual({ id: 'msg_123', role: 'user' });
  });
});

describe('scanInjectedParts', () => {
  it('recovers rule keys, hook hashes, and rule paths from history', () => {
    const rulePart = buildRulePart('security.mdc', 'Never commit secrets.');
    const hookPart = buildHookInjectionPart('Use pinned dependencies.');
    const scan = scanInjectedParts([
      {
        info: { id: 'msg_1', role: 'user', sessionID: 'ses_1' },
        parts: [rulePart],
      },
      {
        info: { id: 'msg_2', role: 'user', sessionID: 'ses_1' },
        parts: [hookPart],
      },
    ]);
    expect(scan.ruleKeys).toContain(
      ruleKeyFor('security.mdc', 'Never commit secrets.')
    );
    expect(scan.ruleRelativePaths).toContain('security.mdc');
    expect(scan.hookHashes).toContain(hashContent('Use pinned dependencies.'));
  });

  it('ignores transient hook part ids', () => {
    const transient = buildTransientHookMessage('note', {
      id: 'msg_1',
      role: 'user',
    });
    const scan = scanInjectedParts([
      { info: transient.info, parts: transient.parts },
    ]);
    expect(scan.hookHashes.size).toBe(0);
  });

  it('recognizes rule parts via the text-marker fallback when ids are missing', () => {
    const scan = scanInjectedParts([
      {
        info: { role: 'user' },
        parts: [
          { type: 'text', text: '## legacy.md\n\nOld format', synthetic: true },
        ],
      },
    ]);
    expect(scan.ruleKeys).toContain(ruleKeyFor('legacy.md', 'Old format'));
    expect(scan.ruleRelativePaths).toContain('legacy.md');
  });

  it('ignores non-synthetic text parts and foreign parts', () => {
    const scan = scanInjectedParts([
      {
        info: { role: 'user' },
        parts: [
          { type: 'text', text: '## not-a-rule.md\n\nplain user text' },
          {
            id: 'prt_foreign_1',
            type: 'text',
            text: 'other plugin content',
            synthetic: true,
          },
        ],
      },
    ]);
    expect(scan.ruleKeys.size).toBe(0);
    expect(scan.hookHashes.size).toBe(0);
    expect(scan.ruleRelativePaths.size).toBe(0);
  });

  it('handles empty and malformed input defensively', () => {
    expect(scanInjectedParts([]).ruleKeys.size).toBe(0);
    expect(
      scanInjectedParts([{ parts: undefined as never }]).ruleKeys.size
    ).toBe(0);
  });
});
