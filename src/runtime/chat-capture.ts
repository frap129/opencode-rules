// Session context capture for v2. The v1 chat.message hook is gone; the
// session `context` hook is the model/agent source of truth (SessionContext
// carries agent + model), and the session `prompt` hook is the user-prompt
// source (SessionPrompt.prompt.text). Synthetic messages do not run prompt
// hooks, so model/agent tracked here persist across synthetic turns.

import { extractTextFromParts } from '../session/message-extraction.js';
import type { MessageWithInfo } from '../session/message-extraction.js';
import type { SessionStore } from '../session/session-store.js';
import type { DebugLog } from '../shared/debug.js';

export interface CapturedTurnContext {
  modelID?: string;
  agentType?: string;
  userPrompt?: string;
}

/** Session prompt hook: capture the admitted user prompt text. */
export function captureSessionPrompt(
  input: { sessionID?: string; prompt?: { text?: string } },
  sessionStore: SessionStore,
  debugLog: DebugLog
): CapturedTurnContext | undefined {
  const sessionID = input?.sessionID;
  const userPrompt = input?.prompt?.text;
  if (!sessionID || !userPrompt) {
    return undefined;
  }

  sessionStore.upsert(sessionID, state => {
    state.lastUserPrompt = userPrompt;
  });

  debugLog(
    `Captured user prompt for session ${sessionID} (len=${userPrompt.length})`
  );

  const captured: CapturedTurnContext = { userPrompt };
  return captured;
}

/** Session context hook: capture model, agent, and any latest user prompt. */
export function captureSessionContext(
  input: {
    sessionID?: string;
    agent?: string;
    /** v2 hook shape: Model.Ref ({ providerID, id, variant? }); id is the model ID. */
    model?: { id?: string; providerID?: string; variant?: string };
    messages?: readonly MessageWithInfo[];
  },
  sessionStore: SessionStore,
  debugLog: DebugLog
): CapturedTurnContext | undefined {
  const sessionID = input?.sessionID;
  if (!sessionID) {
    debugLog('No sessionID in session context hook input');
    return undefined;
  }

  const modelID = input.model?.id;
  const agentType = input.agent;
  const userPrompt = input.messages
    ? extractLatestUserPromptText(input.messages)
    : undefined;

  sessionStore.upsert(sessionID, state => {
    if (modelID) state.lastModelID = modelID;
    if (agentType) state.lastAgentType = agentType;
    if (userPrompt) state.lastUserPrompt = userPrompt;
  });

  debugLog(
    `Captured session context for ${sessionID} (model=${modelID ?? 'none'}, agent=${agentType ?? 'none'})`
  );

  const captured: CapturedTurnContext = {};
  if (modelID !== undefined) captured.modelID = modelID;
  if (agentType !== undefined) captured.agentType = agentType;
  if (userPrompt !== undefined) captured.userPrompt = userPrompt;
  return captured;
}

// Mirrors message-extraction.extractLatestUserPrompt for the already
// normalized message form captured by the context hook.
function extractLatestUserPromptText(
  messages: readonly MessageWithInfo[]
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.info?.role !== 'user') continue;
    const parts = message.parts ?? [];
    const text = extractTextFromParts(parts);
    if (text) return text;
  }
  return undefined;
}
