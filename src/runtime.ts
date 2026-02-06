import {
  readAndFormatRules,
  extractFilePathsFromMessages,
  type DiscoveredRule,
} from './utils.js';
import {
  extractLatestUserPrompt,
  extractSessionID,
  normalizeContextPath,
  sanitizePathForContext,
  type MessageWithInfo,
} from './message-context.js';
import { extractConnectedMcpCapabilityIDs } from './mcp-tools.js';
import type { SessionStore } from './session-store.js';

type DebugLog = (message: string) => void;

function defaultDebugLog(message: string): void {
  if (process.env.OPENCODE_RULES_DEBUG) {
    console.debug(`[opencode-rules] ${message}`);
  }
}

interface MessagesTransformOutput {
  messages: MessageWithInfo[];
}

interface SystemTransformInput {
  sessionID?: string;
}

interface SystemTransformOutput {
  system?: string | string[];
}

export interface OpenCodeRulesRuntimeOptions {
  client: unknown;
  directory: string;
  projectDirectory: string;
  ruleFiles: DiscoveredRule[];
  sessionStore: SessionStore;
  debugLog?: DebugLog;
  now?: () => number;
}

export class OpenCodeRulesRuntime {
  private client: unknown;
  private directory: string;
  private projectDirectory: string;
  private ruleFiles: DiscoveredRule[];
  private sessionStore: SessionStore;
  private debugLog: DebugLog;
  private now: () => number;

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.client = opts.client;
    this.directory = opts.directory;
    this.projectDirectory = opts.projectDirectory;
    this.ruleFiles = opts.ruleFiles;
    this.sessionStore = opts.sessionStore;
    this.debugLog = opts.debugLog ?? defaultDebugLog;
    this.now = opts.now ?? (() => Date.now());
  }

  createHooks(): Record<string, unknown> {
    return {
      'tool.execute.before': this.onToolExecuteBefore.bind(this),
      'experimental.chat.messages.transform':
        this.onMessagesTransform.bind(this),
      'chat.message': this.onChatMessage.bind(this),
      'experimental.chat.system.transform': this.onSystemTransform.bind(this),
      'experimental.session.compacting': this.onSessionCompacting.bind(this),
    };
  }

  private async onToolExecuteBefore(
    input: { tool?: string; sessionID?: string; callID?: string },
    output: { args?: Record<string, unknown> }
  ): Promise<void> {
    const sessionID = input?.sessionID;
    const toolName = input?.tool;
    const args = output?.args;

    if (!sessionID || !toolName || !args) {
      return;
    }

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
    } else if (toolName === 'bash') {
      const arg = args.workdir;
      if (typeof arg === 'string' && arg.length > 0) {
        filePath = arg;
      }
    }

    if (filePath) {
      const normalized = normalizeContextPath(filePath, this.projectDirectory);
      this.sessionStore.upsert(sessionID, state => {
        state.contextPaths.add(normalized);
      });

      this.debugLog(
        `Recorded context path from tool ${toolName}: ${normalized}`
      );
    }
  }

  private async onMessagesTransform(
    _input: Record<string, never>,
    output: MessagesTransformOutput
  ): Promise<MessagesTransformOutput> {
    const sessionID = extractSessionID(output.messages);
    if (!sessionID) {
      this.debugLog('No sessionID found in messages');
      return output;
    }

    const existingState = this.sessionStore.get(sessionID);
    if (existingState && existingState.seededFromHistory) {
      this.debugLog(`Session ${sessionID} already seeded, skipping rescan`);
      return output;
    }

    const contextPaths = extractFilePathsFromMessages(
      output.messages as unknown as Parameters<
        typeof extractFilePathsFromMessages
      >[0]
    );
    const userPrompt = extractLatestUserPrompt(output.messages);

    this.sessionStore.upsert(sessionID, state => {
      for (const p of contextPaths) {
        state.contextPaths.add(normalizeContextPath(p, this.projectDirectory));
      }
      if (userPrompt && !state.lastUserPrompt) {
        state.lastUserPrompt = userPrompt;
      }
      state.seededFromHistory = true;
      state.seedCount = (state.seedCount ?? 0) + 1;
    });

    if (contextPaths.length > 0) {
      this.debugLog(
        `Seeded ${contextPaths.length} context path(s) for session ${sessionID}: ${contextPaths
          .slice(0, 5)
          .join(', ')}${contextPaths.length > 5 ? '...' : ''}`
      );
    }

    if (userPrompt) {
      this.debugLog(
        `Seeded user prompt for session ${sessionID} (len=${userPrompt.length})`
      );
    }

    return output;
  }

  private async onChatMessage(
    input: { sessionID?: string },
    output: {
      message?: { role?: string };
      parts?: Array<{ type?: string; text?: string; synthetic?: boolean }>;
    }
  ): Promise<void> {
    const sessionID = input?.sessionID;
    if (!sessionID) {
      this.debugLog('No sessionID in chat.message hook input');
      return;
    }

    if (output?.message?.role !== 'user') {
      return;
    }

    const textParts: string[] = [];
    if (output.parts) {
      for (const part of output.parts) {
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
        this.sessionStore.upsert(sessionID, state => {
          state.lastUserPrompt = userPrompt;
        });

        this.debugLog(
          `Updated lastUserPrompt for session ${sessionID} (len=${userPrompt.length}, parts=${textParts.length})`
        );
      }
    }
  }

  private async onSystemTransform(
    hookInput: SystemTransformInput,
    output: SystemTransformOutput | null
  ): Promise<SystemTransformOutput> {
    const sessionID = hookInput?.sessionID;
    const sessionState = sessionID
      ? this.sessionStore.get(sessionID)
      : undefined;

    if (sessionID) {
      const skip = this.sessionStore.shouldSkipInjection(
        sessionID,
        this.now(),
        30_000
      );
      if (skip) {
        this.debugLog(
          `Session ${sessionID} is compacting - skipping rule injection`
        );
        return output ?? {};
      }
    }

    const contextPaths = sessionState
      ? Array.from(sessionState.contextPaths).sort()
      : [];
    const userPrompt = sessionState?.lastUserPrompt;

    const availableToolIDs = await this.queryAvailableToolIDs();

    const formattedRules = await readAndFormatRules(
      this.ruleFiles,
      contextPaths,
      userPrompt,
      availableToolIDs
    );

    if (!formattedRules) {
      this.debugLog('No applicable rules for current context');
      return output ?? {};
    }

    this.debugLog('Injecting rules into system prompt');

    if (!output) {
      return { system: formattedRules };
    }

    if (Array.isArray(output.system)) {
      output.system.push(formattedRules);
      return output;
    }

    output.system = output.system
      ? `${output.system}\n\n${formattedRules}`
      : formattedRules;

    return output;
  }

  private async queryAvailableToolIDs(): Promise<string[]> {
    const ids = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.client as any;
    const query = { directory: this.directory };

    const [toolResult, mcpResult] = await Promise.allSettled([
      client.tool?.ids?.({ query }),
      client.mcp?.status?.({ query }),
    ]);

    if (
      toolResult.status === 'fulfilled' &&
      Array.isArray(toolResult.value?.data)
    ) {
      for (const id of toolResult.value.data) {
        ids.add(id);
      }
      this.debugLog(
        `Built-in tools: ${toolResult.value.data.slice(0, 10).join(', ')}${toolResult.value.data.length > 10 ? '...' : ''} (${toolResult.value.data.length} total)`
      );
    } else if (toolResult.status === 'rejected') {
      const message =
        toolResult.reason instanceof Error
          ? toolResult.reason.message
          : String(toolResult.reason);
      this.debugLog(`Warning: Failed to query tool IDs: ${message}`);
    }

    if (mcpResult.status === 'fulfilled' && mcpResult.value?.data) {
      const mcpIds = extractConnectedMcpCapabilityIDs(mcpResult.value.data);
      for (const id of mcpIds) {
        ids.add(id);
      }
      if (mcpIds.length > 0) {
        this.debugLog(`MCP capability IDs: ${mcpIds.join(', ')}`);
      }
    } else if (mcpResult.status === 'rejected') {
      const message =
        mcpResult.reason instanceof Error
          ? mcpResult.reason.message
          : String(mcpResult.reason);
      this.debugLog(`Warning: Failed to query MCP status: ${message}`);
    }

    return Array.from(ids);
  }

  private async onSessionCompacting(
    input: { sessionID?: string },
    output: { context?: string[] }
  ): Promise<void> {
    const sessionID = input?.sessionID;
    if (!sessionID) {
      this.debugLog('No sessionID in compacting hook input');
      return;
    }

    const sessionState = this.sessionStore.get(sessionID);
    if (!sessionState || sessionState.contextPaths.size === 0) {
      this.debugLog(
        `No context paths for session ${sessionID} during compaction`
      );
      return;
    }

    this.sessionStore.markCompacting(sessionID, this.now());

    const sortedPaths = Array.from(sessionState.contextPaths).sort();
    const maxPaths = 20;
    const pathsToInclude = sortedPaths.slice(0, maxPaths);

    const contextString = [
      'OpenCode Rules: Working context',
      'Current file paths in context:',
      ...pathsToInclude.map(p => `  - ${sanitizePathForContext(p)}`),
      ...(sortedPaths.length > maxPaths
        ? [`  ... and ${sortedPaths.length - maxPaths} more paths`]
        : []),
    ].join('\n');

    if (!output.context) {
      output.context = [];
    }

    output.context.push(contextString);

    this.debugLog(
      `Added ${pathsToInclude.length} context path(s) to compaction for session ${sessionID}`
    );
  }
}
