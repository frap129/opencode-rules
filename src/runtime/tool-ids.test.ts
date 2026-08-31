import { describe, it, expect } from 'vitest';
import { OpenCodeClientAdapter } from './client-adapter.js';
import * as runtimeModule from './orchestrator.js';
import * as runtimeContextModule from './match-context.js';
import * as runtimeChatModule from './chat-capture.js';

describe('runtime module runtime exports', () => {
  it('exports only OpenCodeRulesRuntime class at runtime', () => {
    const exportedKeys = Object.keys(runtimeModule).sort();
    expect(exportedKeys).toEqual(['OpenCodeRulesRuntime']);
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

  it('exports updateSessionFromChatMessage from chat-capture module', () => {
    expect(runtimeChatModule.updateSessionFromChatMessage).toBeDefined();
    expect(typeof runtimeChatModule.updateSessionFromChatMessage).toBe(
      'function'
    );
  });
});

describe('OpenCodeClientAdapter.queryAvailableToolIDs', () => {
  it('augments tool ids with connected mcp capability ids', async () => {
    const adapter = new OpenCodeClientAdapter({
      client: {
        tool: { ids: async () => ({ data: ['bash'] }) },
        mcp: {
          status: async () => ({
            data: { context7: { status: 'connected' } },
          }),
        },
      } as any,
      directory: '/tmp',
      projectDirectory: '/tmp',
      debugLog: () => {},
    });

    const ids: string[] = await adapter.queryAvailableToolIDs();
    expect(ids).toContain('bash');
    expect(ids).toContain('mcp_context7');
  });

  it('handles missing mcp.status gracefully', async () => {
    const adapter = new OpenCodeClientAdapter({
      client: {
        tool: { ids: async () => ({ data: ['bash'] }) },
      } as any,
      directory: '/tmp',
      projectDirectory: '/tmp',
      debugLog: () => {},
    });

    const ids: string[] = await adapter.queryAvailableToolIDs();
    expect(ids).toContain('bash');
  });
});
