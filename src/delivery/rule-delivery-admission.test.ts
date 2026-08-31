import { describe, it, expect } from 'vitest';
import type { DeliveryPart } from './rule-delivery-codec.js';
import { ruleKeyFor } from './rule-delivery-codec.js';
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

const ruleA = {
  relativePath: 'rules/rust-unsafe.md',
  content: 'Unsafe guidance.',
};

function makeHarness(history: RawHistoryResult = { ok: true, messages: [] }): {
  delivery: RuleDelivery;
  persisted: DeliveryPart[];
  persist: (
    impl: (sessionID: string, part: DeliveryPart) => Promise<void>
  ) => void;
} {
  const persisted: DeliveryPart[] = [];
  let impl: (
    sessionID: string,
    part: DeliveryPart
  ) => Promise<void> = async () => undefined;
  const delivery = createRuleDelivery({
    rawHistory: new MockRawHistoryAdapter(history),
    persistAdmission: async (sessionID, part) => {
      await impl(sessionID, part);
      persisted.push(part);
    },
  });
  return {
    delivery,
    persisted,
    persist: next => {
      impl = next;
    },
  };
}

const ADMISSION_RULE_KEYS = [ruleKeyFor('rules/rust-unsafe.md')];

describe('durable admission', () => {
  it('persists admitted rules once with admission metadata', async () => {
    const harness = makeHarness();
    harness.persist(async () => undefined);

    const result = await harness.delivery.admitDurableMatches({
      sessionID: 'ses_admit',
      rules: [
        ruleA,
        { relativePath: 'rules/rust-unsafe.md', content: 'Duplicate body.' },
      ],
    });

    expect(result).toBe('accepted');
    expect(harness.persisted).toHaveLength(1);
    const part = harness.persisted[0]!;
    expect(part.sessionID).toBe('ses_admit');
    expect(part.synthetic).toBe(true);
    expect(part.type).toBe('text');
    expect(part.metadata?.ruleKeys).toEqual(ADMISSION_RULE_KEYS);
    expect(part.metadata?.ruleAdmission).toBe(true);
    expect(part.text).toContain('Unsafe guidance.');
  });

  it('coalesces concurrent matching observations into one delivery', async () => {
    const harness = makeHarness();
    harness.persist(async () => undefined);

    const results = await Promise.all([
      harness.delivery.admitDurableMatches({
        sessionID: 'ses_coalesce',
        rules: [ruleA],
      }),
      harness.delivery.admitDurableMatches({
        sessionID: 'ses_coalesce',
        rules: [ruleA],
      }),
    ]);

    expect(results).toEqual(['accepted', 'duplicate']);
    expect(harness.persisted).toHaveLength(1);
    await harness.delivery.retryPendingAdmissions('ses_coalesce');
    expect(harness.persisted).toHaveLength(1);
  });

  it('retains pending rules on persistence failure and retries succeed', async () => {
    const harness = makeHarness();
    let attempts = 0;
    harness.persist(async () => {
      attempts++;
      if (attempts === 1) throw new Error('persistence unavailable');
    });

    const failed = await harness.delivery.admitDurableMatches({
      sessionID: 'ses_retry',
      rules: [ruleA],
    });
    expect(failed).toBe('pending');
    expect(harness.persisted).toHaveLength(0);

    // The next durable dispatch retries the retained pending rules.
    await harness.delivery.retryPendingAdmissions('ses_retry');
    expect(attempts).toBe(2);
    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0]?.metadata?.ruleKeys).toEqual(
      ADMISSION_RULE_KEYS
    );

    // Delivered: a later matching observation is a duplicate.
    const duplicate = await harness.delivery.admitDurableMatches({
      sessionID: 'ses_retry',
      rules: [ruleA],
    });
    expect(duplicate).toBe('duplicate');
  });

  it('marks admitted rules delivered so later matches are duplicates', async () => {
    const harness = makeHarness();
    harness.persist(async () => undefined);

    await harness.delivery.admitDurableMatches({
      sessionID: 'ses_once',
      rules: [ruleA],
    });
    const second = await harness.delivery.admitDurableMatches({
      sessionID: 'ses_once',
      rules: [ruleA],
    });
    expect(second).toBe('duplicate');
    expect(harness.persisted).toHaveLength(1);
  });

  it('keeps admission pending and delivers it transiently without a persistence adapter', async () => {
    const delivery = createRuleDelivery({
      rawHistory: new MockRawHistoryAdapter({ ok: true, messages: [] }),
    });
    expect(
      await delivery.admitDurableMatches({
        sessionID: 'ses_no_adapter',
        rules: [ruleA],
      })
    ).toBe('pending');

    const messages = [
      {
        info: {
          role: 'user',
          id: 'msg_no_adapter',
          sessionID: 'ses_no_adapter',
        },
        parts: [{ type: 'text', text: 'continue' }],
      },
    ];
    delivery.deliverTransientDispatch({
      sessionID: 'ses_no_adapter',
      matchedRules: [],
      messages: messages as never,
    });
    expect(JSON.stringify(messages)).toContain(ruleA.content);
  });
});
