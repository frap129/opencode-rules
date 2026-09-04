import { describe, it, expect } from 'vitest';
import { OpenCodeClientAdapter } from './client-adapter.js';
import * as runtimeModule from './orchestrator.js';
import * as runtimeContextModule from './match-context.js';
import * as runtimeChatModule from './chat-capture.js';
import * as createRuntimeModule from './create-runtime.js';

describe('runtime module runtime exports', () => {
  it('exports only the OpenCodeRulesRuntime class at runtime', () => {
    const exportedKeys = Object.keys(runtimeModule).sort();
    // V2* interfaces are types and vanish at runtime.
    expect(exportedKeys).toEqual(['OpenCodeRulesRuntime']);
  });

  it('exports createRuntime from the create-runtime module', () => {
    const exportedKeys = Object.keys(createRuntimeModule).sort();
    expect(exportedKeys).toEqual(['createRuntime']);
    expect(typeof createRuntimeModule.createRuntime).toBe('function');
  });
});

describe('runtime module boundaries', () => {
  it('exports buildRuleMatchContext from match-context module', () => {
    expect(runtimeContextModule.buildRuleMatchContext).toBeDefined();
    expect(typeof runtimeContextModule.buildRuleMatchContext).toBe('function');
  });

  it('exports detectCiEnvironment from match-context module', () => {
    expect(runtimeContextModule.detectCiEnvironment).toBeDefined();
    expect(typeof runtimeContextModule.detectCiEnvironment).toBe('function');
  });

  it('exports captureSessionContext and captureSessionPrompt from chat-capture module', () => {
    expect(runtimeChatModule.captureSessionContext).toBeDefined();
    expect(typeof runtimeChatModule.captureSessionContext).toBe('function');
    expect(runtimeChatModule.captureSessionPrompt).toBeDefined();
    expect(typeof runtimeChatModule.captureSessionPrompt).toBe('function');
  });
});

describe('OpenCodeClientAdapter.queryAvailableToolIDs', () => {
  it('merges context-hook tool ids with connected v2 mcp servers', async () => {
    const adapter = new OpenCodeClientAdapter({
      client: {
        mcp: {
          list: async () => ({
            data: [{ name: 'context7', status: 'connected' }],
          }),
        },
      } as never,
      directory: '/tmp',
      debugLog: () => {},
    });

    const ids: string[] = await adapter.queryAvailableToolIDs(['bash']);
    expect(ids).toContain('bash');
    expect(ids).toContain('mcp_context7');
  });

  it('handles tagged v2 mcp status objects', async () => {
    const adapter = new OpenCodeClientAdapter({
      client: {
        mcp: {
          list: async () => ({
            data: [
              { name: 'context7', status: { status: 'connected' } },
              { name: 'disabled', status: { status: 'disabled' } },
            ],
          }),
        },
      } as never,
      directory: '/tmp',
      debugLog: () => {},
    });

    const ids: string[] = await adapter.queryAvailableToolIDs([]);
    expect(ids).toEqual(['mcp_context7']);
  });

  it('handles missing mcp.list gracefully', async () => {
    const adapter = new OpenCodeClientAdapter({
      client: {},
      directory: '/tmp',
      debugLog: () => {},
    });

    const ids: string[] = await adapter.queryAvailableToolIDs(['bash']);
    expect(ids).toContain('bash');
  });
});
