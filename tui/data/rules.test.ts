// tui/data/rules.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'fs';
import { clearRuleCache } from '../../src/rule-discovery.js';
import {
  _setStateDirForTesting,
  writeActiveRulesState,
} from '../../src/active-rules-state.js';
import {
  ruleSource,
  hasConditions,
  formatConditionSummary,
  disambiguateNames,
  loadSidebarRules,
  type SidebarRuleEntry,
} from './rules.js';

// ──────────────────────────────────────────────
// ruleSource
// ──────────────────────────────────────────────

describe('ruleSource', () => {
  it('returns "global" when projectDir is null', () => {
    expect(ruleSource('/home/user/.config/opencode/rules/foo.md', null)).toBe(
      'global'
    );
  });

  it('returns "project" for files under projectDir/.opencode/rules/', () => {
    expect(ruleSource('/project/.opencode/rules/foo.md', '/project')).toBe(
      'project'
    );
  });

  it('returns "project" for files in subdirectories under project rules', () => {
    expect(ruleSource('/project/.opencode/rules/sub/deep.md', '/project')).toBe(
      'project'
    );
  });

  it('returns "global" for files not under projectDir/.opencode/rules/', () => {
    expect(
      ruleSource('/home/user/.config/opencode/rules/foo.md', '/project')
    ).toBe('global');
  });

  it('does not match partial path prefixes', () => {
    // /project/.opencode/rules-extra/ should NOT match /project/.opencode/rules/
    expect(
      ruleSource('/project/.opencode/rules-extra/foo.md', '/project')
    ).toBe('global');
  });
});

// ──────────────────────────────────────────────
// hasConditions
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// formatConditionSummary
// ──────────────────────────────────────────────

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

  it('formats all fields in canonical order', () => {
    const result = formatConditionSummary({
      os: ['linux'],
      globs: ['*.md'],
      ci: false,
      match: 'all',
    });
    expect(result).toBe('globs: *.md, os: linux, ci: false, match: all');
  });
});

// ──────────────────────────────────────────────
// disambiguateNames
// ──────────────────────────────────────────────

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
    // web/security appears twice, falls back to full path (with extension) for those
    expect(entries[0]!.name).toBe('apps/web/security.mdc');
    expect(entries[1]!.name).toBe('packages/web/security.mdc');
    // other/security is unique after parent prefix
    expect(entries[2]!.name).toBe('other/security');
  });

  it('disambiguates same-directory collisions with different extensions', () => {
    const entries: SidebarRuleEntry[] = [
      makeEntry({ path: 'dup.md' }),
      makeEntry({ path: 'dup.mdc' }),
    ];
    disambiguateNames(entries);
    // Both stem to "dup", no parent dir to prefix (dirname is ".").
    // Falls back to full path with extension.
    expect(entries[0]!.name).toBe('dup.md');
    expect(entries[1]!.name).toBe('dup.mdc');
  });

  it('handles entries with subdirectory paths and different extensions', () => {
    const entries: SidebarRuleEntry[] = [
      makeEntry({ path: 'rules/dup.md' }),
      makeEntry({ path: 'rules/dup.mdc' }),
    ];
    disambiguateNames(entries);
    // Both stem to "dup", same parent "rules" -> "rules/dup" for both.
    // Still ambiguous, falls back to full path with extension.
    expect(entries[0]!.name).toBe('rules/dup.md');
    expect(entries[1]!.name).toBe('rules/dup.mdc');
  });

  it('preserves multi-dot filenames correctly', () => {
    const entries: SidebarRuleEntry[] = [
      makeEntry({ path: 'my.config.md' }),
      makeEntry({ path: 'other.md' }),
    ];
    disambiguateNames(entries);
    // lastIndexOf('.') gives "my.config", not "my"
    expect(entries[0]!.name).toBe('my.config');
    expect(entries[1]!.name).toBe('other');
  });
});

// ──────────────────────────────────────────────
// loadSidebarRules (integration)
// ──────────────────────────────────────────────

