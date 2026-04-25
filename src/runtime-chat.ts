import { extractTextFromParts } from './message-context.js';
import type { SessionStore } from './session-store.js';
import type { DebugLog } from './debug.js';

export interface ChatMessageInput {
  sessionID?: string;
  model?: { modelID?: string };
  agent?: string;
}

export interface ChatMessageOutput {
  message?: { role?: string };
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

  sessionStore.upsert(sessionID, state => {
    if (userPrompt) {
      state.lastUserPrompt = userPrompt;
      state.rulesInjected = false;
    }

    if (input.model?.modelID) {
      state.lastModelID = input.model.modelID;
    }
    if (input.agent) {
      state.lastAgentType = input.agent;
    }
  });

  debugLog(
    `Updated session ${sessionID} from chat.message (model=${input.model?.modelID ?? 'none'}, agent=${input.agent ?? 'none'})`
  );
}
