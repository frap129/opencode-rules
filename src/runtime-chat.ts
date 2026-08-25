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
  parts?: Array<{
    id?: string;
    type?: string;
    text?: string;
    synthetic?: boolean;
  }>;
}

export interface CapturedChatContext {
  userPrompt: string;
  modelID?: string;
  agentType?: string;
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
): CapturedChatContext | undefined {
  const sessionID = input?.sessionID;
  if (!sessionID) {
    debugLog('No sessionID in chat.message hook input');
    return undefined;
  }

  if (output?.message?.role !== 'user') {
    return undefined;
  }

  const userPrompt = output.parts ? extractTextFromParts(output.parts) : '';
  const modelID = output.message.model?.modelID ?? input.model?.modelID;
  const agent = output.message.agent ?? input.agent;

  sessionStore.upsert(sessionID, state => {
    if (userPrompt) {
      state.lastUserPrompt = userPrompt;
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

  const captured: CapturedChatContext = { userPrompt };
  if (modelID !== undefined) {
    captured.modelID = modelID;
  }
  if (agent !== undefined) {
    captured.agentType = agent;
  }
  return captured;
}
