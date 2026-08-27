import { describe, expect, it } from 'vitest';
import {
  buildHookInjectionPart,
  buildRulePart,
  buildTransientHookMessage,
  buildTransientRuleMessage,
  hashContent,
  ruleKeyFor,
} from './rule-delivery-codec.js';
import type {
  RawHistoryAdapter,
  RawHistoryResult,
} from './rule-delivery-history.js';
import { createRuleDelivery, type RuleDelivery } from './rule-delivery.js';

class MockRawHistoryAdapter implements RawHistoryAdapter {
  calls: string[] = [];

  constructor(private readonly result: RawHistoryResult) {}

  async readHistory(sessionID: string): Promise<RawHistoryResult> {
    this.calls.push(sessionID);
    return this.result;
  }
}

describe('rule delivery codec', () => {
  it('preserves deterministic identities and durable and transient formats', () => {
    expect(hashContent('Durable guidance.')).toBe('8999624091e1022c');
    expect(ruleKeyFor('rules/core.md', 'Durable guidance.')).toBe(
      'rules/core.md:8999624091e1022c'
    );
    expect(buildRulePart('rules/core.md', 'Durable guidance.')).toEqual({
      id: 'prt_rules_dad3bb218895408d',
      type: 'text',
      text: '## rules/core.md\n\nDurable guidance.',
      synthetic: true,
    });
    expect(buildHookInjectionPart('Hook guidance.')).toEqual({
      id: 'prt_hook_1d4c59cbd8e30804',
      type: 'text',
      text: 'Hook guidance.',
      synthetic: true,
    });
    expect(
      buildTransientRuleMessage('rules/transient.md', 'Transient guidance.', {
        id: 'msg_user',
        role: 'user',
        providerID: 'opencode-go',
        modelID: 'deepseek-v4-flash',
      })
    ).toEqual({
      info: {
        id: 'msg_rule_ephemeral_85f42885ffa0d6d6',
        role: 'user',
        providerID: 'opencode-go',
        modelID: 'deepseek-v4-flash',
        model: {
          providerID: 'opencode-go',
          modelID: 'deepseek-v4-flash',
        },
      },
      parts: [
        {
          id: 'prt_rule_ephemeral_85f42885ffa0d6d6',
          type: 'text',
          text: '# OpenCode transient rule: rules/transient.md\n\nTransient guidance.',
          synthetic: true,
        },
      ],
    });
    expect(
      buildTransientHookMessage('Hook guidance.', { role: 'user' })
    ).toEqual({
      info: {
        id: 'msg_rules_hook_1d4c59cbd8e30804',
        role: 'user',
        model: { providerID: undefined, modelID: undefined },
      },
      parts: [
        {
          id: 'prt_hook_transient_1d4c59cbd8e30804',
          type: 'text',
          text: 'Hook guidance.',
          synthetic: true,
        },
      ],
    });
  });
});

describe('RuleDelivery history interface', () => {
  it('decodes durable rule and Hook facts, including legacy markers', async () => {
    const history = new MockRawHistoryAdapter({
      ok: true,
      messages: [
        {
          info: { id: 'msg_history', role: 'user' },
          parts: [
            buildRulePart('rules/core.md', 'Durable guidance.'),
            {
              type: 'text',
              text: '## legacy.md\n\nLegacy guidance.',
              synthetic: true,
            },
            {
              id: null,
              type: 'text',
              text: '## old-id.md\n\nOld id guidance.',
              synthetic: true,
            },
            buildHookInjectionPart('Hook guidance.'),
            buildTransientRuleMessage(
              'rules/transient.md',
              'Transient guidance.',
              {
                id: 'msg_user',
                role: 'user',
              }
            ).parts[0],
            buildTransientHookMessage('Transient Hook.', { role: 'user' })
              .parts[0],
          ],
        },
      ],
    });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });

    const facts = await delivery.decodeHistory('ses_history');

    expect(facts?.ruleKeys).toEqual(
      new Set([
        ruleKeyFor('rules/core.md', 'Durable guidance.'),
        ruleKeyFor('legacy.md', 'Legacy guidance.'),
        ruleKeyFor('old-id.md', 'Old id guidance.'),
      ])
    );
    expect(facts?.ruleRelativePaths).toEqual(
      new Set(['rules/core.md', 'legacy.md', 'old-id.md'])
    );
    expect(facts?.hookHashes).toEqual(new Set(['1d4c59cbd8e30804']));
    expect(history.calls).toEqual(['ses_history']);
  });

  it('ignores malformed and foreign history entries without throwing', async () => {
    const history = new MockRawHistoryAdapter({
      ok: true,
      messages: [
        null,
        { parts: undefined },
        { parts: 'not an array' },
        {
          parts: [
            { id: 'prt_foreign_1', text: 'foreign', synthetic: true },
            { id: 'prt_rules_bad', type: 'text', text: 'not a rule' },
            { type: 'text', text: 'ordinary text' },
            { type: 'text', text: '## missing-synthetic.md\n\nIgnored' },
            {
              id: 'prt_rule_ephemeral_85f42885ffa0d6d6',
              type: 'text',
              text: '# OpenCode transient rule: rules/core.md\n\nDurable guidance.',
              synthetic: true,
            },
            {
              id: 'prt_hook_transient_1d4c59cbd8e30804',
              type: 'text',
              text: 'Transient Hook.',
              synthetic: true,
            },
          ],
        },
      ],
    });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    const facts = await delivery.decodeHistory('ses_malformed');

    expect(facts?.ruleKeys).toEqual(new Set());
    expect(facts?.hookHashes).toEqual(new Set());
    expect(facts?.ruleRelativePaths).toEqual(new Set());
    expect(history.calls).toEqual(['ses_malformed']);
  });

  it('returns no facts when history is unavailable or the adapter throws', async () => {
    const unavailable: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: false }),
    });
    await expect(unavailable.decodeHistory('ses_unavailable')).resolves.toBe(
      undefined
    );

    const throwing: RawHistoryAdapter = {
      readHistory: async () => {
        throw new Error('server down');
      },
    };
    const failed: RuleDelivery = createRuleDelivery({ rawHistory: throwing });
    await expect(failed.decodeHistory('ses_failed')).resolves.toBeUndefined();
  });
});
