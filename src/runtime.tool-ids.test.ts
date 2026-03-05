import { describe, it, expect } from 'vitest';
import { OpenCodeRulesRuntime } from './runtime.js';
import { SessionStore } from './session-store.js';
import * as runtimeModule from './runtime.js';
import * as runtimeContextModule from './runtime-context.js';
import * as runtimeChatModule from './runtime-chat.js';

describe('runtime module runtime exports', () => {
  it('exports only OpenCodeRulesRuntime class at runtime', () => {
    const exportedKeys = Object.keys(runtimeModule).sort();
    expect(exportedKeys).toEqual(['OpenCodeRulesRuntime']);
  });
});

describe('runtime module boundaries', () => {
  it('exports buildFilterContext from runtime-context module', () => {
    expect(runtimeContextModule.buildFilterContext).toBeDefined();
    expect(typeof runtimeContextModule.buildFilterContext).toBe('function');
  });

  it('exports detectCiEnvironment from runtime-context module', () => {
    expect(runtimeContextModule.detectCiEnvironment).toBeDefined();
    expect(typeof runtimeContextModule.detectCiEnvironment).toBe('function');
  });

  it('exports handleChatMessage from runtime-chat module', () => {
    expect(runtimeChatModule.handleChatMessage).toBeDefined();
    expect(typeof runtimeChatModule.handleChatMessage).toBe('function');
  });

  it('exports extractUserPromptFromParts from runtime-chat module', () => {
    expect(runtimeChatModule.extractUserPromptFromParts).toBeDefined();
    expect(typeof runtimeChatModule.extractUserPromptFromParts).toBe(
      'function'
    );
  });
});

describe('OpenCodeRulesRuntime.queryAvailableToolIDs', () => {
  it('augments tool ids with connected mcp capability ids', async () => {
    const runtime = new OpenCodeRulesRuntime({
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
      ruleFiles: [],
      sessionStore: new SessionStore({ max: 10 }),
      debugLog: () => {},
    });

    const ids: string[] = await (runtime as any).queryAvailableToolIDs();
    expect(ids).toContain('bash');
    expect(ids).toContain('mcp_context7');
  });

  it('handles missing mcp.status gracefully', async () => {
    const runtime = new OpenCodeRulesRuntime({
      client: {
        tool: { ids: async () => ({ data: ['bash'] }) },
        // no mcp property
      } as any,
      directory: '/tmp',
      projectDirectory: '/tmp',
      ruleFiles: [],
      sessionStore: new SessionStore({ max: 10 }),
      debugLog: () => {},
    });

    const ids: string[] = await (runtime as any).queryAvailableToolIDs();
    expect(ids).toContain('bash');
    // Should not throw, just not include mcp_ ids
  });
});
