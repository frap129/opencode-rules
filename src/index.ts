/**
 * OpenCode Rules Plugin
 *
 * This plugin discovers markdown rule files from standard directories
 * and injects them into the system prompt via transform hooks.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import {
  discoverRuleFiles,
  readAndFormatRules,
  extractFilePathsFromMessages,
} from './utils.js';

/**
 * Per-session storage for context between hook calls.
 * Uses a Map keyed by sessionID to share context between messages.transform and system.transform.
 * The messages.transform hook populates this, system.transform reads it and deletes the entry.
 */
interface SessionContext {
  filePaths: string[];
  userPrompt: string | undefined;
}

const sessionContextMap = new Map<string, SessionContext>();

/**
 * Debug logging helper - only logs when OPENCODE_RULES_DEBUG env var is set.
 * This prevents noisy output during normal operation.
 */
function debugLog(message: string): void {
  if (process.env.OPENCODE_RULES_DEBUG) {
    console.debug(`[opencode-rules] ${message}`);
  }
}

/**
 * Message part with optional sessionID (for messages.transform hook)
 */
interface MessagePartWithSession {
  type?: string;
  text?: string;
  sessionID?: string;
  synthetic?: boolean;
}

/**
 * Message with optional info containing sessionID
 */
interface MessageWithInfo {
  role?: string;
  parts?: MessagePartWithSession[];
  info?: {
    sessionID?: string;
  };
}

/**
 * Output from the messages.transform hook
 */
interface MessagesTransformOutput {
  messages: MessageWithInfo[];
}

/**
 * Input for the system.transform hook
 */
interface SystemTransformInput {
  sessionID?: string;
}

/**
 * Output from the system.transform hook
 */
interface SystemTransformOutput {
  system?: string | string[];
}

/**
 * Extract sessionID from messages array.
 * Messages contain sessionID in their parts or info.
 */
function extractSessionID(messages: MessageWithInfo[]): string | undefined {
  for (const message of messages) {
    // Check message.info for sessionID
    if (message.info?.sessionID) {
      return message.info.sessionID;
    }
    // Check parts for sessionID
    if (message.parts) {
      for (const part of message.parts) {
        if (part.sessionID) {
          return part.sessionID;
        }
      }
    }
  }
  return undefined;
}

/**
 * Extract the latest user message text from messages array.
 * Handles multiple message formats from OpenCode.
 * @param messages - Array of conversation messages
 * @returns The text content of the last message with text, or undefined
 */
function extractLatestUserPrompt(
  messages: MessageWithInfo[]
): string | undefined {
  // Find the last message with text content
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const parts = message.parts || [];

    // Extract text from parts - handle multiple formats:
    // 1. { type: 'text', text: '...' } - standard format
    // 2. { text: '...' } - alternative format without type field
    const textParts: string[] = [];
    for (const part of parts) {
      // Skip synthetic/system-injected parts
      if (part.synthetic) continue;

      if (part.type === 'text' && part.text) {
        textParts.push(part.text);
      } else if (typeof part.text === 'string' && !part.type) {
        textParts.push(part.text);
      }
    }

    if (textParts.length > 0) {
      return textParts.join(' ');
    }
  }
  return undefined;
}

/**
 * OpenCode Rules Plugin
 * Discovers markdown rule files and injects them into the system prompt
 * using experimental transform hooks.
 */
const openCodeRulesPlugin = async (input: PluginInput) => {
  // Discover rule files from global and project directories
  const ruleFiles = await discoverRuleFiles(input.directory);

  debugLog(`Discovered ${ruleFiles.length} rule file(s)`);

  return {
    /**
     * Extract file paths from messages for conditional rule filtering.
     * This hook fires before system.transform.
     * Stores context in a Map keyed by sessionID extracted from messages.
     */
    'experimental.chat.messages.transform': async (
      _input: Record<string, never>,
      output: MessagesTransformOutput
    ): Promise<MessagesTransformOutput> => {
      // Extract sessionID from messages to use as storage key
      const sessionID = extractSessionID(output.messages);
      if (!sessionID) {
        debugLog('No sessionID found in messages');
        return output;
      }

      // Extract paths from all messages (cast to compatible type)
      const contextPaths = extractFilePathsFromMessages(
        output.messages as unknown as Parameters<
          typeof extractFilePathsFromMessages
        >[0]
      );
      // Extract latest user prompt for keyword matching
      const userPrompt = extractLatestUserPrompt(output.messages);

      // Store both in session context keyed by sessionID
      sessionContextMap.set(sessionID, {
        filePaths: contextPaths,
        userPrompt,
      });

      if (contextPaths.length > 0) {
        debugLog(
          `Extracted ${contextPaths.length} context path(s): ${contextPaths.slice(0, 5).join(', ')}${contextPaths.length > 5 ? '...' : ''}`
        );
      }

      if (userPrompt) {
        debugLog(
          `User prompt: "${userPrompt.slice(0, 50)}${userPrompt.length > 50 ? '...' : ''}"`
        );
      }

      // Don't modify messages - just extract context
      return output;
    },

    /**
     * Inject rules into the system prompt.
     * Uses context from the messages.transform hook, retrieved via sessionID.
     * Deletes the session context after reading to prevent memory leaks.
     */
    'experimental.chat.system.transform': async (
      input: SystemTransformInput,
      output: SystemTransformOutput | null
    ): Promise<SystemTransformOutput> => {
      // Retrieve context using sessionID from input
      const sessionID = input?.sessionID;
      const sessionContext = sessionID
        ? sessionContextMap.get(sessionID)
        : undefined;
      const contextPaths = sessionContext?.filePaths || [];
      const userPrompt = sessionContext?.userPrompt;

      // Delete the session context after reading to prevent memory leaks
      if (sessionID) {
        sessionContextMap.delete(sessionID);
      }

      // Format rules, filtering by context paths and user prompt
      const formattedRules = await readAndFormatRules(
        ruleFiles,
        contextPaths,
        userPrompt
      );

      if (!formattedRules) {
        debugLog('No applicable rules for current context');
        return output ?? {};
      }

      debugLog('Injecting rules into system prompt');

      // Handle both array format (runtime) and string format (tests)
      if (!output) {
        return { system: formattedRules };
      } else if (Array.isArray(output.system)) {
        output.system.push(formattedRules);
      } else {
        output.system = output.system
          ? `${output.system}\n\n${formattedRules}`
          : formattedRules;
      }

      return output;
    },
  };
};

export default openCodeRulesPlugin;
