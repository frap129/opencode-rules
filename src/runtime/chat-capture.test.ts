import { describe, expect, it, vi } from 'vitest';
import { updateSessionFromChatMessage } from './chat-capture.js';
import { SessionStore } from '../session/session-store.js';

describe('updateSessionFromChatMessage', () => {
  it('captures canonical model and agent from output.message', () => {
    const store = new SessionStore();

    updateSessionFromChatMessage(
      { sessionID: 'ses_output' },
      {
        message: {
          role: 'user',
          agent: 'build',
          model: { modelID: 'claude-opus' },
        },
        parts: [{ type: 'text', text: 'hello' }],
      },
      store,
      vi.fn()
    );

    expect(store.get('ses_output')?.lastAgentType).toBe('build');
    expect(store.get('ses_output')?.lastModelID).toBe('claude-opus');
  });

  it('falls back to model and agent from input', () => {
    const store = new SessionStore();

    updateSessionFromChatMessage(
      {
        sessionID: 'ses_input',
        agent: 'plan',
        model: { modelID: 'input-model' },
      },
      { message: { role: 'user' }, parts: [] },
      store,
      vi.fn()
    );

    expect(store.get('ses_input')?.lastAgentType).toBe('plan');
    expect(store.get('ses_input')?.lastModelID).toBe('input-model');
  });

  it('prefers output.message values when both sources provide context', () => {
    const store = new SessionStore();

    updateSessionFromChatMessage(
      {
        sessionID: 'ses_precedence',
        agent: 'input-agent',
        model: { modelID: 'input-model' },
      },
      {
        message: {
          role: 'user',
          agent: 'output-agent',
          model: { modelID: 'output-model' },
        },
        parts: [],
      },
      store,
      vi.fn()
    );

    expect(store.get('ses_precedence')?.lastAgentType).toBe('output-agent');
    expect(store.get('ses_precedence')?.lastModelID).toBe('output-model');
  });

  it('does not update context from non-user messages', () => {
    const store = new SessionStore();
    store.upsert('ses_assistant', state => {
      state.lastAgentType = 'existing-agent';
      state.lastModelID = 'existing-model';
    });

    updateSessionFromChatMessage(
      {
        sessionID: 'ses_assistant',
        agent: 'input-agent',
        model: { modelID: 'input-model' },
      },
      {
        message: {
          role: 'assistant',
          agent: 'output-agent',
          model: { modelID: 'output-model' },
        },
        parts: [],
      },
      store,
      vi.fn()
    );

    expect(store.get('ses_assistant')?.lastAgentType).toBe('existing-agent');
    expect(store.get('ses_assistant')?.lastModelID).toBe('existing-model');
  });

  it('returns captured prompt, model, and agent for user messages', () => {
    const store = new SessionStore();

    const captured = updateSessionFromChatMessage(
      { sessionID: 'ses_cap', model: { modelID: 'fallback-model' } },
      {
        message: {
          role: 'user',
          agent: 'build',
          model: { modelID: 'claude-opus' },
        },
        parts: [{ type: 'text', text: 'hello' }],
      },
      store,
      vi.fn()
    );

    expect(captured).toEqual({
      userPrompt: 'hello',
      modelID: 'claude-opus',
      agentType: 'build',
    });
  });

  it('returns undefined for non-user messages', () => {
    const store = new SessionStore();

    const captured = updateSessionFromChatMessage(
      { sessionID: 'ses_asst' },
      { message: { role: 'assistant' }, parts: [] },
      store,
      vi.fn()
    );

    expect(captured).toBeUndefined();
  });
});
