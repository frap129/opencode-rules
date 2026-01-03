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
 * Per-session storage for file context between hook calls.
 * Uses a Map keyed by the output object reference to avoid race conditions.
 * The messages.transform hook populates this, system.transform reads it,
 * then cleanup removes the entry to prevent memory leaks.
 */
const sessionContextMap = new WeakMap<object, string[]>();

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
      // Extract paths from all messages and store per-session
      const contextPaths = extractFilePathsFromMessages(output.messages);
      sessionContextMap.set(output, contextPaths);

      console.debug(
        `[opencode-rules] Extracted ${contextPaths.length} context path(s) from messages`
      );

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
      // Retrieve context paths specific to this session
      const contextPaths = sessionContextMap.get(output) || [];

      // Format rules, filtering by context paths
      // TODO(Task 1.3): Fix readAndFormatRules signature to accept string[] for proper multi-file filtering
      const formattedRules = await readAndFormatRules(
        ruleFiles,
        contextPaths as any
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
