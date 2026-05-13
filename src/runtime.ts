import { minimatch } from 'minimatch';
import { readAndFormatRules, type RuleFilterContext } from './rule-filter.js';
import { type DiscoveredRule, getCachedRule } from './rule-discovery.js';
import { extractFilePathsFromMessages } from './message-paths.js';
import {
  extractLatestUserPrompt,
  extractSessionID,
  normalizeContextPath,
  sanitizePathForContext,
  toExtractableMessages,
  type MessageWithInfo,
} from './message-context.js';
import { extractConnectedMcpCapabilityIDs } from './mcp-tools.js';
import { createDebugLog, type DebugLog } from './debug.js';
import type { SessionStore } from './session-store.js';
import {
  buildFilterContext,
  type BuildFilterContextOptions,
} from './runtime-context.js';
import {
  handleChatMessage,
  type ChatMessageInput,
  type ChatMessageOutput,
} from './runtime-chat.js';
import { writeActiveRulesState } from './active-rules-state.js';

interface MessagesTransformOutput {
  messages: MessageWithInfo[];
}

interface SystemTransformInput {
  sessionID?: string;
}

interface SystemTransformOutput {
  system?: string | string[];
}

interface OpenCodeRulesRuntimeOptions {
  client: unknown;
  directory: string;
  projectDirectory: string;
  ruleFiles: DiscoveredRule[];
  sessionStore: SessionStore;
  debugLog?: DebugLog;
  now?: () => number;
}

function resolveRepeatEvery(
  config: number | Record<string, number> | undefined,
  modelID: string | undefined
): number {
  if (config === undefined) return 1;
  if (typeof config === 'number') return config;
  if (modelID && typeof config === 'object') {
    for (const [pattern, interval] of Object.entries(config)) {
      if (pattern === 'default') continue;
      if (minimatch(modelID, pattern)) return interval;
    }
  }
  return config['default'] ?? 1;
}

/**
 * Fast non-cryptographic hash for comparing rule content.
 * Used to avoid re-injecting identical rules and preserve KV-cache.
 */