describe('loadSidebarRules', () => {
  let testDir: string;
  let savedXDG: string | undefined;
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(path.join(os.tmpdir(), 'tui-rules-test-'));
    savedXDG = process.env['XDG_CONFIG_HOME'];
    savedConfigDir = process.env['OPENCODE_CONFIG_DIR'];
    delete process.env['OPENCODE_CONFIG_DIR'];
    clearRuleCache();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    if (savedXDG === undefined) {
      delete process.env['XDG_CONFIG_HOME'];
    } else {
      process.env['XDG_CONFIG_HOME'] = savedXDG;
    }
    if (savedConfigDir === undefined) {
      delete process.env['OPENCODE_CONFIG_DIR'];
    } else {
      process.env['OPENCODE_CONFIG_DIR'] = savedConfigDir;
    }
  });

  it('discovers global rules when projectDir is null', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(path.join(globalDir, 'rule.md'), '# Always');
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    const { rules, skippedCount } = await loadSidebarRules(null);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe('global');
    expect(rules[0]!.name).toBe('rule');
    expect(rules[0]!.isConditional).toBe(false);
    expect(rules[0]!.conditionSummary).toBe('always active');
    expect(skippedCount).toBe(0);
  });

  it('discovers both global and project rules', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    const projDir = path.join(testDir, 'project');
    const projRulesDir = path.join(projDir, '.opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projRulesDir, { recursive: true });
    writeFileSync(path.join(globalDir, 'global.md'), '# Global');
    writeFileSync(path.join(projRulesDir, 'local.md'), '# Local');
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    const { rules } = await loadSidebarRules(projDir);

    expect(rules).toHaveLength(2);
    // Project rules sort first
    expect(rules[0]!.source).toBe('project');
    expect(rules[1]!.source).toBe('global');
  });

  it('parses metadata for conditional rules', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      path.join(globalDir, 'conditional.mdc'),
      `---\nglobs:\n  - "**/*.ts"\nkeywords:\n  - testing\n---\nRule content`
    );
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    const { rules } = await loadSidebarRules(null);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.isConditional).toBe(true);
    expect(rules[0]!.conditionSummary).toContain('globs');
    expect(rules[0]!.conditionSummary).toContain('keywords');
    expect(rules[0]!.metadata.globs).toEqual(['**/*.ts']);
  });

  it('sorts project rules before global, alphabetical within group', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    const projDir = path.join(testDir, 'project');
    const projRulesDir = path.join(projDir, '.opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projRulesDir, { recursive: true });
    writeFileSync(path.join(globalDir, 'zebra.md'), '# Z');
    writeFileSync(path.join(globalDir, 'alpha.md'), '# A');
    writeFileSync(path.join(projRulesDir, 'beta.md'), '# B');
    writeFileSync(path.join(projRulesDir, 'aardvark.md'), '# AA');
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    const { rules } = await loadSidebarRules(projDir);

    expect(rules.map(r => `${r.source}:${r.name}`)).toEqual([
      'project:aardvark',
      'project:beta',
      'global:alpha',
      'global:zebra',
    ]);
  });

  it('increments skippedCount for unreadable files', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(path.join(globalDir, 'readable.md'), '# OK');
    const unreadable = path.join(globalDir, 'unreadable.md');
    writeFileSync(unreadable, '# Nope');
    chmodSync(unreadable, 0o000);
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    const { rules, skippedCount } = await loadSidebarRules(null);

    // One readable, one unreadable
    expect(rules).toHaveLength(1);
    expect(rules[0]!.name).toBe('readable');
    expect(skippedCount).toBe(1);

    // getCachedRule() logs its own warning for read failures —
    // loadSidebarRules does NOT add a second one (no duplicate logs).
    // But getCachedRule's internal warning should still fire:
    expect(warnSpy).toHaveBeenCalled();

    // Restore permissions for cleanup
    chmodSync(unreadable, 0o644);
    warnSpy.mockRestore();
  });
});

// ──────────────────────────────────────────────
// loadSidebarRules isActive behavior
// ──────────────────────────────────────────────

