import { describe, expect, it } from 'vitest';
import {
  classifyRuleLifetime,
  matchRuleSnapshots,
  type RuleConditionKind,
} from './rule-filter.js';
import type { RuleSnapshot } from './rule-discovery.js';
import type { RuleMetadata } from './rule-metadata.js';

const snapshot = (
  metadata: RuleMetadata | null,
  relativePath = 'test.mdc'
): RuleSnapshot => ({
  filePath: `/rules/${relativePath}`,
  relativePath,
  name: relativePath.replace(/\.(?:md|mdc)$/i, ''),
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

describe('matchRuleSnapshots condition semantics (live delivery)', () => {
  it('matches keyword conditions case-insensitively against the prompt', () => {
    const entries = matchRuleSnapshots(
      [
        snapshot({ keywords: ['testing'] }, 'kw-match.mdc'),
        snapshot({ keywords: ['database'] }, 'kw-skip.mdc'),
      ],
      { userPrompt: 'Please add TESTING for this module' }
    );

    expect(entries.map(entry => entry.relativePath)).toEqual(['kw-match.mdc']);
    expect(entries[0]?.lifetime).toBe('durable');
  });

  it('does not match keywords mid-word', () => {
    const entries = matchRuleSnapshots([snapshot({ keywords: ['test'] })], {
      userPrompt: 'latest results',
    });

    expect(entries).toEqual([]);
  });

  it('matches tool conditions against available tool IDs only', () => {
    const snapshots = [
      snapshot({ tools: ['mcp_websearch'] }, 'web.mdc'),
      snapshot({ tools: ['mcp_context7'] }, 'ctx.mdc'),
    ];

    const matched = matchRuleSnapshots(snapshots, {
      availableToolIDs: ['read', 'mcp_websearch'],
    });
    expect(matched.map(entry => entry.relativePath)).toEqual(['web.mdc']);
    expect(matched[0]?.lifetime).toBe('ephemeral');

    expect(matchRuleSnapshots(snapshots, {})).toEqual([]);
  });

  it('matches path-glob conditions, including matchBase for slash-free patterns', () => {
    const scoped = [
      snapshot({ globs: ['src/components/**/*.tsx'] }, 'tsx.mdc'),
    ];

    const [matched] = matchRuleSnapshots(scoped, {
      contextFilePaths: ['src/components/Button.tsx'],
    });
    expect(matched?.relativePath).toBe('tsx.mdc');
    expect(matched?.lifetime).toBe('durable');

    expect(
      matchRuleSnapshots(scoped, { contextFilePaths: ['src/utils.ts'] })
    ).toEqual([]);

    const baseOnly = [snapshot({ globs: ['Button.tsx'] }, 'base.mdc')];
    expect(
      matchRuleSnapshots(baseOnly, {
        contextFilePaths: ['src/components/Button.tsx'],
      }).map(entry => entry.relativePath)
    ).toEqual(['base.mdc']);
  });

  it('matches model, agent, and command conditions', () => {
    const entries = matchRuleSnapshots(
      [
        snapshot({ model: ['claude-opus'] }, 'model.mdc'),
        snapshot({ agent: ['programmer'] }, 'agent.mdc'),
        snapshot({ command: ['/plan'] }, 'command.mdc'),
        snapshot({ model: ['gpt-5'] }, 'miss.mdc'),
      ],
      {
        modelID: 'claude-opus',
        agentType: 'programmer',
        command: '/plan',
      }
    );

    expect(entries.map(entry => entry.relativePath)).toEqual([
      'model.mdc',
      'agent.mdc',
      'command.mdc',
    ]);
    expect(entries.map(entry => entry.lifetime)).toEqual([
      'ephemeral',
      'ephemeral',
      'durable',
    ]);
  });

  it('defaults to match: any across mixed durable and ephemeral conditions', () => {
    const entries = matchRuleSnapshots(
      [
        snapshot(
          { globs: ['**/*.ts'], model: ['claude-opus'] },
          'mixed-any.mdc'
        ),
      ],
      { contextFilePaths: ['src/index.ts'], modelID: 'gpt-5' }
    );

    expect(entries.map(entry => entry.lifetime)).toEqual(['durable']);
  });

  it('requires every condition under match: all and stays ephemeral for ephemeral parts', () => {
    const snapshots = [
      snapshot(
        { keywords: ['refactor'], agent: ['programmer'], match: 'all' },
        'all.mdc'
      ),
    ];

    const matched = matchRuleSnapshots(snapshots, {
      userPrompt: 'help me refactor this',
      agentType: 'programmer',
    });
    expect(matched).toHaveLength(1);
    expect(matched[0]?.lifetime).toBe('ephemeral');

    expect(
      matchRuleSnapshots(snapshots, {
        userPrompt: 'help me refactor this',
        agentType: 'reviewer',
      })
    ).toEqual([]);
  });

  it('always includes unconditional rules regardless of context', () => {
    const entries = matchRuleSnapshots(
      [snapshot(null, 'always.md'), snapshot({ model: ['gpt-5'] }, 'cond.mdc')],
      { modelID: 'claude-opus' }
    );

    expect(entries.map(entry => entry.relativePath)).toEqual(['always.md']);
    expect(entries[0]?.conditionResults).toEqual([]);
    expect(entries[0]?.lifetime).toBe('durable');
  });

  it('exposes matched rule content for delivery', () => {
    const entries = matchRuleSnapshots(
      [
        {
          ...snapshot({ keywords: ['deploy'] }, 'deploy.mdc'),
          strippedContent: 'Ship carefully.',
        },
      ],
      { userPrompt: 'ready to deploy' }
    );

    expect(entries[0]?.strippedContent).toBe('Ship carefully.');
    expect(entries[0]?.name).toBe('deploy');
  });
});
