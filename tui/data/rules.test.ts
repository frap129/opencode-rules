import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { clearRuleCache } from '../../src/rules/rule-discovery.js';
import { parsePluginOptions } from '../../src/config/plugin-options.js';
import {
  classifyRuleScope,
  hasConditions,
  formatConditionSummary,
  formatRuleDetail,
  disambiguateNames,
  loadSidebarRules,
  type SidebarRuleEntry,
} from './rules.js';

const originalDebugEnv = vi.hoisted(() => {
  const value = process.env.OPENCODE_RULES_DEBUG;
  delete process.env.OPENCODE_RULES_DEBUG;
  return value;
});

afterAll(() => {
  if (originalDebugEnv === undefined) {
    delete process.env.OPENCODE_RULES_DEBUG;
  } else {
    process.env.OPENCODE_RULES_DEBUG = originalDebugEnv;
  }
});

interface RuleFixture {
  root(): string;
  dir(...segments: string[]): string;
  globalDir(): string;
  writeRule(dir: string, name: string, contents?: string): string;
}

// Isolates the discovery sources for the duration of a suite: its own XDG
// config tree, its own HOME for `~` expansion, and no ambient
// OPENCODE_CONFIG_DIR. Call inside a describe body.
function useRuleFixture(prefix: string): RuleFixture {
  const envKeys = ['XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR', 'HOME'] as const;
  const saved: Partial<Record<(typeof envKeys)[number], string>> = {};
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), prefix));
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env['XDG_CONFIG_HOME'] = path.join(root, '.config');
    clearRuleCache();
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  const dir = (...segments: string[]): string => path.join(root, ...segments);
  return {
    root: () => root,
    dir,
    globalDir: () => dir('.config', 'opencode', 'rules'),
    writeRule(target, name, contents = '# Rule') {
      mkdirSync(target, { recursive: true });
      const filePath = path.join(target, name);
      writeFileSync(filePath, contents);
      return filePath;
    },
  };
}

describe('classifyRuleScope', () => {
  it('returns "global" when projectDir is null', () => {
    expect(
      classifyRuleScope('/home/user/.config/opencode/rules/foo.md', null)
    ).toBe('global');
  });

  it('returns "project" for files under projectDir/.opencode/rules/', () => {
    expect(
      classifyRuleScope('/project/.opencode/rules/foo.md', '/project')
    ).toBe('project');
  });

  it('returns "project" for files in subdirectories under project rules', () => {
    expect(
      classifyRuleScope('/project/.opencode/rules/sub/deep.md', '/project')
    ).toBe('project');
  });

  it('returns "global" for global files outside projectDir', () => {
    expect(
      classifyRuleScope('/home/user/.config/opencode/rules/foo.md', '/project')
    ).toBe('global');
  });

  it('returns "project" for an additional directory inside the project', () => {
    expect(classifyRuleScope('/project/.agents/rules/foo.md', '/project')).toBe(
      'project'
    );
  });

  it('returns "global" for an additional directory outside the project', () => {
    expect(
      classifyRuleScope('/home/user/shared/rules/foo.md', '/project')
    ).toBe('global');
  });

  it('does not match partial path prefixes', () => {
    expect(
      classifyRuleScope('/project-sibling/.opencode/rules/foo.md', '/project')
    ).toBe('global');
  });

  it('returns "global" for the project root itself', () => {
    expect(classifyRuleScope('/project', '/project')).toBe('global');
  });
});

