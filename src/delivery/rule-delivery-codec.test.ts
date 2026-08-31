import { describe, expect, it } from 'vitest';
import {
  buildDurableDeliveryPart,
  buildTransientDeliveryMessage,
  decodeRawHistory,
  decodeTransientPresence,
  ruleKeyFor,
} from './rule-delivery-codec.js';

const durable = buildDurableDeliveryPart(
  [{ relativePath: 'rules/durable.md', content: 'Durable guidance.' }],
  [{ relativePath: 'rules/hook.md', content: 'Hook guidance.' }],
  { sessionID: 'ses_codec', messageID: 'msg_owner' }
);
const transient = buildTransientDeliveryMessage(
  [{ relativePath: 'rules/transient.md', content: 'Transient guidance.' }],
  [],
  { id: 'msg_user', role: 'user' }
);
const durableRuleKey = ruleKeyFor('rules/durable.md');
const hookKey = ruleKeyFor('rules/hook.md');
const transientRuleKey = ruleKeyFor('rules/transient.md');

// Legacy persisted durable forms, produced by pre-release development builds:
// the ledger must accept them, Transient presence must not.
function legacyPersistedForms(): Record<string, unknown>[] {
  return [
    {
      id: 'prt_legacy_top_level',
      type: 'text',
      synthetic: true,
      ruleKeys: ['legacy-top-rule'],
      hookKeys: ['legacy-top-hook'],
    },
    {
      type: 'text',
      synthetic: true,
      text: '## rules/legacy-header.md\n\nLegacy header guidance.',
    },
  ];
}

describe('codec durable ledger decode', () => {
  it('includes canonical metadata keys and both legacy persisted forms', () => {
    const facts = decodeRawHistory([
      { parts: [durable] },
      { parts: legacyPersistedForms() },
    ]);

    expect(facts.ruleKeys).toEqual(
      new Set([
        durableRuleKey,
        'legacy-top-rule',
        ruleKeyFor('rules/legacy-header.md'),
      ])
    );
    expect(facts.hookKeys).toEqual(new Set([hookKey, 'legacy-top-hook']));
  });

  it('excludes Transient delivery parts and does not collect identifiers', () => {
    const facts = decodeRawHistory([
      { info: { id: 'msg_ephemeral' }, parts: [transient.parts[0]!] },
    ]);

    expect(facts.ruleKeys.size).toBe(0);
    expect(facts.hookKeys.size).toBe(0);
  });

  it('skips malformed messages instead of aborting', () => {
    const facts = decodeRawHistory([
      null,
      42,
      { parts: 'not-a-part-array' },
      { parts: [null, 'not-a-part', durable] },
    ]);

    expect(facts.ruleKeys).toEqual(new Set([durableRuleKey]));
  });
});

describe('codec transient presence facts', () => {
  it('includes canonical keys from durable and Transient delivery parts', () => {
    const facts = decodeTransientPresence([
      { parts: [durable] },
      { info: transient.info, parts: transient.parts },
    ]);

    expect(facts.ruleKeys).toEqual(new Set([durableRuleKey, transientRuleKey]));
    expect(facts.hookKeys).toEqual(new Set([hookKey]));
  });

  it('collects message identifiers and part identifiers', () => {
    const facts = decodeTransientPresence([
      { info: { id: 'msg_user' }, parts: [{ type: 'text', text: 'Prompt.' }] },
      { info: transient.info, parts: transient.parts },
      { parts: [durable] },
    ]);

    expect(facts.ids).toEqual(
      new Set([
        'msg_user',
        transient.info.id,
        transient.parts[0]!.id,
        durable.id,
      ])
    );
  });

  it('excludes legacy top-level key arrays and legacy rule header text', () => {
    const facts = decodeTransientPresence([{ parts: legacyPersistedForms() }]);

    expect(facts.ruleKeys.size).toBe(0);
    expect(facts.hookKeys.size).toBe(0);
  });

  it('ignores malformed parts while reading presence', () => {
    const facts = decodeTransientPresence([
      { parts: [null, 'not-a-part', ['nested'], { metadata: 'not-a-record' }] },
    ]);

    expect(facts.ids.size).toBe(0);
    expect(facts.ruleKeys.size).toBe(0);
    expect(facts.hookKeys.size).toBe(0);
  });

  it('aborts on malformed messages: hardening is deferred, unlike the ledger', () => {
    expect(() => decodeTransientPresence([null as never])).toThrow(TypeError);
  });
});
