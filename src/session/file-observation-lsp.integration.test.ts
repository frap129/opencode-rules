/**
 * Server-hook acceptance coverage for every OpenCode LSP operation: raw
 * successful output (including no-results text) is content for the queried
 * path and admits fileContains rules through the real hook seam.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  createMockPluginInput,
  getTestDirs,
  setupTestDirs,
  teardownTestDirs,
} from '../test-fixtures.js';

const LSP_OPERATIONS = [
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
  'goToImplementation',
  'prepareCallHierarchy',
  'incomingCalls',
  'outgoingCalls',
] as const;

describe('LSP observation admission through the server hook', () => {
  let savedXDG: string | undefined;

  beforeEach(() => {
    setupTestDirs();
    savedXDG = process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    teardownTestDirs();
    process.env.XDG_CONFIG_HOME = savedXDG;
  });

  it.each(LSP_OPERATIONS)(
    'admits raw successful %s output for the queried path',
    async operation => {
      const { testDir, globalRulesDir } = getTestDirs();
      writeFileSync(
        path.join(globalRulesDir, `lsp-${operation}.mdc`),
        `---\nfileContains: "lsp:${operation}"\n---\n\nLSP ${operation} guidance.`
      );
      process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

      const promptCalls: Array<{
        body: { noReply?: boolean; parts: Array<Record<string, unknown>> };
      }> = [];
      const {
        default: { server: plugin },
      } = await import('../index.js');
      const hooks = await plugin(
        createMockPluginInput({
          testDir,
          sessionPrompt: async args => {
            promptCalls.push(args);
            return { data: {} };
          },
        }) as unknown as Parameters<typeof plugin>[0]
      );
      const after = hooks['tool.execute.after'] as (
        input: {
          tool: string;
          sessionID: string;
          callID: string;
          args: Record<string, unknown>;
        },
        output: { title: string; output: string; metadata: unknown }
      ) => Promise<void>;

      const output =
        operation === 'workspaceSymbol'
          ? `No results found for ${operation}\nlsp:${operation}`
          : JSON.stringify({ marker: `lsp:${operation}` });

      await after(
        {
          tool: 'lsp',
          sessionID: `ses_lsp_${operation}`,
          callID: `call_${operation}`,
          args: {
            operation,
            filePath: 'src/query.ts',
            line: 1,
            character: 1,
            ...(operation === 'workspaceSymbol' ? { query: '' } : {}),
          },
        },
        { title: operation, output, metadata: {} }
      );

      expect(promptCalls).toHaveLength(1);
      expect(promptCalls[0]?.body.noReply).toBe(true);
      const part = promptCalls[0]?.body.parts[0] ?? {};
      expect(part.metadata).toMatchObject({ ruleAdmission: true });
      expect(String(part.text)).toContain(`LSP ${operation} guidance.`);
    }
  );

  it('keys output to the queried path, not paths inside the output', async () => {
    const { testDir, globalRulesDir } = getTestDirs();
    writeFileSync(
      path.join(globalRulesDir, 'queried.mdc'),
      `---\nglobs:\n  - "src/query.ts"\nfileContains: "/other/file.ts"\n---\n\nQueried file guidance.`
    );
    writeFileSync(
      path.join(globalRulesDir, 'mentioned.mdc'),
      `---\nglobs:\n  - "other/file.ts"\nfileContains: "/other/file.ts"\n---\n\nMentioned file guidance.`
    );
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const promptCalls: Array<{
      body: { parts: Array<Record<string, unknown>> };
    }> = [];
    const {
      default: { server: plugin },
    } = await import('../index.js');
    const hooks = await plugin(
      createMockPluginInput({
        testDir,
        sessionPrompt: async args => {
          promptCalls.push(args);
          return { data: {} };
        },
      }) as unknown as Parameters<typeof plugin>[0]
    );
    const after = hooks['tool.execute.after'] as (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: Record<string, unknown>;
      },
      output: { title: string; output: string; metadata: unknown }
    ) => Promise<void>;

    await after(
      {
        tool: 'lsp',
        sessionID: 'ses_lsp_corr',
        callID: 'call_lsp_corr',
        args: {
          operation: 'findReferences',
          filePath: 'src/query.ts',
          line: 1,
          character: 1,
        },
      },
      {
        title: 'src/query.ts',
        output: JSON.stringify([
          { uri: 'file:///other/file.ts', line: 9, marker: '/other/file.ts' },
        ]),
        metadata: {},
      }
    );

    expect(promptCalls).toHaveLength(1);
    const admittedText = String(promptCalls[0]?.body.parts[0]?.text);
    expect(admittedText).toContain('Queried file guidance');
    expect(admittedText).not.toContain('Mentioned file guidance');
  });
});