describe('hasConditions', () => {
  it('returns false for undefined metadata', () => {
    expect(hasConditions(undefined)).toBe(false);
  });

  it('returns false for empty metadata', () => {
    expect(hasConditions({})).toBe(false);
  });

  it('returns true when globs is set', () => {
    expect(hasConditions({ globs: ['**/*.ts'] })).toBe(true);
  });

  it('returns true when fileContains is declared', () => {
    expect(hasConditions({ fileContains: ['TODO'] })).toBe(true);
    expect(hasConditions({ fileContains: [] })).toBe(true);
  });

  it('returns true when ci is false (still a condition)', () => {
    expect(hasConditions({ ci: false })).toBe(true);
  });

  it('returns true for any single field', () => {
    expect(hasConditions({ keywords: ['test'] })).toBe(true);
    expect(hasConditions({ tools: ['mcp_bash'] })).toBe(true);
    expect(hasConditions({ model: ['gpt-5'] })).toBe(true);
    expect(hasConditions({ agent: ['coder'] })).toBe(true);
    expect(hasConditions({ command: ['/plan'] })).toBe(true);
    expect(hasConditions({ project: ['node'] })).toBe(true);
    expect(hasConditions({ branch: ['main'] })).toBe(true);
    expect(hasConditions({ os: ['linux'] })).toBe(true);
  });
});

describe('formatConditionSummary', () => {
  it('formats single array field', () => {
    expect(formatConditionSummary({ globs: ['**/*.ts'] })).toBe(
      'globs: **/*.ts'
    );
  });

  it('formats multiple array values with commas', () => {
    expect(formatConditionSummary({ keywords: ['auth', 'security'] })).toBe(
      'keywords: auth, security'
    );
  });

  it('formats multiple fields with commas', () => {
    const result = formatConditionSummary({
      globs: ['**/*.ts'],
      keywords: ['test'],
    });
    expect(result).toBe('globs: **/*.ts, keywords: test');
  });

  it('includes ci boolean', () => {
    expect(formatConditionSummary({ ci: true })).toBe('ci: true');
  });

  it('includes match mode', () => {
    expect(formatConditionSummary({ model: ['gpt-5'], match: 'all' })).toBe(
      'model: gpt-5, match: all'
    );
  });

  it('formats fileContains literals', () => {
    expect(formatConditionSummary({ fileContains: ['unsafe {'] })).toBe(
      'fileContains: unsafe {'
    );
  });

  it('formats all fields in canonical order', () => {
    const result = formatConditionSummary({
      os: ['linux'],
      globs: ['*.md'],
      fileContains: ['TODO'],
      ci: false,
      match: 'all',
    });
    expect(result).toBe(
      'globs: *.md, fileContains: TODO, os: linux, ci: false, match: all'
    );
  });
});

describe('formatRuleDetail', () => {
  it('joins matcher and path with a middle dot', () => {
    expect(
      formatRuleDetail({ conditionSummary: 'agent: plan', path: 'plan.mdc' })
    ).toBe('agent: plan · plan.mdc');
  });

  it('formats unconditional rules', () => {
    expect(
      formatRuleDetail({
        conditionSummary: 'always active',
        path: 'always.mdc',
      })
    ).toBe('always active · always.mdc');
  });
});

describe('disambiguateNames', () => {
  it('assigns filename stem for unique names', () => {
    const entries: SidebarRuleEntry[] = [
      makeEntry({ path: 'foo.md' }),
      makeEntry({ path: 'bar.mdc' }),
    ];
    disambiguateNames(entries);
    expect(entries[0]!.name).toBe('foo');
    expect(entries[1]!.name).toBe('bar');
  });

  it('adds parent dir prefix for duplicate stems', () => {
    const entries: SidebarRuleEntry[] = [
      makeEntry({ path: 'frontend/security.md' }),
      makeEntry({ path: 'backend/security.md' }),
    ];
    disambiguateNames(entries);
    expect(entries[0]!.name).toBe('frontend/security');
    expect(entries[1]!.name).toBe('backend/security');
  });

  it('falls back to full path for triple collisions after parent prefix', () => {
    const entries: SidebarRuleEntry[] = [
      makeEntry({ path: 'apps/web/security.mdc' }),
      makeEntry({ path: 'packages/web/security.mdc' }),
      makeEntry({ path: 'other/security.md' }),
    ];
    disambiguateNames(entries);
    expect(entries[0]!.name).toBe('apps/web/security.mdc');
    expect(entries[1]!.name).toBe('packages/web/security.mdc');
    expect(entries[2]!.name).toBe('other/security');
  });

  it('disambiguates same-directory collisions with different extensions', () => {
    const entries: SidebarRuleEntry[] = [
      makeEntry({ path: 'dup.md' }),
      makeEntry({ path: 'dup.mdc' }),
    ];
    disambiguateNames(entries);
    expect(entries[0]!.name).toBe('dup.md');
    expect(entries[1]!.name).toBe('dup.mdc');
  });

  it('handles entries with subdirectory paths and different extensions', () => {
    const entries: SidebarRuleEntry[] = [
      makeEntry({ path: 'rules/dup.md' }),
      makeEntry({ path: 'rules/dup.mdc' }),
    ];
    disambiguateNames(entries);
    expect(entries[0]!.name).toBe('rules/dup.md');
    expect(entries[1]!.name).toBe('rules/dup.mdc');
  });

  it('preserves multi-dot filenames correctly', () => {
    const entries: SidebarRuleEntry[] = [
      makeEntry({ path: 'my.config.md' }),
      makeEntry({ path: 'other.md' }),
    ];
    disambiguateNames(entries);
    expect(entries[0]!.name).toBe('my.config');
    expect(entries[1]!.name).toBe('other');
  });
});

