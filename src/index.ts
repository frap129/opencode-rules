/**
 * OpenCode Rules Plugin
 *
 * This plugin discovers markdown rule files from standard directories
 * and injects them via silent messages when sessions are created or compacted.
 */

import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import { discoverRuleFiles, readAndFormatRules } from './utils.js';

/**
 * OpenCode Rules Plugin
 * Discovers markdown rule files and sends them as silent messages
 * on session creation and compaction events.
 */
const openCodeRulesPlugin: Plugin = async (input: PluginInput) => {
  // Discover rule files from global and project directories
  const ruleFiles = await discoverRuleFiles(input.directory);
  const formattedRules = await readAndFormatRules(ruleFiles);

  // Track which sessions have received rules to avoid duplicates
  const sessionsWithRules = new Set<string>();

  /**
   * Send a silent message (no AI response) with the rules
   */
  const sendRulesMessage = async (sessionID: string) => {
    if (!formattedRules) {
      return;
    }

    try {
      await input.client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true, // Silent message - no AI response
          parts: [{ type: 'text', text: formattedRules }],
        },
      });

      sessionsWithRules.add(sessionID);
      console.log(`[opencode-rules] Sent rules to session ${sessionID}`);
    } catch (error) {
      console.error(
        `[opencode-rules] Failed to send rules to session ${sessionID}:`,
        error
      );
    }
  };

  return {
    /**
     * Handle session events for creation and compaction
     */
    event: async ({ event }) => {
      if (!formattedRules) {
        return;
      }

      // Send rules when a new session is created
      if (event.type === 'session.created') {
        const sessionID = event.properties.info.id;
        if (!sessionsWithRules.has(sessionID)) {
          await sendRulesMessage(sessionID);
        }
      }

      // Re-send rules when a session is compacted
      if (event.type === 'session.compacted') {
        const sessionID = event.properties.sessionID;
        // Remove from tracking and re-send
        sessionsWithRules.delete(sessionID);
        await sendRulesMessage(sessionID);
        console.log(
          `[opencode-rules] Session ${sessionID} compacted - rules re-sent`
        );
      }
    },
  };
};

export default openCodeRulesPlugin;
