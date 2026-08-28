import { describe, expect, it } from 'vitest';
import {
  buildDurableHookPart,
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
    expect(buildDurableHookPart('Hook guidance.')).toEqual({
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
      messages: [{ parts: [buildDurableHookPart('Already delivered Hook.')] }],
    });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    delivery.queueMatchedHooks({
      sessionID: 'ses_hooks',
      hooks: [
        {
          relativePath: 'rules/queued.md',
          content: 'Queued Hook.',
          lifetime: 'durable',
        },
        {
          relativePath: 'rules/delivered.md',
          content: 'Already delivered Hook.',
          lifetime: 'durable',
        },
        {
          relativePath: 'rules/duplicate.md',
          content: 'Queued Hook.',
          lifetime: 'durable',
        },
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
        ...buildDurableHookPart('Queued Hook.'),
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

describe('RuleDelivery matched Hook queueing', () => {
  it('promotes durable owners, deduplicates by content, and preserves delivery order', async () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    await delivery.deliverDurableTurn({
      sessionID: 'ses_hook_queue',
      messageID: 'msg_owner',
      matchedRules: [
        { relativePath: 'rules/owner.md', content: 'Durable owner Hook.' },
      ],
      output: { parts: [] },
    });

    expect(
      delivery.queueMatchedHooks({
        sessionID: 'ses_hook_queue',
        hooks: [
          {
            relativePath: 'rules/owner.md',
            content: 'Durable owner Hook.',
            lifetime: 'ephemeral',
          },
          {
            relativePath: 'rules/transient.md',
            content: 'Transient Hook.',
            lifetime: 'ephemeral',
          },
          {
            relativePath: 'rules/durable-evidence.md',
            content: 'Evidence durable Hook.',
            lifetime: 'durable',
          },
          {
            relativePath: 'rules/duplicate.md',
            content: 'Transient Hook.',
            lifetime: 'durable',
          },
        ],
      })
    ).toBeUndefined();

    const messages = [
      {
        info: { id: 'msg_user', role: 'user' },
        parts: [{ type: 'text', text: 'Prompt.' }],
      },
    ];
    expect(
      delivery.deliverTransientDispatch({
        sessionID: 'ses_hook_queue',
        matchedRules: [],
        messages,
      })
    ).toBeUndefined();
    expect(messages.slice(1).map(message => message.parts[0]?.text)).toEqual([
      'Durable owner Hook.',
      'Evidence durable Hook.',
      'Transient Hook.',
    ]);

    const durableOutput = { parts: [] };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_hook_queue',
      messageID: 'msg_durable_hook',
      matchedRules: [],
      output: durableOutput,
    });
    expect(durableOutput.parts).toEqual([
      {
        ...buildDurableHookPart('Durable owner Hook.'),
        sessionID: 'ses_hook_queue',
        messageID: 'msg_durable_hook',
      },
      {
        ...buildDurableHookPart('Evidence durable Hook.'),
        sessionID: 'ses_hook_queue',
        messageID: 'msg_durable_hook',
      },
    ]);

    delivery.queueMatchedHooks({
      sessionID: 'ses_hook_queue',
      hooks: [
        {
          relativePath: 'rules/owner.md',
          content: 'Durable owner Hook.',
          lifetime: 'ephemeral',
        },
      ],
    });

    const nextMessages = [
      {
        info: { id: 'msg_next', role: 'user' },
        parts: [{ type: 'text', text: 'Next prompt.' }],
      },
    ];
    delivery.deliverTransientDispatch({
      sessionID: 'ses_hook_queue',
      matchedRules: [],
      messages: nextMessages,
    });
    expect(nextMessages).toHaveLength(1);
  });

  it('retains transient Hook content until a usable dispatch', () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    delivery.queueMatchedHooks({
      sessionID: 'ses_transient_retention',
      hooks: [
        {
          relativePath: 'rules/transient.md',
          content: 'Retained transient Hook.',
          lifetime: 'ephemeral',
        },
      ],
    });

    delivery.deliverTransientDispatch({
      sessionID: 'ses_transient_retention',
      matchedRules: [],
      messages: [],
    });
    const messages = [
      {
        info: { id: 'msg_user', role: 'user' },
        parts: [{ type: 'text', text: 'Prompt.' }],
      },
    ];
    delivery.deliverTransientDispatch({
      sessionID: 'ses_transient_retention',
      matchedRules: [],
      messages,
    });

    expect(messages[1]?.parts[0]?.text).toBe('Retained transient Hook.');
  });

  it('promotes an owner recovered from supplied dispatch history', async () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    delivery.queueMatchedHooks({
      sessionID: 'ses_recovered_owner',
      hooks: [
        {
          relativePath: 'rules/recovered.md',
          content: 'Recovered durable owner.',
          lifetime: 'ephemeral',
        },
      ],
    });
    const messages = [
      {
        info: { id: 'msg_user', role: 'user' },
        parts: [
          { type: 'text', text: 'Prompt.' },
          buildRulePart('rules/recovered.md', 'Recovered durable owner.'),
        ],
      },
    ];

    delivery.deliverTransientDispatch({
      sessionID: 'ses_recovered_owner',
      matchedRules: [],
      messages,
    });
    const output = { parts: [] };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_recovered_owner',
      messageID: 'msg_recovered_hook',
      matchedRules: [],
      output,
    });

    expect(output.parts).toEqual([
      {
        ...buildDurableHookPart('Recovered durable owner.'),
        sessionID: 'ses_recovered_owner',
        messageID: 'msg_recovered_hook',
      },
    ]);
  });
});

