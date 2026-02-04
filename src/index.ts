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
 * Per-session storage for context between hook calls (legacy fallback).
 * Uses a Map keyed by sessionID to share context between messages.transform and system.transform.
 * The messages.transform hook populates this, system.transform reads it and deletes the entry.
 * Note: sessionState is now the primary source; sessionContextMap is a legacy fallback.
 * Entries are deleted after use to prevent memory leaks.
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
  seededFromHistory: boolean;
  seedCount?: number;
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
 * Sanitize a file path for safe inclusion in context strings.
 * Prevents prompt injection by removing control characters and limiting length.
 */
function sanitizePathForContext(p: string): string {
  // Remove newlines, carriage returns, tabs - prevent injection attacks
  return p.replace(/[\r\n\t]/g, ' ').slice(0, 300);
}

/**
 * Create a default SessionState object.
 */
function createDefaultSessionState(): SessionState {
  return {
    contextPaths: new Set<string>(),
    lastUpdated: ++sessionStateTick,
    seededFromHistory: false,
    seedCount: 0,
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
     * Seeds session state once on first call, then skips rescanning on subsequent calls.
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

      // Check if this session is already seeded
      const existingState = sessionStateMap.get(sessionID);
      if (existingState && existingState.seededFromHistory) {
        debugLog(`Session ${sessionID} already seeded, skipping rescan`);
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

      // Seed session state once
      upsertSessionState(sessionID, state => {
        // Add extracted paths to contextPaths
        for (const path of contextPaths) {
          state.contextPaths.add(path);
        }
        // Update lastUserPrompt only if we don't already have one
        if (userPrompt && !state.lastUserPrompt) {
          state.lastUserPrompt = userPrompt;
        }
        // Mark as seeded
        state.seededFromHistory = true;
        // Increment seed count
        state.seedCount = (state.seedCount ?? 0) + 1;
      });

      // Store in sessionContextMap for legacy fallback
      sessionContextMap.set(sessionID, {
        filePaths: contextPaths,
        userPrompt,
      });

      if (contextPaths.length > 0) {
        debugLog(
          `Seeded ${contextPaths.length} context path(s) for session ${sessionID}: ${contextPaths.slice(0, 5).join(', ')}${contextPaths.length > 5 ? '...' : ''}`
        );
      }

      if (userPrompt) {
        debugLog(
          `Seeded user prompt for session ${sessionID} (len=${userPrompt.length})`
        );
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
     * Uses context from sessionState (primary, persists across turns) and sessionContextMap (legacy fallback, deleted after use).
     * sessionState is populated by tool.execute.before and chat.message hooks and persists across turns.
     * sessionContextMap is populated by messages.transform hook and deleted after reading to prevent memory leaks.
     */
    'experimental.chat.system.transform': async (
      hookInput: SystemTransformInput,
      output: SystemTransformOutput | null
    ): Promise<SystemTransformOutput> => {
      // Retrieve context using sessionID from input
      const sessionID = hookInput?.sessionID;
      const sessionState = sessionID
        ? sessionStateMap.get(sessionID)
        : undefined;
      const sessionContext = sessionID
        ? sessionContextMap.get(sessionID)
        : undefined;

      // Prefer sessionState as primary source, merge with sessionContextMap for compatibility
      const contextPaths = Array.from(
        new Set([
          ...(sessionState ? Array.from(sessionState.contextPaths) : []),
          ...(sessionContext?.filePaths ?? []),
        ])
      ).sort();

      // Get user prompt (prefer sessionState if available, fallback to sessionContext)
      const userPrompt =
        sessionState?.lastUserPrompt || sessionContext?.userPrompt;

      // Delete the session context after reading to prevent memory leaks
      // Note: sessionState is NOT deleted to allow it to persist across turns
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

    /**
     * Persist working-set context into session compaction.
     * When a session is compacted (summarized), inject the current context paths
     * so the compaction LLM includes them in the summary.
     * This prevents rules from being lost during compaction.
     */
    'experimental.session.compacting': async (
      input: { sessionID?: string },
      output: { context?: string[] }
    ): Promise<void> => {
      const sessionID = input?.sessionID;
      if (!sessionID) {
        debugLog('No sessionID in compacting hook input');
        return;
      }

      const sessionState = sessionStateMap.get(sessionID);
      if (!sessionState || sessionState.contextPaths.size === 0) {
        debugLog(`No context paths for session ${sessionID} during compaction`);
        return;
      }

      // Set compaction flags for Task 7
      upsertSessionState(sessionID, state => {
        state.isCompacting = true;
        state.compactingSince = Date.now();
      });

      // Sort paths for determinism and take up to N paths
      const sortedPaths = Array.from(sessionState.contextPaths).sort();
      const maxPaths = 20;
      const pathsToInclude = sortedPaths.slice(0, maxPaths);

      // Build a minimal context string
      const contextString = [
        'OpenCode Rules: Working context',
        'Current file paths in context:',
        ...pathsToInclude.map(p => `  - ${sanitizePathForContext(p)}`),
        ...(sortedPaths.length > maxPaths
          ? [`  ... and ${sortedPaths.length - maxPaths} more paths`]
          : []),
      ].join('\n');

      // Add to output context array
      if (!output.context) {
        output.context = [];
      }
      output.context.push(contextString);

      debugLog(
        `Added ${pathsToInclude.length} context path(s) to compaction for session ${sessionID}`
      );
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
  getSeedCount: (sessionID: string): number => {
    return sessionStateMap.get(sessionID)?.seedCount ?? 0;
  },
});

export default openCodeRulesPlugin;
export { __testOnly };