describe('loadSidebarRules', () => {
  const fixture = useRuleFixture('tui-rules-test-');

  it('discovers global rules when projectDir is null', async () => {
    fixture.writeRule(fixture.globalDir(), 'rule.md', '# Always');

    const { rules, skippedCount } = await loadSidebarRules(null);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe('global');
    expect(rules[0]!.name).toBe('rule');
    expect(rules[0]!.isConditional).toBe(false);
    expect(rules[0]!.conditionSummary).toBe('always active');
    expect(skippedCount).toBe(0);
  });

  it('discovers both global and project rules', async () => {
    fixture.writeRule(fixture.globalDir(), 'global.md', '# Global');
    const projDir = fixture.dir('project');
    fixture.writeRule(
      fixture.dir('project', '.opencode', 'rules'),
      'local.md',
      '# Local'
    );

    const { rules } = await loadSidebarRules(projDir);

    expect(rules).toHaveLength(2);
    expect(rules[0]!.source).toBe('project');
    expect(rules[1]!.source).toBe('global');
  });

  it('parses metadata for conditional rules', async () => {
    fixture.writeRule(
      fixture.globalDir(),
      'conditional.mdc',
      `---\nglobs:\n  - "**/*.ts"\nkeywords:\n  - testing\n---\nRule content`
    );

    const { rules } = await loadSidebarRules(null);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.isConditional).toBe(true);
    expect(rules[0]!.conditionSummary).toContain('globs');
    expect(rules[0]!.conditionSummary).toContain('keywords');
    expect(rules[0]!.metadata.globs).toEqual(['**/*.ts']);
  });

  it('sorts project rules before global, alphabetical within group', async () => {
    const globalDir = fixture.globalDir();
    fixture.writeRule(globalDir, 'zebra.md', '# Z');
    fixture.writeRule(globalDir, 'alpha.md', '# A');
    const projRulesDir = fixture.dir('project', '.opencode', 'rules');
    fixture.writeRule(projRulesDir, 'beta.md', '# B');
    fixture.writeRule(projRulesDir, 'aardvark.md', '# AA');

    const { rules } = await loadSidebarRules(fixture.dir('project'));

    expect(rules.map(r => `${r.source}:${r.name}`)).toEqual([
      'project:aardvark',
      'project:beta',
      'global:alpha',
      'global:zebra',
    ]);
  });

  it('increments skippedCount for unreadable files', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const globalDir = fixture.globalDir();
    fixture.writeRule(globalDir, 'readable.md', '# OK');
    const unreadable = fixture.writeRule(globalDir, 'unreadable.md', '# Nope');
    chmodSync(unreadable, 0o000);

    const { rules, skippedCount } = await loadSidebarRules(null);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.name).toBe('readable');
    expect(skippedCount).toBe(1);

    // getCachedRule() keeps the warning silent unless debug logging is enabled.
    expect(warnSpy).not.toHaveBeenCalled();

    chmodSync(unreadable, 0o644);
    warnSpy.mockRestore();
  });
});

