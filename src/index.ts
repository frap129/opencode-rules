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
 * Uses a Map keyed by the output object reference to avoid race conditions.
 * The messages.transform hook populates this, system.transform reads it,
 * then cleanup removes the entry to prevent memory leaks.
 */
interface SessionContext {
  filePaths: string[];
  userPrompt: string | undefined;
}

const sessionContextMap = new WeakMap<object, SessionContext>();

/**
 * Extract the latest user message text from messages array.
 * @param messages - Array of conversation messages
 * @returns The text content of the last user message, or undefined
 */
function extractLatestUserPrompt(messages: any[]): string | undefined {
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user') {
      // Extract text from parts
      const textParts = message.parts
        ?.filter((part: any) => part.type === 'text')
        .map((part: any) => part.text);

      if (textParts && textParts.length > 0) {
        return textParts.join(' ');
      }
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

  console.debug(`[opencode-rules] Discovered ${ruleFiles.length} rule file(s)`);

  return {
    /**
     * Extract file paths from messages for conditional rule filtering.
     * This hook fires before system.transform.
     * Stores context in a WeakMap keyed by output object to avoid race conditions.
     */
    'experimental.chat.messages.transform': async ({
      output,
    }: {
      output: any;
    }) => {
      // Extract paths from all messages
      const contextPaths = extractFilePathsFromMessages(output.messages);
      // Extract latest user prompt for keyword matching
      const userPrompt = extractLatestUserPrompt(output.messages);

      // Store both in session context
      sessionContextMap.set(output, {
        filePaths: contextPaths,
        userPrompt,
      });

      if (contextPaths.length > 0) {
        console.debug(
          `[opencode-rules] Extracted ${contextPaths.length} context path(s): ${contextPaths.slice(0, 5).join(', ')}${contextPaths.length > 5 ? '...' : ''}`
        );
      } else {
        console.debug('[opencode-rules] No file paths found in messages');
      }

      if (userPrompt) {
        console.debug(
          `[opencode-rules] User prompt: "${userPrompt.slice(0, 50)}${userPrompt.length > 50 ? '...' : ''}"`
        );
      }

      // Don't modify messages - just extract context
      return output;
    },

    /**
     * Inject rules into the system prompt.
     * Uses context paths from the messages.transform hook, retrieved from per-session storage.
     */
    'experimental.chat.system.transform': async ({
      output,
    }: {
      output: any;
    }) => {
      // Retrieve context specific to this session
      const sessionContext = sessionContextMap.get(output);
      const contextPaths = sessionContext?.filePaths || [];
      const userPrompt = sessionContext?.userPrompt;

      // Format rules, filtering by context paths and user prompt
      const formattedRules = await readAndFormatRules(
        ruleFiles,
        contextPaths,
        userPrompt
      );

      if (!formattedRules) {
        console.debug(
          '[opencode-rules] No applicable rules for current context'
        );
        // Clean up after use
        sessionContextMap.delete(output);
        return output;
      }

      console.debug('[opencode-rules] Injecting rules into system prompt');

      // Append rules to system prompt
      const result = {
        ...output,
        system: output.system
          ? `${output.system}\n\n${formattedRules}`
          : formattedRules,
      };

      // Clean up after use to prevent memory leaks
      sessionContextMap.delete(output);

      return result;
    },
  };
};

export default openCodeRulesPlugin;
