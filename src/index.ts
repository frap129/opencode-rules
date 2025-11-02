/**
 * OpenCode Rules Plugin
 *
 * This plugin discovers markdown rule files from standard directories
 * and injects them into the OpenCode agent system prompt.
 */

import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import { discoverRuleFiles, readAndFormatRules } from './utils.js';

/**
 * OpenCode Rules Plugin
 * Discovers markdown rule files and injects them into system prompts
 */
const openCodeRulesPlugin: Plugin = async (input: PluginInput) => {
  // Discover rule files from global and project directories
  const ruleFiles = await discoverRuleFiles(input.directory);
  const formattedRules = await readAndFormatRules(ruleFiles);

  return {
    'chat.params': async (_input: any, output: any) => {
      if (formattedRules) {
        output.options.systemPromptSuffix = formattedRules;
      }
    },
  };
};

export default openCodeRulesPlugin;
