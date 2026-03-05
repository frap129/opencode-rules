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
 * Extract user prompt text from chat message parts.
 * Returns empty string if no text parts found.
 */
export function extractUserPromptFromParts(
  parts:
    | Array<{ type?: string; text?: string; synthetic?: boolean }>
    | undefined
): string {
  if (!parts) return '';
  return extractTextFromParts(parts);
}

/**
 * Handle incoming chat messages to update session state.
 * Captures user prompts, model IDs, and agent types.
 */
export function handleChatMessage(
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

  const userPrompt = extractUserPromptFromParts(output.parts);

  sessionStore.upsert(sessionID, state => {
    if (userPrompt) {
      state.lastUserPrompt = userPrompt;
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