describe('loadSidebarRules isActive behavior', () => {
  const fixture = useRuleFixture('tui-rules-active-test-');

  function stateDir(): string {
    return fixture.dir('state');
  }

  function writeStateFile(sessionID: string, matchedRulePaths: string[]): void {
    writeFileSync(
      path.join(stateDir(), `${sessionID}.json`),
      JSON.stringify({ sessionID, matchedRulePaths, evaluatedAt: 123 })
    );
  }

  it('sets hasEvaluationState to false when no sessionId provided', async () => {
    fixture.writeRule(fixture.globalDir(), 'rule.md', '# Always');

    const result = await loadSidebarRules(null);

    expect(result.hasEvaluationState).toBe(false);
  });

  it('sets hasEvaluationState to false when state file does not exist', async () => {
    fixture.writeRule(fixture.globalDir(), 'rule.md', '# Always');
    mkdirSync(stateDir(), { recursive: true });

    const result = await loadSidebarRules(null, 'nonexistent-session', {
      stateDir: stateDir(),
    });

    expect(result.hasEvaluationState).toBe(false);
  });

  it('sets hasEvaluationState to true when state file exists', async () => {
    fixture.writeRule(fixture.globalDir(), 'rule.md', '# Always');
    mkdirSync(stateDir(), { recursive: true });
    writeStateFile('test-session', []);

    const result = await loadSidebarRules(null, 'test-session', {
      stateDir: stateDir(),
    });

    expect(result.hasEvaluationState).toBe(true);
  });

  it('sets isActive to true for unconditional rules without state file', async () => {
    fixture.writeRule(fixture.globalDir(), 'always.md', '# Always active');

    const { rules } = await loadSidebarRules(null);

    expect(rules[0]!.isConditional).toBe(false);
    expect(rules[0]!.isActive).toBe(true);
  });

  it('sets isActive to null for conditional rules without state file', async () => {
    fixture.writeRule(
      fixture.globalDir(),
      'conditional.mdc',
      `---\nglobs:\n  - "**/*.ts"\n---\nConditional rule`
    );

    const { rules } = await loadSidebarRules(null);

    expect(rules[0]!.isConditional).toBe(true);
    expect(rules[0]!.isActive).toBe(null);
  });

  it('sets isActive based on matchedRulePaths when state file exists', async () => {
    const globalDir = fixture.globalDir();
    const matchedPath = fixture.writeRule(globalDir, 'matched.md', '# Matched');
    fixture.writeRule(globalDir, 'unmatched.md', '# Unmatched');
    mkdirSync(stateDir(), { recursive: true });
    writeStateFile('test-session', [matchedPath]);

    const { rules } = await loadSidebarRules(null, 'test-session', {
      stateDir: stateDir(),
    });

    const matched = rules.find(r => r.name === 'matched');
    const unmatched = rules.find(r => r.name === 'unmatched');

    expect(matched!.isActive).toBe(true);
    expect(unmatched!.isActive).toBe(false);
  });

  it('correctly matches conditional rules with state file', async () => {
    const conditionalPath = fixture.writeRule(
      fixture.globalDir(),
      'conditional.mdc',
      `---\nglobs:\n  - "**/*.ts"\n---\nConditional rule`
    );
    mkdirSync(stateDir(), { recursive: true });
    writeStateFile('test-session', [conditionalPath]);

    const { rules } = await loadSidebarRules(null, 'test-session', {
      stateDir: stateDir(),
    });

    expect(rules[0]!.isConditional).toBe(true);
    expect(rules[0]!.isActive).toBe(true);
  });

  it('marks conditional rules as inactive when not in matchedRulePaths', async () => {
    fixture.writeRule(
      fixture.globalDir(),
      'conditional.mdc',
      `---\nglobs:\n  - "**/*.ts"\n---\nConditional rule`
    );
    mkdirSync(stateDir(), { recursive: true });
    writeStateFile('test-session', []);

    const { rules } = await loadSidebarRules(null, 'test-session', {
      stateDir: stateDir(),
    });

    expect(rules[0]!.isConditional).toBe(true);
    expect(rules[0]!.isActive).toBe(false);
  });
});