describe('RuleDelivery transient dispatches', () => {
  it('appends matched rules, durable Hook copies, and transient Hook content in order', async () => {
    const history = new MockRawHistoryAdapter({ ok: true, messages: [] });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    await delivery.deliverDurableTurn({
      sessionID: 'ses_transient',
      messageID: 'msg_durable',
      matchedRules: [
        { relativePath: 'rules/durable.md', content: 'Durable guidance.' },
      ],
      output: { parts: [] },
    });
    delivery.queueMatchedHooks({
      sessionID: 'ses_transient',
      hooks: [
        {
          relativePath: 'rules/durable-hook.md',
          content: 'Durable Hook guidance.',
          lifetime: 'durable',
        },
        {
          relativePath: 'rules/transient-hook.md',
          content: 'Transient Hook guidance.',
          lifetime: 'ephemeral',
        },
      ],
    });
    const messages = [
      {
        info: {
          id: 'msg_user',
          role: 'user',
          providerID: 'opencode-go',
          modelID: 'deepseek-v4-flash',
          custom: 'inherited',
        },
        parts: [{ type: 'text', text: 'Prompt.' }],
      },
      {
        info: {
          id: 'msg_rule_ephemeral_prior',
          role: 'user',
          providerID: 'wrong-provider',
          modelID: 'wrong-model',
        },
        parts: [
          { id: 'prt_rule_ephemeral_prior', type: 'text', text: 'Prior.' },
        ],
      },
    ];

    delivery.deliverTransientDispatch({
      sessionID: 'ses_transient',
      matchedRules: [
        { relativePath: 'rules/transient.md', content: 'Transient guidance.' },
        { relativePath: 'rules/transient.md', content: 'Transient guidance.' },
        { relativePath: 'rules/durable.md', content: 'Durable guidance.' },
      ],
      messages,
    });

    expect(messages.slice(2).map(message => message.parts[0]?.text)).toEqual([
      '# OpenCode transient rule: rules/transient.md\n\nTransient guidance.',
      'Durable Hook guidance.',
      'Transient Hook guidance.',
    ]);
    for (const message of messages.slice(2)) {
      expect(message.info).toMatchObject({
        role: 'user',
        providerID: 'opencode-go',
        modelID: 'deepseek-v4-flash',
        custom: 'inherited',
        model: {
          providerID: 'opencode-go',
          modelID: 'deepseek-v4-flash',
        },
      });
    }
  });

  it('consumes queued transient Hook content after a duplicate-only dispatch', () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    const hook = {
      relativePath: 'rules/transient-hook.md',
      content: 'Duplicate transient Hook.',
      lifetime: 'ephemeral' as const,
    };
    const messages = [
      {
        info: { id: 'msg_user', role: 'user' },
        parts: [{ type: 'text', text: 'Prompt.' }],
      },
    ];
    delivery.queueMatchedHooks({
      sessionID: 'ses_duplicate_queue',
      hooks: [hook],
    });
    delivery.deliverTransientDispatch({
      sessionID: 'ses_duplicate_queue',
      matchedRules: [],
      messages,
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.info).toHaveProperty('model');

    delivery.queueMatchedHooks({
      sessionID: 'ses_duplicate_queue',
      hooks: [hook],
    });
    delivery.deliverTransientDispatch({
      sessionID: 'ses_duplicate_queue',
      matchedRules: [],
      messages,
    });
    expect(messages).toHaveLength(2);

    const nextMessages = [
      {
        info: { id: 'msg_next', role: 'user' },
        parts: [{ type: 'text', text: 'Next prompt.' }],
      },
    ];
    delivery.deliverTransientDispatch({
      sessionID: 'ses_duplicate_queue',
      matchedRules: [],
      messages: nextMessages,
    });
    expect(nextMessages).toHaveLength(1);
  });

  it('replaces a pending rescan from supplied messages without reading history', async () => {
    const history = new MockRawHistoryAdapter({ ok: false });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    await delivery.deliverDurableTurn({
      sessionID: 'ses_rescan',
      messageID: 'msg_failed',
      matchedRules: [],
      output: { parts: [] },
    });
    const messages = [
      {
        info: { id: 'msg_user', role: 'user' },
        parts: [
          { type: 'text', text: 'Prompt.' },
          buildRulePart('rules/recovered.md', 'Recovered guidance.'),
        ],
      },
    ];

    delivery.deliverTransientDispatch({
      sessionID: 'ses_rescan',
      matchedRules: [
        { relativePath: 'rules/recovered.md', content: 'Recovered guidance.' },
        { relativePath: 'rules/current.md', content: 'Current guidance.' },
      ],
      messages,
    });

    expect(messages.slice(1).map(message => message.parts[0]?.text)).toEqual([
      '# OpenCode transient rule: rules/current.md\n\nCurrent guidance.',
    ]);
    await expect(
      delivery.deliverDurableTurn({
        sessionID: 'ses_rescan',
        messageID: 'msg_recovered',
        matchedRules: [],
        output: { parts: [] },
      })
    ).resolves.toBe('accepted');
    expect(history.calls).toEqual(['ses_rescan']);
  });
});

