import { describe, expect, it } from 'vitest';
import {
  classifyRuleLifetime,
  matchRuleSnapshots,
  type RuleConditionKind,
} from './rule-filter.js';
import type { RuleSnapshot } from './rule-discovery.js';
import type { RuleMetadata } from './rule-metadata.js';

const snapshot = (metadata: RuleMetadata | null): RuleSnapshot => ({
  filePath: '/rules/test.mdc',
  relativePath: 'test.mdc',
  metadata,
  strippedContent: 'body',
});

describe('rule lifetime classification', () => {
  it.each([
    ['globs', 'durable'],
    ['keywords', 'durable'],
    ['command', 'durable'],
    ['project', 'durable'],
    ['os', 'durable'],
    ['ci', 'durable'],
    ['agent', 'ephemeral'],
    ['model', 'ephemeral'],
    ['branch', 'ephemeral'],
    ['tools', 'ephemeral'],
  ] as Array<[RuleConditionKind, 'durable' | 'ephemeral']>)(
    '%s is %s',
    (kind, expected) => {
      expect(
        classifyRuleLifetime('any', [
          { kind, matched: true, lifetime: expected },
        ])
      ).toBe(expected);
    }
  );

  it('classifies an unconditional rule as durable', () => {
    expect(classifyRuleLifetime('any', [])).toBe('durable');
  });

  it('uses the durable condition for a mixed any rule', () => {
    const [entry] = matchRuleSnapshots(
      [
        snapshot({
          globs: ['src/**/*.ts'],
          agent: ['plan'],
          match: 'any',
        }),
      ],
      { contextFilePaths: ['src/index.ts'], agentType: 'plan' }
    );

    expect(entry?.lifetime).toBe('durable');
    expect(entry?.conditionResults).toEqual([
      { kind: 'globs', matched: true, lifetime: 'durable' },
      { kind: 'agent', matched: true, lifetime: 'ephemeral' },
    ]);
  });

  it('classifies a mixed any rule as ephemeral when only the agent matches', () => {
    const [entry] = matchRuleSnapshots(
      [snapshot({ globs: ['src/**/*.ts'], agent: ['plan'] })],
      { contextFilePaths: ['README.md'], agentType: 'plan' }
    );

    expect(entry?.lifetime).toBe('ephemeral');
  });

  it('classifies match all as ephemeral when a required condition is ephemeral', () => {
    expect(
      classifyRuleLifetime('all', [
        { kind: 'keywords', matched: true, lifetime: 'durable' },
        { kind: 'agent', matched: true, lifetime: 'ephemeral' },
      ])
    ).toBe('ephemeral');
  });
});