describe('loadSidebarRules additional rule directories', () => {
  const fixture = useRuleFixture('tui-rules-extra-test-');

  it('lists in-project and outside-project extra directories by containment', async () => {
    fixture.writeRule(fixture.globalDir(), 'global.md', '# Global');
    fixture.writeRule(
      fixture.dir('project', '.opencode', 'rules'),
      'built-in.md',
      '# Built in'
    );
    fixture.writeRule(
      fixture.dir('project', '.agents', 'rules'),
      'in-project.md',
      '# In project'
    );
    const outside = fixture.dir('shared', 'rules');
    fixture.writeRule(outside, 'outside.md', '# Outside');

    const { rules } = await loadSidebarRules(
      fixture.dir('project'),
      undefined,
      {
        additionalRuleDirectories: ['.agents/rules', outside],
      }
    );

    expect(rules.map(r => `${r.source}:${r.name}`)).toEqual([
      'project:built-in',
      'project:in-project',
      'global:global',
      'global:outside',
    ]);
  });

  it('skips relative entries but loads absolute and ~ entries without a project root', async () => {
    process.env['HOME'] = fixture.dir('home');
    fixture.writeRule(fixture.globalDir(), 'global.md', '# Global');
    fixture.writeRule(fixture.dir('relative-rules'), 'skipped.md', '# Nope');
    fixture.writeRule(fixture.dir('abs-rules'), 'absolute.md', '# Absolute');
    fixture.writeRule(fixture.dir('home', 'shared-rules'), 'home.md', '# Home');

    const { rules } = await loadSidebarRules(null, undefined, {
      additionalRuleDirectories: [
        'relative-rules',
        fixture.dir('abs-rules'),
        '~/shared-rules',
      ],
    });

    expect(rules.map(r => `${r.source}:${r.name}`)).toEqual([
      'global:absolute',
      'global:global',
      'global:home',
    ]);
  });

  it('resolves relative entries against the project root of each load', async () => {
    fixture.writeRule(fixture.dir('a', '.agents', 'rules'), 'from-a.md', '# A');
    fixture.writeRule(fixture.dir('b', '.agents', 'rules'), 'from-b.md', '# B');
    const options = { additionalRuleDirectories: ['.agents/rules'] };

    const first = await loadSidebarRules(fixture.dir('a'), undefined, options);
    const second = await loadSidebarRules(fixture.dir('b'), undefined, options);

    expect(first.rules.map(r => r.name)).toEqual(['from-a']);
    expect(second.rules.map(r => r.name)).toEqual(['from-b']);
    expect(second.rules[0]!.source).toBe('project');
  });

  it('degrades to built-in discovery for malformed plugin options', async () => {
    fixture.writeRule(fixture.globalDir(), 'global.md', '# Global');

    // A hand-written config can hand over anything, including a getter that
    // throws; the shared parser degrades to an empty entry list.
    const hostile = Object.defineProperty({}, 'additionalRuleDirectories', {
      get() {
        throw new Error('hostile getter');
      },
    });
    const { additionalRuleDirectories } = parsePluginOptions(hostile);

    const { rules } = await loadSidebarRules(null, undefined, {
      additionalRuleDirectories,
    });

    expect(rules.map(r => r.name)).toEqual(['global']);
  });
});

/** Helper to create a minimal SidebarRuleEntry for disambiguation tests */
function makeEntry(
  overrides: Partial<SidebarRuleEntry> & { path: string }
): SidebarRuleEntry {
  return {
    name: '',
    path: overrides.path,
    source: overrides.source ?? 'global',
    isConditional: overrides.isConditional ?? false,
    conditionSummary: overrides.conditionSummary ?? 'always active',
    metadata: overrides.metadata ?? {},
    isActive: overrides.isActive ?? true,
  };
}
