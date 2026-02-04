/**
 * OpenCode Rules Plugin
 *
 * This plugin discovers markdown rule files from standard directories
 * and injects them into the system prompt via transform hooks.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import path from 'path';
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
 * Per-session state that persists across turns for incremental updates.
 * Replaces re-scanning message history each LLM turn with incremental state.
 */
interface SessionState {
  contextPaths: Set<string>;
  lastUserPrompt?: string;
  lastUpdated: number;
  isCompacting?: boolean;
  compactingSince?: number;
}

const sessionStateMap = new Map<string, SessionState>();
let sessionStateMax = 100;
let sessionStateTick = 0;

/**
 * Store the project directory from plugin init for use in path normalization.
 */
let projectDirectory = '';

/**
 * Normalize paths to repo-relative POSIX format.
 * If path is absolute and under baseDir, convert to relative POSIX path.
 * Otherwise return path as-is.
 */
function normalizeContextPath(p: string, baseDir: string): string {
  if (!path.isAbsolute(p)) return p;
  const rel = path.relative(baseDir, p);
  // Convert Windows separators to POSIX
  return rel.split(path.sep).join('/');
}

/**
 * Create a default SessionState object.
 */
function createDefaultSessionState(): SessionState {
  return {
    contextPaths: new Set<string>(),
    lastUpdated: ++sessionStateTick,
  };
}

/**
 * Upsert a session state with a mutator function.
 * Creates default state if missing, updates lastUpdated, and prunes old entries.
 */
function upsertSessionState(
  sessionID: string,
  mutator: (state: SessionState) => void
): void {
  // Create or get existing state
  let state = sessionStateMap.get(sessionID);
  if (!state) {
    state = createDefaultSessionState();
    sessionStateMap.set(sessionID, state);
  }

  // Apply mutations
  mutator(state);

  // Update timestamp
  state.lastUpdated = ++sessionStateTick;

  // Prune oldest entries if over limit
  while (sessionStateMap.size > sessionStateMax) {
    // Find entry with smallest lastUpdated
    let oldestID: string | null = null;
    let oldestTime = Infinity;

    for (const [id, st] of sessionStateMap.entries()) {
      if (st.lastUpdated < oldestTime) {
        oldestTime = st.lastUpdated;
        oldestID = id;
      }
    }

    if (oldestID) {
      sessionStateMap.delete(oldestID);
    }
  }
}

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
      const userPrompt = textParts
        .map(t => t.trim())
        .filter(Boolean)
        .join(' ')
        .trim();
      return userPrompt || undefined;
    }
  }
  return undefined;
}

/**
 * OpenCode Rules Plugin
 * Discovers markdown rule files and injects them into the system prompt
 * using experimental transform hooks.
 */
