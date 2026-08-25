import { extractTextFromParts } from './message-context.js';
import type { SessionStore } from './session-store.js';
import type { DebugLog } from './debug.js';

export interface ChatMessageInput {
  sessionID?: string;
  model?: { modelID?: string };
  agent?: string;
}

export interface ChatMessageOutput {
  message?: {
    role?: string;
    agent?: string;
    model?: { modelID?: string };
  };
  parts?: Array<{ type?: string; text?: string; synthetic?: boolean }>;
}

/**
 * Update session state from incoming chat message data.
 * Captures user prompts, model IDs, and agent types.
 */
export function updateSessionFromChatMessage(
  input: ChatMessageInput,
  output: ChatMessageOutput,
  sessionStore: SessionStore,
  debugLog: DebugLog
): void {
  const sessionID = input?.sessionID;
  if (!sessionID) {
    debugLog('No sessionID in chat.message hook input');
    return;
  }

  if (output?.message?.role !== 'user') {
    return;
  }

  const userPrompt = output.parts ? extractTextFromParts(output.parts) : '';
  const modelID = output.message.model?.modelID ?? input.model?.modelID;
  const agent = output.message.agent ?? input.agent;

  sessionStore.upsert(sessionID, state => {
    if (userPrompt) {
      state.lastUserPrompt = userPrompt;
      state.rulesInjected = false;
    }

    if (modelID) {
      state.lastModelID = modelID;
    }
    if (agent) {
      state.lastAgentType = agent;
    }
  });

  debugLog(
    `Updated session ${sessionID} from chat.message (model=${modelID ?? 'none'}, agent=${agent ?? 'none'})`
  );
}
