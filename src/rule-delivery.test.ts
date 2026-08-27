import { describe, expect, it } from 'vitest';
import {
  buildHookInjectionPart,
  buildRulePart,
  buildTransientHookMessage,
  buildTransientRuleMessage,
  type DeliveryPart,
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

describe('RuleDelivery durable turns', () => {
  it('seeds once, appends new matched rules in order, and accepts duplicate-only turns', async () => {
    const history = new MockRawHistoryAdapter({
      ok: true,
      messages: [
        {
          parts: [buildRulePart('rules/existing.md', 'Existing guidance.')],
        },
      ],
    });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    const existingPart = { type: 'text', text: 'User prompt.' };
    const originalParts = [existingPart];
    const firstOutput = { parts: originalParts };

    const firstResult = await delivery.deliverDurableTurn({
      sessionID: 'ses_durable',
      messageID: 'msg_first',
      matchedRules: [
        { relativePath: 'rules/first.md', content: 'First guidance.' },
        { relativePath: 'rules/existing.md', content: 'Existing guidance.' },
        { relativePath: 'rules/second.md', content: 'Second guidance.' },
        { relativePath: 'rules/first.md', content: 'First guidance.' },
      ],
      output: firstOutput,
    });

    expect(firstResult).toBe('accepted');
    expect(firstOutput.parts).toBe(originalParts);
    expect(firstOutput.parts).toEqual([
      existingPart,
      {
        ...buildRulePart('rules/first.md', 'First guidance.'),
        sessionID: 'ses_durable',
        messageID: 'msg_first',
      },
      {
        ...buildRulePart('rules/second.md', 'Second guidance.'),
        sessionID: 'ses_durable',
        messageID: 'msg_first',
      },
    ]);

    const duplicateOutput = { parts: [] };
    const duplicateResult = await delivery.deliverDurableTurn({
      sessionID: 'ses_durable',
      messageID: 'msg_second',
      matchedRules: [
        { relativePath: 'rules/first.md', content: 'First guidance.' },
      ],
      output: duplicateOutput,
    });

    expect(duplicateResult).toBe('accepted');
    expect(duplicateOutput.parts).toEqual([]);
    expect(history.calls).toEqual(['ses_durable']);
  });

  it('defers after unavailable history and does not retry while a rescan is pending', async () => {
    const history = new MockRawHistoryAdapter({ ok: false });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    const existingPart = { type: 'text', text: 'User prompt.' };
    const output = { parts: [existingPart] };
    const input = {
      sessionID: 'ses_unavailable',
      messageID: 'msg_unavailable',
      matchedRules: [
        { relativePath: 'rules/core.md', content: 'Durable guidance.' },
      ],
      output,
    };

    await expect(delivery.deliverDurableTurn(input)).resolves.toBe('deferred');
    await expect(delivery.deliverDurableTurn(input)).resolves.toBe('deferred');
    expect(output.parts).toEqual([existingPart]);
    expect(history.calls).toEqual(['ses_unavailable']);
  });

  it('retains queued Hook content on identity deferral and appends it after matched rules', async () => {
    const history = new MockRawHistoryAdapter({
      ok: true,
      messages: [
        { parts: [buildHookInjectionPart('Already delivered Hook.')] },
      ],
    });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    delivery.queueMatchedHooks({
      sessionID: 'ses_hooks',
      hooks: [
        { content: 'Queued Hook.', lifetime: 'durable' },
        { content: 'Already delivered Hook.', lifetime: 'durable' },
        { content: 'Queued Hook.', lifetime: 'durable' },
      ],
    });
    const deferredOutput = { parts: [{ type: 'text', text: 'Prompt.' }] };

    const deferred = await delivery.deliverDurableTurn({
      sessionID: 'ses_hooks',
      matchedRules: [
        { relativePath: 'rules/core.md', content: 'Durable guidance.' },
      ],
      output: deferredOutput,
    });

    expect(deferred).toBe('deferred');
    expect(deferredOutput.parts).toEqual([{ type: 'text', text: 'Prompt.' }]);

    const acceptedOutput = { parts: [] };
    const accepted = await delivery.deliverDurableTurn({
      sessionID: 'ses_hooks',
      messageID: 'msg_hooks',
      matchedRules: [
        { relativePath: 'rules/core.md', content: 'Durable guidance.' },
      ],
      output: acceptedOutput,
    });

    expect(accepted).toBe('accepted');
    expect(acceptedOutput.parts).toEqual([
      {
        ...buildRulePart('rules/core.md', 'Durable guidance.'),
        sessionID: 'ses_hooks',
        messageID: 'msg_hooks',
      },
      {
        ...buildHookInjectionPart('Queued Hook.'),
        sessionID: 'ses_hooks',
        messageID: 'msg_hooks',
      },
    ]);
    expect(history.calls).toEqual(['ses_hooks']);
  });

  it('serializes concurrent durable turns so first-use history is read once', async () => {
    let releaseHistory: (() => void) | undefined;
    const historyReady = new Promise<void>(resolve => {
      releaseHistory = resolve;
    });
    const calls: string[] = [];
    const history: RawHistoryAdapter = {
      readHistory: async sessionID => {
        calls.push(sessionID);
        await historyReady;
        return { ok: true, messages: [] };
      },
    };
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    const firstOutput = { parts: [] };
    const secondOutput = { parts: [] };
    const matchedRules = [
      { relativePath: 'rules/core.md', content: 'Durable guidance.' },
    ];

    const first = delivery.deliverDurableTurn({
      sessionID: 'ses_concurrent',
      messageID: 'msg_first',
      matchedRules,
      output: firstOutput,
    });
    const second = delivery.deliverDurableTurn({
      sessionID: 'ses_concurrent',
      messageID: 'msg_second',
      matchedRules,
      output: secondOutput,
    });
    await Promise.resolve();

    expect(calls).toEqual(['ses_concurrent']);
    releaseHistory?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      'accepted',
      'accepted',
    ]);
    expect(firstOutput.parts).toHaveLength(1);
    expect(secondOutput.parts).toEqual([]);
    expect(calls).toEqual(['ses_concurrent']);
  });

  it('evicts least-recently-used session state and safely reseeds from history', async () => {
    const messagesBySession = new Map<string, readonly unknown[]>();
    const calls: string[] = [];
    const history: RawHistoryAdapter = {
      readHistory: async (sessionID: string) => {
        calls.push(sessionID);
        return {
          ok: true,
          messages: messagesBySession.get(sessionID) ?? [],
        };
      },
    };
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: history,
      maxSessions: 1,
    });
    const matchedRules = [
      { relativePath: 'rules/core.md', content: 'Durable guidance.' },
    ];
    const firstOutput = { parts: [] };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_first',
      messageID: 'msg_first',
      matchedRules,
      output: firstOutput,
    });
    messagesBySession.set('ses_first', [{ parts: firstOutput.parts }]);

    await delivery.deliverDurableTurn({
      sessionID: 'ses_second',
      messageID: 'msg_second',
      matchedRules: [],
      output: { parts: [] },
    });

    const reseededOutput = { parts: [] };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_first',
      messageID: 'msg_reseeded',
      matchedRules,
      output: reseededOutput,
    });

    expect(reseededOutput.parts).toEqual([]);
    expect(calls).toEqual(['ses_first', 'ses_second', 'ses_first']);
  });

  it('does not evict session state while its durable turn is in flight', async () => {
    let releaseFirstHistory: (() => void) | undefined;
    const firstHistoryBlocked = new Promise<void>(resolve => {
      releaseFirstHistory = resolve;
    });
    let markFirstHistoryStarted: (() => void) | undefined;
    const firstHistoryStarted = new Promise<void>(resolve => {
      markFirstHistoryStarted = resolve;
    });
    const calls: string[] = [];
    const history: RawHistoryAdapter = {
      readHistory: async (sessionID: string) => {
        calls.push(sessionID);
        if (sessionID === 'ses_in_flight') {
          markFirstHistoryStarted?.();
          await firstHistoryBlocked;
        }
        return { ok: true, messages: [] };
      },
    };
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: history,
      maxSessions: 1,
    });
    const matchedRules = [
      { relativePath: 'rules/core.md', content: 'Durable guidance.' },
    ];
    const firstTurn = delivery.deliverDurableTurn({
      sessionID: 'ses_in_flight',
      messageID: 'msg_first',
      matchedRules,
      output: { parts: [] },
    });
    await firstHistoryStarted;

    await delivery.deliverDurableTurn({
      sessionID: 'ses_other',
      messageID: 'msg_other',
      matchedRules: [],
      output: { parts: [] },
    });
    releaseFirstHistory?.();
    await firstTurn;

    const repeatedOutput = { parts: [] };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_in_flight',
      messageID: 'msg_repeated',
      matchedRules,
      output: repeatedOutput,
    });

    expect(repeatedOutput.parts).toEqual([]);
    expect(calls).toEqual(['ses_in_flight', 'ses_other']);
  });

  it('defers unexpected append failures without committing the ledger', async () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    const blockedParts: DeliveryPart[] = [];
    Object.freeze(blockedParts);
    const matchedRules = [
      { relativePath: 'rules/core.md', content: 'Durable guidance.' },
    ];

    await expect(
      delivery.deliverDurableTurn({
        sessionID: 'ses_append_failure',
        messageID: 'msg_blocked',
        matchedRules,
        output: { parts: blockedParts },
      })
    ).resolves.toBe('deferred');

    const retryOutput = { parts: [] };
    await expect(
      delivery.deliverDurableTurn({
        sessionID: 'ses_append_failure',
        messageID: 'msg_retry',
        matchedRules,
        output: retryOutput,
      })
    ).resolves.toBe('accepted');
    expect(retryOutput.parts).toHaveLength(1);
  });
});
