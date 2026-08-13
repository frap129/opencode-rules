import { describe, it, expectTypeOf } from 'vitest';
import type {
  V2SessionContext,
  V2SystemPart,
  V2Message,
  V2ContentPart,
  V2ToolExecuteBefore,
  V2ToolExecuteAfter,
  V2PluginContext,
} from './v2-types.js';

describe('v2 structural types', () => {
  it('accepts a plain session-context-shaped object', () => {
    expectTypeOf({
      sessionID: 'abc',
      agent: 'build',
      model: { id: 'claude-opus', providerID: 'anthropic' },
      system: [] as V2SystemPart[],
      messages: [] as V2Message[],
      tools: {} as Record<string, { description: string; input: unknown }>,
    }).toMatchTypeOf<V2SessionContext>();
  });

  it('accepts a text content part', () => {
    expectTypeOf({
      type: 'text',
      text: 'hi',
    } as const).toMatchTypeOf<V2ContentPart>();
  });

  it('accepts a tool-call content part with unknown input', () => {
    expectTypeOf({
      type: 'tool-call',
      id: 'c1',
      name: 'read',
      input: { filePath: 'x' },
    } as const).toMatchTypeOf<V2ContentPart>();
  });

  it('accepts a media content part', () => {
    expectTypeOf({
      type: 'media',
      mediaType: 'image/png',
      data: 'x',
    } as const).toMatchTypeOf<V2ContentPart>();
  });

  it('models execute.after as a status union', () => {
    expectTypeOf({
      tool: 'read',
      sessionID: 'abc',
      agent: 'build',
      messageID: 'm1',
      id: 'c1',
      input: { filePath: 'x' },
      status: 'completed',
      result: { output: {}, metadata: {} },
    } as const).toMatchTypeOf<V2ToolExecuteAfter>();
  });

  it('models execute.after error branch', () => {
    expectTypeOf({
      tool: 'read',
      sessionID: 'a',
      agent: 'b',
      messageID: 'm',
      id: 'c',
      input: {},
      status: 'error',
      error: { message: 'boom' },
    } as const).toMatchTypeOf<V2ToolExecuteAfter>();
  });

  it('pins system/messages/tools mutability on session context', () => {
    const s: V2SessionContext = {
      sessionID: 'a',
      agent: 'b',
      model: { id: 'm', providerID: 'p' },
      system: [],
      messages: [],
      tools: {},
    };
    s.system.push({ type: 'text', text: 'x' });
    s.messages.push({ role: 'user', content: [] });
    s.tools['t'] = { description: 'd', input: {} };
  });

  it('models execute.before with mutable input', () => {
    const e: V2ToolExecuteBefore = {
      tool: 'read',
      sessionID: 'abc',
      agent: 'build',
      messageID: 'm1',
      id: 'c1',
      input: { filePath: 'x' },
    };
    e.input = { filePath: 'y' }; // must compile: input is mutable
    expectTypeOf(e.input).toMatchTypeOf<unknown>();
  });

  it('context has hook registrars on session and tool', () => {
    const ctx: V2PluginContext = {
      session: {
        get: async () => undefined,
        hook: async () => ({ dispose: async () => {} }),
      },
      tool: { hook: async () => ({ dispose: async () => {} }) },
    };
    expectTypeOf(ctx.session.hook).toBeFunction();
    expectTypeOf(ctx.tool.hook).toBeFunction();
    expectTypeOf(ctx.session.get).toBeFunction();
  });
});