const openCodeRulesPlugin = async (pluginInput: PluginInput) => {
  // Store client reference for use in hooks
  const client = pluginInput.client;

  // Store project directory for path normalization
  projectDirectory = pluginInput.directory;

  // Discover rule files from global and project directories
  const ruleFiles = await discoverRuleFiles(pluginInput.directory);

  debugLog(`Discovered ${ruleFiles.length} rule file(s)`);

  return {
    /**
     * Capture file paths from tool executions before they run.
     * This hook observes the args passed to tools to record context paths.
     * For tools like read|edit|write, captures filePath.
     * For tools like glob|grep, captures path argument.
     */
    'tool.execute.before': async (
      input: {
        tool?: string;
        sessionID?: string;
        callID?: string;
      },
      output: {
        args?: Record<string, unknown>;
      }
    ): Promise<void> => {
      const sessionID = input?.sessionID;
      const toolName = input?.tool;
      const args = output?.args;

      if (!sessionID || !toolName || !args) {
        return;
      }

      // Determine which argument to extract based on tool name
      let filePath: string | undefined;

      if (['read', 'edit', 'write'].includes(toolName)) {
        const arg = args.filePath;
        if (typeof arg === 'string' && arg.length > 0) {
          filePath = arg;
        }
      } else if (['glob', 'grep'].includes(toolName)) {
        const arg = args.path;
        if (typeof arg === 'string' && arg.length > 0) {
          filePath = arg;
        }
      }

      // Normalize and add path to session state if we found one
      if (filePath) {
        const normalized = normalizeContextPath(filePath, projectDirectory);
        upsertSessionState(sessionID, state => {
          state.contextPaths.add(normalized);
        });

        debugLog(`Recorded context path from tool ${toolName}: ${normalized}`);
      }
    },

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
        debugLog(`Extracted user prompt (len=${userPrompt.length})`);
      }

      // Don't modify messages - just extract context
      return output;
    },

    /**
     * Capture user prompts incrementally as messages arrive.
     * Updates session state with the latest user message text.
     */
    'chat.message': async (
      input: { sessionID?: string },
      output: {
        message?: { role?: string };
        parts?: Array<{ type?: string; text?: string; synthetic?: boolean }>;
      }
    ): Promise<void> => {
      const sessionID = input?.sessionID;
      if (!sessionID) {
        debugLog('No sessionID in chat.message hook input');
        return;
      }

      // Only process user messages
      if (output?.message?.role !== 'user') {
        return;
      }

      // Extract text from non-synthetic parts
      const textParts: string[] = [];
      if (output.parts) {
        for (const part of output.parts) {
          // Skip synthetic parts
          if (part.synthetic) continue;

          if (part.type === 'text' && part.text) {
            textParts.push(part.text);
          } else if (typeof part.text === 'string' && !part.type) {
            textParts.push(part.text);
          }
        }
      }

      if (textParts.length > 0) {
        const userPrompt = textParts
          .map(t => t.trim())
          .filter(Boolean)
          .join(' ')
          .trim();

        if (userPrompt) {
          upsertSessionState(sessionID, state => {
            state.lastUserPrompt = userPrompt;
          });
          debugLog(
            `Updated lastUserPrompt for session ${sessionID} (len=${userPrompt.length}, parts=${textParts.length})`
          );
        }
      }
    },

    /**
     * Inject rules into the system prompt.
     * Uses context from both messages.transform hook (sessionContextMap) and tool.execute.before hook (sessionState).
     * Deletes the session context after reading to prevent memory leaks.
     */
    'experimental.chat.system.transform': async (
      hookInput: SystemTransformInput,
      output: SystemTransformOutput | null
    ): Promise<SystemTransformOutput> => {
      // Retrieve context using sessionID from input
      const sessionID = hookInput?.sessionID;
      const sessionContext = sessionID
        ? sessionContextMap.get(sessionID)
        : undefined;
      const sessionState = sessionID
        ? sessionStateMap.get(sessionID)
        : undefined;

      // Merge paths from both sources, with deduplication
      const contextPaths: string[] = Array.from(
        new Set([
          ...(sessionContext?.filePaths ?? []),
          ...(sessionState?.contextPaths
            ? Array.from(sessionState.contextPaths)
            : []),
        ])
      );

      // Get user prompt (prefer sessionState if available, fallback to sessionContext)
      const userPrompt =
        sessionState?.lastUserPrompt || sessionContext?.userPrompt;

      // Delete the session context after reading to prevent memory leaks
      if (sessionID) {
        sessionContextMap.delete(sessionID);
      }

      // Query available tool IDs for tool-based rule filtering
      let availableToolIDs: string[] = [];
      try {
        const toolIdsResponse = await client.tool.ids({
          query: { directory: pluginInput.directory },
        });
        // The response contains data field with tool IDs array
        if (toolIdsResponse.data) {
          availableToolIDs = toolIdsResponse.data;
          debugLog(
            `Available tools: ${availableToolIDs.slice(0, 10).join(', ')}${availableToolIDs.length > 10 ? '...' : ''} (${availableToolIDs.length} total)`
          );
        }
      } catch (error) {
        // If tool discovery fails, proceed with empty tools list
        // This ensures unconditional rules still work
        const message = error instanceof Error ? error.message : String(error);
        debugLog(`Warning: Failed to query tool IDs: ${message}`);
      }

      // Format rules, filtering by context paths, user prompt, and available tools
      const formattedRules = await readAndFormatRules(
        ruleFiles,
        contextPaths,
        userPrompt,
        availableToolIDs
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

/**
 * Test-only exports for accessing internal state and functions.
 * @internal - Test utilities only. Not part of public API.
 */
const __testOnly = Object.freeze({
  setSessionStateLimit: (limit: number): void => {
    sessionStateMax = limit;
  },
  getSessionStateIDs: (): string[] => {
    return Array.from(sessionStateMap.keys());
  },
  getSessionStateSnapshot: (sessionID: string): SessionState | undefined => {
    const s = sessionStateMap.get(sessionID);
    if (!s) return undefined;
    return {
      ...s,
      contextPaths: new Set(s.contextPaths),
    };
  },
  upsertSessionState,
  resetSessionState: (): void => {
    sessionStateMap.clear();
    sessionStateMax = 100;
    sessionStateTick = 0;
  },
});

export default openCodeRulesPlugin;
export { __testOnly };