describe('RuleDelivery compaction invalidation', () => {
  it('defers durable delivery until dispatch history replaces the ledger', async () => {
    const history = new MockRawHistoryAdapter({ ok: true, messages: [] });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    const removedRule = {
      relativePath: 'rules/removed.md',
      content: 'Removed by compaction.',
    };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_compacted',
      messageID: 'msg_before_compaction',
      matchedRules: [removedRule],
      output: { parts: [] },
    });
    delivery.queueMatchedHooks({
      sessionID: 'ses_compacted',
      hooks: [
        {
          relativePath: 'rules/hook.md',
          content: 'Retained durable Hook.',
          lifetime: 'durable',
        },
      ],
    });

    expect(delivery.markCompacted('ses_compacted')).toBeUndefined();

    const deferredOutput = { parts: [] };
    await expect(
      delivery.deliverDurableTurn({
        sessionID: 'ses_compacted',
        messageID: 'msg_before_rescan',
        matchedRules: [removedRule],
        output: deferredOutput,
      })
    ).resolves.toBe('deferred');
    expect(deferredOutput.parts).toEqual([]);

    const survivingRule = {
      relativePath: 'rules/surviving.md',
      content: 'Survived compaction.',
    };
    const messages = [
      {
        info: { id: 'msg_after_compaction', role: 'user' },
        parts: [
          { type: 'text', text: 'Prompt after compaction.' },
          buildRulePart(survivingRule.relativePath, survivingRule.content),
        ],
      },
    ];
    delivery.deliverTransientDispatch({
      sessionID: 'ses_compacted',
      matchedRules: [removedRule, survivingRule],
      messages,
    });
    expect(messages.slice(1).map(message => message.parts[0]?.text)).toEqual([
      '# OpenCode transient rule: rules/removed.md\n\nRemoved by compaction.',
      'Retained durable Hook.',
    ]);

    const resumedOutput = { parts: [] };
    await expect(
      delivery.deliverDurableTurn({
        sessionID: 'ses_compacted',
        messageID: 'msg_after_rescan',
        matchedRules: [removedRule, survivingRule],
        output: resumedOutput,
      })
    ).resolves.toBe('accepted');
    expect(resumedOutput.parts).toEqual([
      {
        ...buildRulePart(removedRule.relativePath, removedRule.content),
        sessionID: 'ses_compacted',
        messageID: 'msg_after_rescan',
      },
      {
        ...buildDurableHookPart('Retained durable Hook.'),
        sessionID: 'ses_compacted',
        messageID: 'msg_after_rescan',
      },
    ]);
    expect(history.calls).toEqual(['ses_compacted']);
  });

  it('invalidates a durable history scan already in flight', async () => {
    let releaseHistory: (() => void) | undefined;
    const historyBlocked = new Promise<void>(resolve => {
      releaseHistory = resolve;
    });
    let markHistoryStarted: (() => void) | undefined;
    const historyStarted = new Promise<void>(resolve => {
      markHistoryStarted = resolve;
    });
    const history: RawHistoryAdapter = {
      readHistory: async () => {
        markHistoryStarted?.();
        await historyBlocked;
        return { ok: true, messages: [] };
      },
    };
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    const output = { parts: [] };
    const durableTurn = delivery.deliverDurableTurn({
      sessionID: 'ses_compacted_in_flight',
      messageID: 'msg_in_flight',
      matchedRules: [
        { relativePath: 'rules/core.md', content: 'Durable guidance.' },
      ],
      output,
    });
    await historyStarted;

    delivery.markCompacted('ses_compacted_in_flight');
    releaseHistory?.();

    await expect(durableTurn).resolves.toBe('deferred');
    expect(output.parts).toEqual([]);
  });
});
