/**
 * OpenCode Rules Plugin
 *
 * This plugin discovers markdown rule files from standard directories
 * and injects them into the system prompt via transform hooks.
 */

import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import {
  discoverRuleFiles,
  readAndFormatRules,
  extractFilePathsFromMessages,
} from './utils.js';

/**
 * Module-level storage for file context between hook calls.
 * The messages.transform hook populates this, system.transform reads it.
 */
let currentContextPaths: string[] = [];

/**
 * OpenCode Rules Plugin
 * Discovers markdown rule files and injects them into the system prompt
 * using experimental transform hooks.
 */
const openCodeRulesPlugin: Plugin = async (input: PluginInput) => {
  // Discover rule files from global and project directories
  const ruleFiles = await discoverRuleFiles(input.directory);

  console.debug(`[opencode-rules] Discovered ${ruleFiles.length} rule file(s)`);

  return {
    /**
     * Extract file paths from messages for conditional rule filtering.
     * This hook fires before system.transform.
     */
    'experimental.chat.messages.transform': async ({
      output,
    }: {
      output: any;
    }) => {
      // Extract paths from all messages
      currentContextPaths = extractFilePathsFromMessages(output.messages);

      console.debug(
        `[opencode-rules] Extracted ${currentContextPaths.length} context path(s) from messages`
      );

      // Don't modify messages - just extract context
      return output;
    },

    /**
     * Inject rules into the system prompt.
     * Uses context paths from the messages.transform hook.
     */
    'experimental.chat.system.transform': async ({
      output,
    }: {
      output: any;
    }) => {
      // Format rules, filtering by context paths
      const formattedRules = await readAndFormatRules(
        ruleFiles,
        currentContextPaths
      );

      if (!formattedRules) {
        console.debug(
          '[opencode-rules] No applicable rules for current context'
        );
        return output;
      }

      console.debug('[opencode-rules] Injecting rules into system prompt');

      // Append rules to system prompt
      return {
        ...output,
        system: output.system
          ? `${output.system}\n\n${formattedRules}`
          : formattedRules,
      };
    },
  };
};

export default openCodeRulesPlugin;
