import { describe, expect, it, vi } from 'vitest';
import { captureSessionContext, captureSessionPrompt } from './chat-capture.js';
import { SessionStore } from '../session/session-store.js';

describe('captureSessionPrompt', () => {
  it('captures the admitted prompt text', () => {
    const store = new SessionStore();

    const captured = captureSessionPrompt(
      { sessionID: 'ses_prompt', prompt: { text: 'please add tests' } },
      store,
      vi.fn()
    );

    expect(captured).toEqual({ userPrompt: 'please add tests' });
    expect(store.get('ses_prompt')?.lastUserPrompt).toBe('please add tests');
  });

  it('overwrites the prompt on each admission', () => {
    const store = new SessionStore();

    captureSessionPrompt(
      { sessionID: 'ses_turns', prompt: { text: 'first' } },
      store,
      vi.fn()
    );
    captureSessionPrompt(
      { sessionID: 'ses_turns', prompt: { text: 'second' } },
      store,
      vi.fn()
    );

    expect(store.get('ses_turns')?.lastUserPrompt).toBe('second');
  });

  it('returns undefined without a sessionID or prompt text', () => {
    const store = new SessionStore();

    expect(
      captureSessionPrompt({ prompt: { text: 'hi' } }, store, vi.fn())
    ).toBeUndefined();
    expect(
      captureSessionPrompt({ sessionID: 'ses_none' }, store, vi.fn())
    ).toBeUndefined();
  });
});

describe('captureSessionContext', () => {
  it('captures model and agent from the context hook input', () => {
    const store = new SessionStore();

    const captured = captureSessionContext(
      {
        sessionID: 'ses_output',
        agent: 'build',
        model: { id: 'claude-opus' },
        messages: [],
      },
      store,
      vi.fn()
    );

    expect(captured).toEqual({
      modelID: 'claude-opus',
      agentType: 'build',
      userPrompt: undefined,
    });
    expect(store.get('ses_output')?.lastAgentType).toBe('build');
    expect(store.get('ses_output')?.lastModelID).toBe('claude-opus');
  });

  it('extracts the latest user prompt from normalized messages', () => {
    const store = new SessionStore();

    const captured = captureSessionContext(
      {
        sessionID: 'ses_latest',
        agent: 'plan',
        messages: [
          {
            info: { id: 'msg_1', role: 'user' },
            parts: [{ type: 'text', text: 'first' }],
          },
          {
            info: { id: 'msg_2', role: 'assistant' },
            parts: [{ type: 'text', text: 'reply' }],
          },
          {
            info: { id: 'msg_3', role: 'user' },
            parts: [{ type: 'text', text: 'second' }],
          },
        ],
      },
      store,
      vi.fn()
    );

    expect(captured?.userPrompt).toBe('second');
    expect(store.get('ses_latest')?.lastUserPrompt).toBe('second');
  });

  it('skips synthetic parts when extracting the user prompt', () => {
    const store = new SessionStore();

    const captured = captureSessionContext(
      {
        sessionID: 'ses_synth',
        messages: [
          {
            info: { id: 'msg_rule_ephemeral_x', role: 'user' },
            parts: [
              {
                id: 'prt_rule_ephemeral_x',
                type: 'text',
                text: 'injected',
                synthetic: true,
              },
            ],
          },
        ],
      },
      store,
      vi.fn()
    );

    expect(captured?.userPrompt).toBeUndefined();
    expect(store.get('ses_synth')?.lastUserPrompt).toBeUndefined();
  });

  it('captures the bare model id from a variant-bearing Model.Ref', () => {
    const store = new SessionStore();

    const captured = captureSessionContext(
      {
        sessionID: 'ses_variant',
        agent: 'build',
        // Model.Ref.parse("provider/model#high") -> { providerID, id, variant }
        model: { providerID: 'anthropic', id: 'claude-opus', variant: 'high' },
        messages: [],
      },
      store,
      vi.fn()
    );

    expect(captured?.modelID).toBe('claude-opus');
    expect(store.get('ses_variant')?.lastModelID).toBe('claude-opus');
  });

  it('updates model and agent on later dispatches', () => {
    const store = new SessionStore();

    captureSessionContext(
      {
        sessionID: 'ses_update',
        agent: 'agent-v1',
        model: { id: 'model-v1' },
        messages: [],
      },
      store,
      vi.fn()
    );
    captureSessionContext(
      {
        sessionID: 'ses_update',
        agent: 'agent-v2',
        model: { id: 'model-v2' },
        messages: [],
      },
      store,
      vi.fn()
    );

    const snapshot = store.get('ses_update');
    expect(snapshot?.lastModelID).toBe('model-v2');
    expect(snapshot?.lastAgentType).toBe('agent-v2');
  });

  it('returns undefined without a sessionID', () => {
    const store = new SessionStore();

    expect(
      captureSessionContext(
        { agent: 'plan', model: { id: 'm' }, messages: [] },
        store,
        vi.fn()
      )
    ).toBeUndefined();
  });
});
