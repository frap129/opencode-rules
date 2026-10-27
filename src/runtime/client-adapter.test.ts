import { describe, expect, it } from 'vitest';
import { OpenCodeClientAdapter } from './client-adapter.js';

describe('OpenCodeClientAdapter.readClientHistory', () => {
  it('passes the v2 session context array to the history decoder', async () => {
    const mockClient = {
      session: {
        context: async () => [
          { id: 'msg_1', type: 'synthetic', text: 'Rule body.' },
        ],
      },
    };
    const adapter = new OpenCodeClientAdapter({
      client: mockClient,
      directory: '/tmp',
      debugLog: () => {},
    });

    const actualHistory = await adapter.readClientHistory('ses_1');

    expect(actualHistory).toEqual({
      ok: true,
      messages: [
        {
          info: { id: 'msg_1', role: 'user' },
          parts: [{ type: 'text', text: 'Rule body.', synthetic: true }],
        },
      ],
    });
  });

  it('does not decode the legacy data envelope', async () => {
    const mockClient = {
      session: {
        // Intentional invalid input: the legacy SDK envelope must be ignored.
        context: async () =>
          ({
            data: [{ id: 'msg_1', type: 'user', text: 'hello' }],
          }) as unknown as readonly unknown[],
      },
    };
    const adapter = new OpenCodeClientAdapter({
      client: mockClient,
      directory: '/tmp',
      debugLog: () => {},
    });

    const actualHistory = await adapter.readClientHistory('ses_1');

    expect(actualHistory).toEqual({ ok: true, messages: [] });
  });
});
