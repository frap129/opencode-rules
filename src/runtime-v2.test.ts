// src/runtime-v2.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  createMockSessionContext,
  createMockToolExecuteBefore,
  createMockToolExecuteAfter,
  createRuntime,
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  toRules,
  saveEnv,
  restoreEnv,
  systemText,
  type EnvSnapshot,
} from './test-fixtures.js';
import { __testOnly } from './index.js';
import { RuleBlockError } from './runtime.js';
import { clearRuleCache } from './utils.js';
import { _setStateDirForTesting } from './active-rules-state.js';

describe('OpenCodeRulesRuntime (v2)', () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    setupTestDirs();
    envSnapshot = saveEnv('XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR');
    _setStateDirForTesting(path.join(getTestDirs().testDir, 'state'));
    __testOnly.resetSessionState();
    clearRuleCache();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    _setStateDirForTesting(null);
    teardownTestDirs();
    __testOnly.resetSessionState();
    clearRuleCache();
    vi.restoreAllMocks();
  });

  describe('context hook', () => {
    it('injects matching global rules into system as a text part', async () => {
      const { projectRulesDir } = getTestDirs();
      const rulePath = path.join(projectRulesDir, 'core.md');
      writeFileSync(rulePath, '# Core rule');
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().projectRulesDir,
      });

      await hookRegistry.context!(
        createMockSessionContext({ sessionID: 's1', system: [] })
      );

      const state = __testOnly.getSessionStateSnapshot('s1');
      expect(state?.rulesInjected).toBe(true);
    });

    it('pushes a single text SystemPart containing formatted rules', async () => {
      const { projectRulesDir } = getTestDirs();
      const rulePath = path.join(projectRulesDir, 'core.md');
      writeFileSync(rulePath, '# Core rule');
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().projectRulesDir,
      });
      const ctx = createMockSessionContext({ sessionID: 's1' });

      await hookRegistry.context!(ctx);

      expect(ctx.system).toHaveLength(1);
      expect(ctx.system[0]).toEqual({
        type: 'text',
        text: expect.stringContaining('Core rule'),
      });
      expect(systemText(ctx.system)).toContain('OpenCode Rules');
    });

    it('does not modify system when no rules match', async () => {
      const { hookRegistry } = await createRuntime({
        sessionDirectory: getTestDirs().testDir,
      });
      const ctx = createMockSessionContext({ sessionID: 's1' });

      await hookRegistry.context!(ctx);

      expect(ctx.system).toHaveLength(0);
    });

    it('skips static injection on subsequent calls (rulesInjected gate)', async () => {
      const { projectRulesDir } = getTestDirs();
      const rulePath = path.join(projectRulesDir, 'core.md');
      writeFileSync(rulePath, '# Core rule');
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().projectRulesDir,
      });
      const ctx1 = createMockSessionContext({ sessionID: 's1' });
      const ctx2 = createMockSessionContext({ sessionID: 's1' });

      await hookRegistry.context!(ctx1);
      await hookRegistry.context!(ctx2);

      expect(ctx1.system).toHaveLength(1);
      expect(ctx2.system).toHaveLength(0);
    });

    it('re-injects when a new user prompt arrives', async () => {
      const { projectRulesDir } = getTestDirs();
      const rulePath = path.join(projectRulesDir, 'core.md');
      writeFileSync(rulePath, '# Core rule');
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().projectRulesDir,
      });
      await hookRegistry.context!(
        createMockSessionContext({
          sessionID: 's1',
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'first prompt' }] },
          ],
        })
      );
      const ctx2 = createMockSessionContext({
        sessionID: 's1',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'second prompt' }] },
        ],
      });

      await hookRegistry.context!(ctx2);

      expect(ctx2.system).toHaveLength(1);
    });

    it('seeds context paths from message history once', async () => {
      const { hookRegistry } = await createRuntime({
        sessionDirectory: getTestDirs().testDir,
      });
      const ctx = createMockSessionContext({
        sessionID: 's1',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                id: 'c1',
                name: 'read',
                input: { filePath: 'src/index.ts' },
              },
            ],
          },
        ],
      });

      await hookRegistry.context!(ctx);

      const state = __testOnly.getSessionStateSnapshot('s1');
      expect(state?.contextPaths.has('src/index.ts')).toBe(true);
      expect(__testOnly.getSeedCount('s1')).toBe(1);
    });

    it('captures model and agent from the payload', async () => {
      const { hookRegistry } = await createRuntime({
        sessionDirectory: getTestDirs().testDir,
      });

      await hookRegistry.context!(
        createMockSessionContext({
          sessionID: 's1',
          model: { id: 'gpt-5.3-codex', providerID: 'openai' },
          agent: 'programmer',
        })
      );

      const state = __testOnly.getSessionStateSnapshot('s1');
      expect(state?.lastModelID).toBe('gpt-5.3-codex');
      expect(state?.lastAgentType).toBe('programmer');
    });

    it('matches rules against tools from the tools record, including mcp_ candidates', async () => {
      const { projectRulesDir } = getTestDirs();
      const rulePath = path.join(projectRulesDir, 'mcp.md');
      writeFileSync(
        rulePath,
        ['---', 'tools:', '  - mcp_context7', '---', '# MCP rule'].join('\n')
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().projectRulesDir,
      });
      const ctx = createMockSessionContext({
        sessionID: 's1',
        tools: { context7_search: { description: 'search', input: {} } },
      });

      await hookRegistry.context!(ctx);

      expect(systemText(ctx.system)).toContain('MCP rule');
    });

    it('resolves the project directory per session and discovers project rules', async () => {
      const { testDir, projectRulesDir } = getTestDirs();
      mkdirSync(projectRulesDir, { recursive: true });
      writeFileSync(path.join(projectRulesDir, 'proj.md'), '# Project rule');
      const { hookRegistry, sessionGet } = await createRuntime({
        sessionDirectory: path.join(testDir, 'project'),
      });
      const ctx = createMockSessionContext({ sessionID: 's1' });

      await hookRegistry.context!(ctx);

      expect(sessionGet).toHaveBeenCalledWith({ sessionID: 's1' });
      expect(systemText(ctx.system)).toContain('Project rule');
    });

    it('falls back to process.cwd() when session.get fails', async () => {
      // NOTE: cwd is the repo root, whose .opencode/rules/*.md files are all
      // conditional (globs/keywords) and cannot match the empty context here,
      // so system stays empty. If this ever breaks, set a sandbox cwd instead.
      const { hookRegistry } = await createRuntime({});
      const ctx = createMockSessionContext({ sessionID: 's1' });

      await expect(hookRegistry.context!(ctx)).resolves.toBeUndefined();
      expect(ctx.system).toHaveLength(0);
    });

    it('never throws when filtering fails', async () => {
      const { hookRegistry } = await createRuntime({
        sessionDirectory: '/nonexistent',
      });
      const ctx = createMockSessionContext({
        sessionID: 's1',
        tools: { broken: { description: 'x', input: null } },
      });

      await expect(hookRegistry.context!(ctx)).resolves.toBeUndefined();
    });
  });

  describe('tool.execute.before', () => {
    it('captures filePath for read and fires PreToolUse hooks', async () => {
      const { projectRulesDir } = getTestDirs();
      const rulePath = path.join(projectRulesDir, 'hooks.md');
      writeFileSync(
        rulePath,
        [
          '---',
          'hooks:',
          '  - type: PreToolUse',
          '    matcher: read',
          '---',
          '# Hooked rule',
        ].join('\n')
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      await hookRegistry['execute.before']!(
        createMockToolExecuteBefore({
          sessionID: 's1',
          tool: 'read',
          input: { filePath: 'src/index.ts' },
        })
      );

      const state = __testOnly.getSessionStateSnapshot('s1');
      expect(state?.contextPaths.has('src/index.ts')).toBe(true);
      expect(state?.pendingHookInjections).toContain('# Hooked rule');
    });

    it('captures v2 path input for read and shell workdir for commands', async () => {
      const { projectRulesDir } = getTestDirs();
      const rulePath = path.join(projectRulesDir, 'hooks.md');
      writeFileSync(
        rulePath,
        [
          '---',
          'hooks:',
          '  - type: PreToolUse',
          '    matcher: read',
          '---',
          '# Hooked rule',
        ].join('\n')
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      await hookRegistry['execute.before']!(
        createMockToolExecuteBefore({
          sessionID: 's1',
          tool: 'read',
          input: { path: 'src/v2-path.ts' },
        })
      );
      await hookRegistry['execute.before']!(
        createMockToolExecuteBefore({
          sessionID: 's1',
          tool: 'shell',
          input: { command: 'pwd', workdir: 'apps/web' },
        })
      );

      const state = __testOnly.getSessionStateSnapshot('s1');
      expect(state?.contextPaths.has('src/v2-path.ts')).toBe(true);
      expect(state?.contextPaths.has('apps/web')).toBe(true);
    });

    it('throws RuleBlockError when a PreToolUse hook has block: true', async () => {
      const { projectRulesDir } = getTestDirs();
      const rulePath = path.join(projectRulesDir, 'block.md');
      writeFileSync(
        rulePath,
        [
          '---',
          'hooks:',
          '  - type: PreToolUse',
          '    matcher: bash',
          '    block: true',
          '---',
          '# Blocked',
        ].join('\n')
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      await expect(
        hookRegistry['execute.before']!(
          createMockToolExecuteBefore({
            sessionID: 's1',
            tool: 'bash',
            input: { workdir: '/tmp' },
          })
        )
      ).rejects.toBeInstanceOf(RuleBlockError);
    });
  });

  describe('tool.execute.after', () => {
    it('fires PostToolUse hooks', async () => {
      const { projectRulesDir } = getTestDirs();
      const rulePath = path.join(projectRulesDir, 'post.md');
      writeFileSync(
        rulePath,
        [
          '---',
          'hooks:',
          '  - type: PostToolUse',
          '    matcher: read',
          '---',
          '# Post rule',
        ].join('\n')
      );
      const { hookRegistry } = await createRuntime({
        globalRules: toRules([rulePath]),
        sessionDirectory: getTestDirs().testDir,
      });

      await hookRegistry['execute.after']!(
        createMockToolExecuteAfter({
          sessionID: 's1',
          tool: 'read',
          input: { filePath: 'src/index.ts' },
        })
      );

      const state = __testOnly.getSessionStateSnapshot('s1');
      expect(state?.pendingHookInjections).toContain('# Post rule');
    });
  });

  describe('cleanup', () => {
    it('disposes all registrations', async () => {
      const { cleanup, ctx } = await createRuntime({});
      await cleanup();
      expect(ctx.session.hook).toHaveBeenCalledTimes(1);
      expect(ctx.tool.hook).toHaveBeenCalledTimes(2);
    });
  });
});