function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
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
    this.debugLog = opts.debugLog ?? createDebugLog();
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

    if (!existingState || !existingState.seededFromHistory) {
      const contextPaths = extractFilePathsFromMessages(
        toExtractableMessages(output.messages)
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

    await this.maybeInjectUserRules(output, sessionID);

    return output;
  }

  private async onChatMessage(
    input: ChatMessageInput,
    output: ChatMessageOutput
  ): Promise<void> {
    handleChatMessage(input, output, this.sessionStore, this.debugLog);
  }

  private async buildCurrentFilterContext(
    sessionID: string
  ): Promise<RuleFilterContext> {
    const sessionState = sessionID ? this.sessionStore.get(sessionID) : undefined;

    const contextPaths = sessionState
      ? Array.from(sessionState.contextPaths).sort((a, b) => a.localeCompare(b))
      : [];

    const filterContextOpts: BuildFilterContextOptions = {
      contextFilePaths: contextPaths,
      userPrompt: sessionState?.lastUserPrompt,
      availableToolIDs: await this.queryAvailableToolIDs(),
      modelID: sessionState?.lastModelID,
      agentType: sessionState?.lastAgentType,
    };

    return buildFilterContext(
      filterContextOpts,
      this.projectDirectory,
      this.debugLog
    );
  }

  private async maybeInjectUserRules(
    output: MessagesTransformOutput,
    sessionID: string
  ): Promise<void> {
    const state = this.sessionStore.get(sessionID);
    if (!state) return;

    const turnCount = state.turnCount ?? 0;
    if (turnCount === 0) return;

    const filterContext = await this.buildCurrentFilterContext(sessionID);
    const minInterval = await this.computeMinUserRepeatEvery(filterContext);
    if (minInterval === undefined) return;

    const lastInject = state.lastUserInjectTurn ?? 0;
    if (turnCount - lastInject < minInterval) return;

    const { formattedRules } = await readAndFormatRules(
      this.ruleFiles,
      filterContext,
      'user',
      { raw: true }
    );

    if (!formattedRules) return;

    let lastUserIdx = -1;
    for (let i = output.messages.length - 1; i >= 0; i--) {
      if (output.messages[i]?.role === 'user') {
        lastUserIdx = i;
        break;
      }
    }

    if (lastUserIdx >= 0) {
      output.messages.splice(lastUserIdx, 0, {
        role: 'user',
        parts: [{
          type: 'text',
          text: formattedRules,
          synthetic: true,
        }],
      });

      this.sessionStore.upsert(sessionID, s => {
        s.lastUserInjectTurn = turnCount;
      });

      this.debugLog(
        `Injected user-prompt rules for session ${sessionID} at turn ${turnCount}`
      );
    }
  }

  private async computeMinUserRepeatEvery(
    filterContext: RuleFilterContext
  ): Promise<number | undefined> {
    let minInterval: number | undefined;

    for (const ruleFile of this.ruleFiles) {
      const cached = await getCachedRule(ruleFile.filePath);
      if (!cached?.metadata) continue;

      const injectMode = cached.metadata.inject ?? 'system';
      if (injectMode !== 'user' && injectMode !== 'both') continue;

      const interval = resolveRepeatEvery(
        cached.metadata.repeat_every,
        filterContext.modelID
      );
      minInterval =
        minInterval === undefined
          ? interval
          : Math.min(minInterval, interval);
    }

    return minInterval;
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

    const filterContext = await this.buildCurrentFilterContext(sessionID ?? '');
    const result = await readAndFormatRules(
          this.ruleFiles,
          filterContext,
          'system',
          { raw: true }
        );

    let { formattedRules, matchedPaths, individualContents } = result;

    if (!formattedRules) {
      this.debugLog('No applicable rules for current context');
      if (sessionID) {
        writeActiveRulesState(sessionID, []);
      }
      return output ?? {};
    }

    // Dedup: skip individual rule contents already present in the current system prompt
    const currentSystemText = output
      ? Array.isArray(output.system)
        ? output.system.join('\n')
        : (output.system ?? '')
      : '';

    const newContents: string[] = [];
    const newPaths: string[] = [];
    for (let i = 0; i < individualContents.length; i++) {
      const ruleContent = individualContents[i];
      if (currentSystemText.includes(ruleContent)) {
        this.debugLog(
          `Skipping duplicate rule content (already in system prompt): ${matchedPaths[i]}`
        );
      } else {
        newContents.push(ruleContent);
        newPaths.push(matchedPaths[i]);
      }
    }

    if (newContents.length === 0) {
      this.debugLog('All rules already present in system prompt - skipping injection');
      if (sessionID) {
        writeActiveRulesState(sessionID, []);
      }
      return output ?? {};
    }

    // Rebuild formattedRules from non-duplicate contents
    formattedRules = newContents.join('\n\n');
    matchedPaths = newPaths;

    if (sessionID) {
      writeActiveRulesState(sessionID, matchedPaths);
    }

    const rulesHash = hashString(formattedRules);

    if (sessionState?.lastInjectedRulesHash === rulesHash) {
      this.debugLog(
        `Session ${sessionID} rules unchanged - skipping injection to preserve KV-cache`
      );
      return output ?? {};
    }

    this.debugLog('Injecting rules into system prompt');

    if (!output) {
      if (sessionID) {
        this.sessionStore.upsert(sessionID, state => {
          state.rulesInjected = true;
          state.lastInjectedAt = this.now();
          state.lastInjectedRulesHash = rulesHash;
        });
      }
      return { system: formattedRules };
    }

    if (Array.isArray(output.system)) {
      output.system.push(formattedRules);
    } else {
      output.system = output.system
        ? `${output.system}\n\n${formattedRules}`
        : formattedRules;
    }

    if (sessionID) {
      this.sessionStore.upsert(sessionID, state => {
        state.rulesInjected = true;
        state.lastInjectedAt = this.now();
        state.lastInjectedRulesHash = rulesHash;
      });
    }

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
      console.warn(
        `[opencode-rules] Warning: Failed to query tool IDs: ${message}`
      );
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
      console.warn(
        `[opencode-rules] Warning: Failed to query MCP status: ${message}`
      );
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
    this.sessionStore.upsert(sessionID, s => {
      delete s.lastInjectedRulesHash;
    });

    const sortedPaths = Array.from(sessionState.contextPaths).sort((a, b) =>
      a.localeCompare(b)
    );
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
