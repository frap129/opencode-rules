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
 * Discovers markdown rule files and injects them into the first message
 */
const openCodeRulesPlugin: Plugin = async (input: PluginInput) => {
  // Discover rule files from global and project directories
  const ruleFiles = await discoverRuleFiles(input.directory);
  const formattedRules = await readAndFormatRules(ruleFiles);

  // Track which sessions have received rules
  const sessionsWithRules = new Set<string>();

  return {
    'chat.message': async (_hookInput: any, output: any) => {
      // Only append rules if they exist
      if (!formattedRules) {
        return;
      }

      // Get the session ID
      const sessionID = output.message?.sessionID;
      if (!sessionID) {
        return;
      }

      // Check if this session already has rules
      if (sessionsWithRules.has(sessionID)) {
        return;
      }

      // Add rules to the first message
      if (output.parts && Array.isArray(output.parts)) {
        const textPart = output.parts.find((part: any) => part.type === 'text');
        if (textPart && !textPart.text.includes('# OpenCode Rules')) {
          textPart.text = formattedRules + '\n\n' + (textPart.text || '');
          sessionsWithRules.add(sessionID);
        }
      }
    },
  };
};

export default openCodeRulesPlugin;
