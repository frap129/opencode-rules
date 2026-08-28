import { describe, expect, it } from 'vitest';
import {
  buildDurableDeliveryPart,
  buildTransientDeliveryMessage,
  type DeliveryPart,
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

describe('RuleDelivery durable turns', () => {
  it('frames each delivery event once and labels rules by short name', async () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    const output: { parts: DeliveryPart[] } = { parts: [] };

    await delivery.deliverDurableTurn({
      sessionID: 'ses_framed',
      messageID: 'msg_framed',
      matchedRules: [
        {
          relativePath: 'nested/first.md',
          name: 'Custom rule',
          content: 'First guidance.',
        },
        {
          relativePath: 'nested/second.mdc',
          name: 'second',
          content: '## Body heading\n\nSecond guidance.',
        },
      ],
      output,
    });

    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]?.text).toBe(
      '<system-message>\n' +
        'The following rules were injected by a plugin. Follow them silently; do not acknowledge them to the user.\n\n' +
        '<rule name="Custom rule">\nFirst guidance.\n</rule>\n\n' +
        '<rule name="second">\n## Body heading\n\nSecond guidance.\n</rule>\n' +
        '</system-message>'
    );
    expect(output.parts[0]?.text).not.toContain('nested/');
  });

  it('seeds once, appends new matched rules in order, and accepts duplicate-only turns', async () => {
    const history = new MockRawHistoryAdapter({
      ok: true,
      messages: [
        {
          parts: [
            buildDurableDeliveryPart(
              [
                {
                  relativePath: 'rules/existing.md',
                  content: 'Existing guidance.',
                },
              ],
              [],
              { sessionID: 'ses_durable', messageID: 'msg_existing' }
            ),
          ],
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
      buildDurableDeliveryPart(
        [
          { relativePath: 'rules/first.md', content: 'First guidance.' },
          { relativePath: 'rules/second.md', content: 'Second guidance.' },
        ],
        [],
        { sessionID: 'ses_durable', messageID: 'msg_first' }
      ),
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

  it('rebuilds the ledger after a delivered message is removed', async () => {
    const history: RawHistoryAdapter = {
      readHistory: async () => ({ ok: true, messages: [] }),
    };
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    const rule = {
      relativePath: 'conventional-commits.md',
      content: 'Use Conventional Commits.',
    };
    const firstOutput: { parts: DeliveryPart[] } = { parts: [] };

    await delivery.deliverDurableTurn({
      sessionID: 'ses_removed',
      messageID: 'msg_removed',
      matchedRules: [rule],
      output: firstOutput,
    });
    expect(firstOutput.parts).toHaveLength(1);

    delivery.markHistoryChanged('ses_removed');
    const replacementOutput: { parts: DeliveryPart[] } = { parts: [] };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_removed',
      messageID: 'msg_replacement',
      matchedRules: [rule],
      output: replacementOutput,
    });

    expect(replacementOutput.parts).toHaveLength(1);
    expect(replacementOutput.parts[0]?.text).toContain(
      'Use Conventional Commits.'
    );
  });

  it('appends deterministic identities and exact durable formats through the interface', async () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    const output: { parts: DeliveryPart[] } = { parts: [] };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_identity',
      messageID: 'msg_identity',
      matchedRules: [
        { relativePath: 'rules/core.md', content: 'Durable guidance.' },
      ],
      output,
    });
    delivery.queueMatchedHooks({
      sessionID: 'ses_identity',
      hooks: [
        {
          relativePath: 'rules/hook.md',
          content: 'Hook guidance.',
          lifetime: 'durable',
        },
      ],
    });
    await delivery.deliverDurableTurn({
      sessionID: 'ses_identity',
      messageID: 'msg_identity_2',
      matchedRules: [],
      output,
    });

    expect(output.parts).toEqual([
      buildDurableDeliveryPart(
        [{ relativePath: 'rules/core.md', content: 'Durable guidance.' }],
        [],
        { sessionID: 'ses_identity', messageID: 'msg_identity' }
      ),
      buildDurableDeliveryPart(
        [],
        [{ relativePath: 'rules/hook.md', content: 'Hook guidance.' }],
        { sessionID: 'ses_identity', messageID: 'msg_identity_2' }
      ),
    ]);
  });

  it('deduplicates a resumed rule by path after its content changes', async () => {
    const delivered = buildDurableDeliveryPart(
      [{ relativePath: 'rules/edited.md', content: 'Old content.' }],
      [],
      { sessionID: 'ses_edited', messageID: 'msg_old' }
    );
    const persistedPart = {
      id: delivered.id,
      sessionID: delivered.sessionID,
      messageID: delivered.messageID,
      type: delivered.type,
      text: delivered.text,
      synthetic: delivered.synthetic,
      metadata: delivered.metadata,
    };
    const history = new MockRawHistoryAdapter({
      ok: true,
      messages: [
        {
          parts: [persistedPart],
        },
      ],
    });
    const delivery = createRuleDelivery({ rawHistory: history });
    const output: { parts: DeliveryPart[] } = { parts: [] };

    await delivery.deliverDurableTurn({
      sessionID: 'ses_edited',
      messageID: 'msg_new',
      matchedRules: [
        { relativePath: 'rules/edited.md', content: 'New content.' },
      ],
      output,
    });

    expect(output.parts).toEqual([]);
  });

  it('keeps rules with the same relative path but different identities distinct', async () => {
    const history = new MockRawHistoryAdapter({
      ok: true,
      messages: [
        {
          parts: [
            buildDurableDeliveryPart(
              [
                {
                  identity: '/global/rules/shared.md',
                  relativePath: 'shared.md',
                  content: 'Global guidance.',
                },
              ],
              [],
              { sessionID: 'ses_distinct', messageID: 'msg_global' }
            ),
          ],
        },
      ],
    });
    const delivery = createRuleDelivery({ rawHistory: history });
    const output: { parts: DeliveryPart[] } = { parts: [] };

    await delivery.deliverDurableTurn({
      sessionID: 'ses_distinct',
      messageID: 'msg_project',
      matchedRules: [
        {
          identity: '/project/.opencode/rules/shared.md',
          relativePath: 'shared.md',
          content: 'Project guidance.',
        },
      ],
      output,
    });

    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]?.text).toContain('Project guidance.');
  });

  it('scopes durable part identities to their owning message', async () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    const outputs: { parts: DeliveryPart[] }[] = [{ parts: [] }, { parts: [] }];
    const owners = [
      { sessionID: 'ses_owner_one', messageID: 'msg_owner_one' },
      { sessionID: 'ses_owner_two', messageID: 'msg_owner_two' },
    ];

    for (const [index, owner] of owners.entries()) {
      delivery.queueMatchedHooks({
        sessionID: owner.sessionID,
        hooks: [
          {
            relativePath: 'rules/hook.md',
            content: 'Shared Hook guidance.',
            lifetime: 'durable',
          },
        ],
      });
      await delivery.deliverDurableTurn({
        ...owner,
        matchedRules: [
          { relativePath: 'rules/core.md', content: 'Shared rule guidance.' },
        ],
        output: outputs[index]!,
      });
    }

    expect(outputs[0]!.parts.map(part => part.id)).not.toEqual(
      outputs[1]!.parts.map(part => part.id)
    );
  });

  it('recognizes legacy ID-less durable markers and ignores malformed history', async () => {
    const history = new MockRawHistoryAdapter({
      ok: true,
      messages: [
        42,
        null,
        { info: { role: 'user' } },
        {
          info: { role: 'user' },
          parts: [
            null,
            'not-a-part',
            { type: 'text', text: 'Plain user text.' },
            {
              type: 'text',
              synthetic: true,
              text: '## rules/legacy.md\n\nLegacy guidance.',
            },
            {
              id: 'prt_rules_zzz',
              type: 'text',
              synthetic: true,
              text: 'not a rule header',
            },
          ],
        },
        {
          parts: [
            { id: 'prt_hook_transient_zzz', type: 'text', text: 'Transient.' },
          ],
        },
      ],
    });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    const output = { parts: [] };

    await expect(
      delivery.deliverDurableTurn({
        sessionID: 'ses_legacy',
        messageID: 'msg_legacy',
        matchedRules: [
          { relativePath: 'rules/legacy.md', content: 'Legacy guidance.' },
          { relativePath: 'rules/fresh.md', content: 'Fresh guidance.' },
        ],
        output,
      })
    ).resolves.toBe('accepted');

    expect(output.parts).toEqual([
      buildDurableDeliveryPart(
        [{ relativePath: 'rules/fresh.md', content: 'Fresh guidance.' }],
        [],
        { sessionID: 'ses_legacy', messageID: 'msg_legacy' }
      ),
    ]);
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
        {
          parts: [
            buildDurableDeliveryPart(
              [],
              [
                {
                  relativePath: 'rules/delivered.md',
                  content: 'Already delivered Hook.',
                },
              ],
              {
                sessionID: 'ses_hooks',
                messageID: 'msg_existing_hook',
              }
            ),
          ],
        },
      ],
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
      buildDurableDeliveryPart(
        [{ relativePath: 'rules/core.md', content: 'Durable guidance.' }],
        [
          { relativePath: 'rules/queued.md', content: 'Queued Hook.' },
          { relativePath: 'rules/duplicate.md', content: 'Queued Hook.' },
        ],
        { sessionID: 'ses_hooks', messageID: 'msg_hooks' }
      ),
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
  it('promotes durable owners, deduplicates by identity, and preserves delivery order', async () => {
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
    const deliveredHooks = [
      {
        relativePath: 'rules/owner.md',
        content: 'Durable owner Hook.',
      },
      {
        relativePath: 'rules/durable-evidence.md',
        content: 'Evidence durable Hook.',
      },
      {
        relativePath: 'rules/duplicate.md',
        content: 'Transient Hook.',
      },
      {
        relativePath: 'rules/transient.md',
        content: 'Transient Hook.',
      },
    ];
    expect(messages.slice(1).map(message => message.parts[0]?.text)).toEqual([
      buildTransientDeliveryMessage([], deliveredHooks, {}).parts[0]!.text,
    ]);

    const durableOutput = { parts: [] };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_hook_queue',
      messageID: 'msg_durable_hook',
      matchedRules: [],
      output: durableOutput,
    });
    expect(durableOutput.parts).toEqual([
      buildDurableDeliveryPart([], deliveredHooks.slice(0, 3), {
        sessionID: 'ses_hook_queue',
        messageID: 'msg_durable_hook',
      }),
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
    expect(nextMessages).toHaveLength(2);
    expect(nextMessages[1]?.parts[0]?.text).toBe(
      buildTransientDeliveryMessage([], [deliveredHooks[0]!], {}).parts[0]!.text
    );

    const durableRetry = { parts: [] };
    await delivery.deliverDurableTurn({
      sessionID: 'ses_hook_queue',
      messageID: 'msg_retry',
      matchedRules: [],
      output: durableRetry,
    });
    expect(durableRetry.parts).toEqual([]);
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

    expect(messages[1]?.parts[0]?.text).toBe(
      buildTransientDeliveryMessage(
        [],
        [
          {
            relativePath: 'rules/transient.md',
            content: 'Retained transient Hook.',
          },
        ],
        {}
      ).parts[0]!.text
    );
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
          buildDurableDeliveryPart(
            [
              {
                relativePath: 'rules/recovered.md',
                content: 'Recovered durable owner.',
              },
            ],
            [],
            { sessionID: 'ses_recovered_owner', messageID: 'msg_user' }
          ),
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
      buildDurableDeliveryPart(
        [],
        [
          {
            relativePath: 'rules/recovered.md',
            content: 'Recovered durable owner.',
          },
        ],
        {
          sessionID: 'ses_recovered_owner',
          messageID: 'msg_recovered_hook',
        }
      ),
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
      buildTransientDeliveryMessage(
        [
          {
            relativePath: 'rules/transient.md',
            content: 'Transient guidance.',
          },
        ],
        [
          {
            relativePath: 'rules/durable-hook.md',
            content: 'Durable Hook guidance.',
          },
          {
            relativePath: 'rules/transient-hook.md',
            content: 'Transient Hook guidance.',
          },
        ],
        {}
      ).parts[0]!.text,
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

  it('aborts a dispatch on a malformed message without appending, as before', () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    const messages = [
      null as unknown as { info: Record<string, unknown>; parts: unknown[] },
      {
        info: { id: 'msg_user', role: 'user' },
        parts: [{ type: 'text', text: 'Prompt.' }],
      },
    ];

    expect(() =>
      delivery.deliverTransientDispatch({
        sessionID: 'ses_malformed',
        matchedRules: [
          { relativePath: 'rules/transient.md', content: 'Transient.' },
        ],
        messages,
      })
    ).not.toThrow();
    expect(messages).toHaveLength(2);
  });

  it('falls back to the last message info and synthesizes a model object when no real user message exists', () => {
    const delivery: RuleDelivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    delivery.queueMatchedHooks({
      sessionID: 'ses_no_user',
      hooks: [
        {
          relativePath: 'rules/hook.md',
          content: 'Fallback Hook guidance.',
          lifetime: 'ephemeral',
        },
      ],
    });
    const messages = [
      {
        info: {
          id: 'msg_asst_1',
          role: 'assistant',
          providerID: 'opencode-go',
          modelID: 'deepseek-v4-flash',
        },
        parts: [{ type: 'text', text: 'thinking...' }],
      },
    ];

    delivery.deliverTransientDispatch({
      sessionID: 'ses_no_user',
      matchedRules: [],
      messages,
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.info).toMatchObject({
      role: 'user',
      id: expect.stringMatching(/^msg_rule_ephemeral_/),
      model: { providerID: 'opencode-go', modelID: 'deepseek-v4-flash' },
    });
  });

  it('seeds or replaces the ledger from supplied messages even without a usable target', async () => {
    const history = new MockRawHistoryAdapter({ ok: false });
    const delivery: RuleDelivery = createRuleDelivery({ rawHistory: history });
    await delivery.deliverDurableTurn({
      sessionID: 'ses_gateless_seed',
      messageID: 'msg_failed',
      matchedRules: [],
      output: { parts: [] },
    });

    // No usable transform target: the dispatch must still replace the
    // ledger from supplied messages (pre-migration rescan ran regardless).
    delivery.deliverTransientDispatch({
      sessionID: 'ses_gateless_seed',
      matchedRules: [],
      messages: [],
    });

    await expect(
      delivery.deliverDurableTurn({
        sessionID: 'ses_gateless_seed',
        messageID: 'msg_after',
        matchedRules: [],
        output: { parts: [] },
      })
    ).resolves.toBe('accepted');
    expect(history.calls).toEqual(['ses_gateless_seed']);
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
          buildDurableDeliveryPart(
            [
              {
                relativePath: 'rules/recovered.md',
                content: 'Recovered guidance.',
              },
            ],
            [],
            { sessionID: 'ses_rescan', messageID: 'msg_user' }
          ),
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
      buildTransientDeliveryMessage(
        [{ relativePath: 'rules/current.md', content: 'Current guidance.' }],
        [],
        {}
      ).parts[0]!.text,
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