describe('loadSidebarRules isActive behavior', () => {
  let testDir: string;
  let stateDir: string;
  let savedXDG: string | undefined;
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(path.join(os.tmpdir(), 'tui-rules-active-test-'));
    stateDir = path.join(testDir, 'state');
    mkdirSync(stateDir, { recursive: true });
    savedXDG = process.env['XDG_CONFIG_HOME'];
    savedConfigDir = process.env['OPENCODE_CONFIG_DIR'];
    delete process.env['OPENCODE_CONFIG_DIR'];
    clearRuleCache();
    _setStateDirForTesting(stateDir);
  });

  afterEach(() => {
    _setStateDirForTesting(null);
    rmSync(testDir, { recursive: true, force: true });
    if (savedXDG === undefined) {
      delete process.env['XDG_CONFIG_HOME'];
    } else {
      process.env['XDG_CONFIG_HOME'] = savedXDG;
    }
    if (savedConfigDir === undefined) {
      delete process.env['OPENCODE_CONFIG_DIR'];
    } else {
      process.env['OPENCODE_CONFIG_DIR'] = savedConfigDir;
    }
  });

  it('sets hasEvaluationState to false when no sessionId provided', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(path.join(globalDir, 'rule.md'), '# Always');
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    const result = await loadSidebarRules(null);

    expect(result.hasEvaluationState).toBe(false);
  });

  it('sets hasEvaluationState to false when state file does not exist', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(path.join(globalDir, 'rule.md'), '# Always');
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    const result = await loadSidebarRules(null, 'nonexistent-session');

    expect(result.hasEvaluationState).toBe(false);
  });

  it('sets hasEvaluationState to true when state file exists', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(path.join(globalDir, 'rule.md'), '# Always');
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    writeActiveRulesState('test-session', []);
    // Wait for async write to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const result = await loadSidebarRules(null, 'test-session');

    expect(result.hasEvaluationState).toBe(true);
  });

  it('sets isActive to true for unconditional rules without state file', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(path.join(globalDir, 'always.md'), '# Always active');
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    const { rules } = await loadSidebarRules(null);

    expect(rules[0]!.isConditional).toBe(false);
    expect(rules[0]!.isActive).toBe(true);
  });

  it('sets isActive to null for conditional rules without state file', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      path.join(globalDir, 'conditional.mdc'),
      `---\nglobs:\n  - "**/*.ts"\n---\nConditional rule`
    );
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    const { rules } = await loadSidebarRules(null);

    expect(rules[0]!.isConditional).toBe(true);
    expect(rules[0]!.isActive).toBe(null);
  });

  it('sets isActive based on matchedRulePaths when state file exists', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    const matchedPath = path.join(globalDir, 'matched.md');
    const unmatchedPath = path.join(globalDir, 'unmatched.md');
    writeFileSync(matchedPath, '# Matched');
    writeFileSync(unmatchedPath, '# Unmatched');
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    writeActiveRulesState('test-session', [matchedPath]);
    await new Promise(resolve => setTimeout(resolve, 50));

    const { rules } = await loadSidebarRules(null, 'test-session');

    const matched = rules.find(r => r.name === 'matched');
    const unmatched = rules.find(r => r.name === 'unmatched');

    expect(matched!.isActive).toBe(true);
    expect(unmatched!.isActive).toBe(false);
  });

  it('correctly matches conditional rules with state file', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    const conditionalPath = path.join(globalDir, 'conditional.mdc');
    writeFileSync(
      conditionalPath,
      `---\nglobs:\n  - "**/*.ts"\n---\nConditional rule`
    );
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    // Conditional rule is in matchedRulePaths
    writeActiveRulesState('test-session', [conditionalPath]);
    await new Promise(resolve => setTimeout(resolve, 50));

    const { rules } = await loadSidebarRules(null, 'test-session');

    expect(rules[0]!.isConditional).toBe(true);
    expect(rules[0]!.isActive).toBe(true);
  });

  it('marks conditional rules as inactive when not in matchedRulePaths', async () => {
    const globalDir = path.join(testDir, '.config', 'opencode', 'rules');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      path.join(globalDir, 'conditional.mdc'),
      `---\nglobs:\n  - "**/*.ts"\n---\nConditional rule`
    );
    process.env['XDG_CONFIG_HOME'] = path.join(testDir, '.config');

    // Empty matchedRulePaths - nothing matched
    writeActiveRulesState('test-session', []);
    await new Promise(resolve => setTimeout(resolve, 50));

    const { rules } = await loadSidebarRules(null, 'test-session');

    expect(rules[0]!.isConditional).toBe(true);
    expect(rules[0]!.isActive).toBe(false);
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
