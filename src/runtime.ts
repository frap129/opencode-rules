import {
  matchRuleSnapshots,
  type RuleMatchContext,
  type MatchedRuleEntry,
} from './rule-filter.js';
import {
  extractFilePathsFromMessages,
  extractToolCallPaths,
} from './message-paths.js';
import {
  loadRuleSnapshots,
  type DiscoveredRule,
  type RuleSnapshot,
} from './rule-discovery.js';
import {
  extractLatestUserPrompt,
  extractSessionID,
  normalizeContextPath,
  sanitizePathForContext,
  filterValidMessages,
  type MessageWithInfo,
} from './message-context.js';
import { extractConnectedMcpCapabilityIDs } from './mcp-tools.js';
import {
  createDebugLog,
  logWarning,
  formatError,
  type DebugLog,
} from './debug.js';
import type { SessionStore } from './session-store.js';
import { buildRuleMatchContext } from './runtime-context.js';
import {
  updateSessionFromChatMessage,
  type ChatMessageInput,
  type ChatMessageOutput,
} from './runtime-chat.js';
import { writeActiveRulesState } from './active-rules-state.js';
import { evaluateHooks, serializeToolArgs } from './rule-hooks.js';
import {
  createRuleDelivery,
  type MatchedHookContent,
  type MatchedRuleContent,
  type RuleDelivery,
} from './rule-delivery.js';
import type {
  RawHistoryAdapter,
  RawHistoryResult,
} from './rule-delivery-history.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Prefetched history entries are consumed by the first durable turn; a
// transform-first seed can leave them unconsumed. A small bound keeps the
// worst case (full histories per session) negligible.
const MAX_PENDING_HISTORY_PREFETCH = 8;

interface MessagesTransformOutput {
  messages: MessageWithInfo[];
}

interface OpenCodeClient {
  tool?: {
    ids?: (args: {
      query: { directory: string };
    }) => Promise<{ data: string[] }>;
  };
  mcp?: {
    status?: (args: {
      query: { directory: string };
    }) => Promise<{ connected?: Array<{ id: string }> }>;
  };
  session?: {
    messages?: (args: {
      path: { id: string };
      query?: { directory?: string };
    }) => Promise<{ data?: Array<{ info?: unknown; parts?: unknown[] }> }>;
  };
}

interface OpenCodeRulesRuntimeOptions {
  client: unknown;
  directory: string;
  projectDirectory: string;
  ruleFiles: DiscoveredRule[];
  sessionStore: SessionStore;
  debugLog?: DebugLog;
}

export class OpenCodeRulesRuntime {
  private client: OpenCodeClient;
  private directory: string;
  private projectDirectory: string;
  private ruleFiles: DiscoveredRule[];
  private sessionStore: SessionStore;
  private debugLog: DebugLog;
  private ruleDelivery: RuleDelivery;
  private pendingHistoryPrefetch = new Map<string, RawHistoryResult>();
  private snapshotPromises = new Map<string, Promise<RuleSnapshot[]>>();

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.client = opts.client as OpenCodeClient;
    this.directory = opts.directory;
    this.projectDirectory = opts.projectDirectory;
    this.ruleFiles = opts.ruleFiles;
    this.sessionStore = opts.sessionStore;
    this.debugLog = opts.debugLog ?? createDebugLog();
    this.ruleDelivery = createRuleDelivery({
      rawHistory: this.createRawHistoryAdapter(),
      debugLog: this.debugLog,
    });
  }

  private createRawHistoryAdapter(): RawHistoryAdapter {
    return {
      readHistory: async sessionID => {
        const cached = this.pendingHistoryPrefetch.get(sessionID);
        if (cached) {
          this.pendingHistoryPrefetch.delete(sessionID);
          return cached;
        }
        return this.readClientHistory(sessionID);
      },
    };
  }

  private async readClientHistory(
    sessionID: string
  ): Promise<RawHistoryResult> {
    const session = this.client.session;
    if (!session?.messages) return { ok: true, messages: [] };
    try {
      const result = await session.messages({
        path: { id: sessionID },
        query: { directory: this.directory },
      });
      return { ok: true, messages: result?.data ?? [] };
    } catch (error) {
      logWarning('Failed to fetch session history', error);
      return { ok: false };
    }
  }

  private async seedContextFromHistory(sessionID: string): Promise<void> {
    if (this.sessionStore.get(sessionID)?.seededFromHistory) return;
    const history = await this.readClientHistory(sessionID);
    this.pendingHistoryPrefetch.delete(sessionID);
    this.pendingHistoryPrefetch.set(sessionID, history);
    while (this.pendingHistoryPrefetch.size > MAX_PENDING_HISTORY_PREFETCH) {
      const oldest = this.pendingHistoryPrefetch.keys().next().value;
      if (oldest === undefined) break;
      this.pendingHistoryPrefetch.delete(oldest);
    }
    if (!history.ok) return;
    const messages = history.messages.filter(
      (message): message is MessageWithInfo =>
        typeof message === 'object' && message !== null
    );
    const contextPaths = extractFilePathsFromMessages(
      filterValidMessages(messages)
    );
    this.sessionStore.upsert(sessionID, state => {
      for (const contextPath of contextPaths) {
        state.contextPaths.add(
          normalizeContextPath(contextPath, this.projectDirectory)
        );
      }
      state.seededFromHistory = true;
    });
  }

  createHooks(): Record<string, unknown> {
    return {
      'tool.execute.before': this.onToolExecuteBefore.bind(this),
      'tool.execute.after': this.onToolExecuteAfter.bind(this),
      'experimental.chat.messages.transform':
        this.onMessagesTransform.bind(this),
      'chat.message': this.onChatMessage.bind(this),
      'experimental.session.compacting': this.onSessionCompacting.bind(this),
      event: this.onEvent.bind(this),
    };
  }

  private async onEvent(input: {
    event?: { type?: unknown; properties?: unknown };
  }): Promise<void> {
    if (input.event?.type !== 'message.removed') return;
    const properties = input.event.properties;
    if (
      properties === null ||
      typeof properties !== 'object' ||
      Array.isArray(properties) ||
      !('sessionID' in properties) ||
      typeof properties.sessionID !== 'string'
    ) {
      return;
    }

    this.ruleDelivery.markHistoryChanged(properties.sessionID);
    this.pendingHistoryPrefetch.delete(properties.sessionID);
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

    const contextPaths = extractToolCallPaths(toolName, args);

    for (const filePath of contextPaths) {
      const normalized = normalizeContextPath(filePath, this.projectDirectory);
      this.sessionStore.upsert(sessionID, state => {
        state.contextPaths.add(normalized);
      });

      this.debugLog(
        `Recorded context path from tool ${toolName}: ${normalized}`
      );
    }

    await this.evaluateAndQueueHooks('PreToolUse', sessionID, toolName, args);
  }

  private async onToolExecuteAfter(
    input: {
      tool?: string;
      sessionID?: string;
      callID?: string;
      args?: Record<string, unknown>;
    },
    _output: { title?: string; output?: string; metadata?: unknown }
  ): Promise<void> {
    const sessionID = input?.sessionID;
    const toolName = input?.tool;
    const args = input?.args;

    if (!sessionID || !toolName || !args) {
      return;
    }

    await this.evaluateAndQueueHooks('PostToolUse', sessionID, toolName, args);
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
    if (!existingState?.seededFromHistory) {
      const contextPaths = extractFilePathsFromMessages(
        filterValidMessages(output.messages)
      );
      const userPrompt = extractLatestUserPrompt(output.messages);

      this.sessionStore.upsert(sessionID, state => {
        for (const p of contextPaths) {
          state.contextPaths.add(
            normalizeContextPath(p, this.projectDirectory)
          );
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
    }

    let ephemeralRules: MatchedRuleContent[] = [];
    try {
      const currentState = this.sessionStore.get(sessionID);
      if (currentState) {
        const prompt = extractLatestUserPrompt(output.messages);
        const matches = await this.evaluateSessionRules(
          sessionID,
          prompt,
          currentState.lastModelID,
          currentState.lastAgentType
        );
        ephemeralRules = this.toDeliveryRules(
          matches.filter(rule => rule.lifetime === 'ephemeral')
        );
      }
    } catch (error) {
      this.debugLog(
        `Ephemeral rule evaluation failed for ${sessionID}: ${formatError(error)}`
      );
    }
    // Delivery runs even when evaluation failed: ledger seeding, queue
    // routing, and queued transient Hook content must not slip a dispatch.
    this.ruleDelivery.deliverTransientDispatch({
      sessionID,
      matchedRules: ephemeralRules,
      messages: output.messages,
    });

    return output;
  }

  /** Load the per-session rule snapshot exactly once per process/session,
   * deduplicating concurrent loads via a promise map. */
  private async ensureSessionRuleSnapshot(
    sessionID: string
  ): Promise<RuleSnapshot[]> {
    const existing = this.sessionStore.get(sessionID)?.ruleSnapshots;
    if (existing) return existing;

    let pending = this.snapshotPromises.get(sessionID);
    if (!pending) {
      pending = loadRuleSnapshots(this.ruleFiles);
      this.snapshotPromises.set(sessionID, pending);
    }

    try {
      const loaded = await pending;
      this.sessionStore.upsert(sessionID, state => {
        if (!state.ruleSnapshots) state.ruleSnapshots = loaded;
      });
      return this.sessionStore.get(sessionID)?.ruleSnapshots ?? loaded;
    } finally {
      if (this.snapshotPromises.get(sessionID) === pending) {
        this.snapshotPromises.delete(sessionID);
      }
    }
  }

  /** Assemble the shared match context from session state and live queries. */
  private async buildSessionRuleMatchContext(
    sessionID: string,
    userPrompt: string | undefined,
    modelID: string | undefined,
    agentType: string | undefined
  ): Promise<RuleMatchContext> {
    const state = this.sessionStore.get(sessionID);
    const contextFilePaths = Array.from(state?.contextPaths ?? []).sort(
      (a, b) => a.localeCompare(b)
    );
    const availableToolIDs = await this.queryAvailableToolIDs();
    return buildRuleMatchContext({
      contextFilePaths,
      userPrompt,
      availableToolIDs,
      modelID,
      agentType,
      projectDirectory: this.projectDirectory,
      debugLog: this.debugLog,
    });
  }

  /** Evaluate the session snapshot against the current request context. */
  private async evaluateSessionRules(
    sessionID: string,
    userPrompt: string | undefined,
    modelID: string | undefined,
    agentType: string | undefined
  ): Promise<MatchedRuleEntry[]> {
    const snapshots = await this.ensureSessionRuleSnapshot(sessionID);
    const context = await this.buildSessionRuleMatchContext(
      sessionID,
      userPrompt,
      modelID,
      agentType
    );
    return matchRuleSnapshots(snapshots, context);
  }

  private toDeliveryRules(
    matches: readonly MatchedRuleEntry[]
  ): MatchedRuleContent[] {
    return matches.map(rule => ({
      identity: rule.filePath,
      relativePath: rule.relativePath,
      name: rule.name,
      content: rule.strippedContent,
    }));
  }

  private async onChatMessage(
    input: ChatMessageInput,
    output: ChatMessageOutput
  ): Promise<void> {
    try {
      const captured = updateSessionFromChatMessage(
        input,
        output,
        this.sessionStore,
        this.debugLog
      );
      const sessionID = input?.sessionID;
      if (!captured || !sessionID) {
        return;
      }

      // 1. Merge file paths mentioned in this message into session context
      if (output.parts && output.parts.length > 0) {
        const paths = extractFilePathsFromMessages([
          { role: 'user', parts: output.parts as never[] },
        ]);
        if (paths.length > 0) {
          this.sessionStore.upsert(sessionID, state => {
            for (const p of paths) {
              state.contextPaths.add(
                normalizeContextPath(p, this.projectDirectory)
              );
            }
          });
        }
      }

      await this.seedContextFromHistory(sessionID);

      let matched: MatchedRuleEntry[] = [];
      if (captured.userPrompt) {
        matched = await this.evaluateSessionRules(
          sessionID,
          captured.userPrompt,
          captured.modelID,
          captured.agentType
        );
      }
      const durableMatches = matched.filter(
        rule => rule.lifetime === 'durable'
      );

      const messageID = input.messageID ?? output.message?.id;
      const result = await this.ruleDelivery.deliverDurableTurn({
        sessionID,
        ...(messageID ? { messageID } : {}),
        matchedRules: this.toDeliveryRules(durableMatches),
        output,
      });

      if (result === 'accepted' && captured.userPrompt) {
        await writeActiveRulesState(
          sessionID,
          matched.map(r => r.filePath)
        );
      }
    } catch (error) {
      this.debugLog(`chat.message handler failed: ${formatError(error)}`);
    }
  }

  private async queryAvailableToolIDs(): Promise<string[]> {
    const ids = new Set<string>();
    const query = { directory: this.directory };

    const toolPromise = this.client.tool?.ids?.({ query });
    const mcpPromise = this.client.mcp?.status?.({ query });

    const [toolResult, mcpResult] = await Promise.allSettled([
      toolPromise,
      mcpPromise,
    ] as const);

    const logSettledError = (
      label: string,
      result: PromiseRejectedResult
    ): void => {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      logWarning(`Failed to query ${label}`, message);
    };

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
      logSettledError('tool IDs', toolResult);
    }

    if (
      mcpResult.status === 'fulfilled' &&
      mcpResult.value &&
      'data' in mcpResult.value
    ) {
      const mcpIds = extractConnectedMcpCapabilityIDs(
        mcpResult.value.data as Record<string, { status?: string }>
      );
      for (const id of mcpIds) {
        ids.add(id);
      }
      if (mcpIds.length > 0) {
        this.debugLog(`MCP capability IDs: ${mcpIds.join(', ')}`);
      }
    } else if (mcpResult.status === 'rejected') {
      logSettledError('MCP status', mcpResult);
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

    this.ruleDelivery.markCompacted(sessionID);
    this.pendingHistoryPrefetch.delete(sessionID);

    const sessionState = this.sessionStore.get(sessionID);
    if (!sessionState || sessionState.contextPaths.size === 0) {
      this.debugLog(
        `No context paths for session ${sessionID} during compaction`
      );
      return;
    }

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

  private async executeHookSideEffect(
    command: string,
    sessionID: string
  ): Promise<void> {
    try {
      this.debugLog(
        `Executing hook side-effect for session ${sessionID}: ${command}`
      );
      await execAsync(command, { cwd: this.projectDirectory });
      this.debugLog(
        `Hook side-effect completed for session ${sessionID}: ${command}`
      );
    } catch (error) {
      logWarning('Hook side-effect failed', error);
    }
  }

  /** Evaluate hooks for a tool invocation and queue matches.
   * @throws {Error} When a PreToolUse hook with block:true matches the tool and arguments. */
  private async evaluateAndQueueHooks(
    hookType: 'PreToolUse' | 'PostToolUse',
    sessionID: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<void> {
    const serializedArgs = serializeToolArgs(args);

    const snapshots = await this.ensureSessionRuleSnapshot(sessionID);

    // First pass: collect all matched hooks across all rules
    const allMatches: Array<{
      hook: { type: string; run?: string };
      rule: RuleSnapshot;
    }> = [];

    for (const rule of snapshots) {
      if (!rule.metadata?.hooks) continue;

      const typeFiltered = rule.metadata.hooks.filter(h => h.type === hookType);
      if (typeFiltered.length === 0) continue;

      const matched = evaluateHooks(typeFiltered, {
        toolName,
        serializedArgs,
        hookType,
      });

      for (const hook of matched) {
        allMatches.push({ hook, rule });
      }
    }

    if (allMatches.length === 0) return;

    // Build the shared classification context only when hooks actually
    // matched: the context query (tool RPCs, project tags, git branch) is
    // the expensive part of the tool-event path.
    const state = this.sessionStore.get(sessionID);
    const matchContext = await this.buildSessionRuleMatchContext(
      sessionID,
      state?.lastUserPrompt,
      state?.lastModelID,
      state?.lastAgentType
    );

    // Check for blockers globally before any queuing or side-effects
    if (hookType === 'PreToolUse') {
      const blocker = allMatches.find(
        m =>
          m.hook.type === 'PreToolUse' && (m.hook as { block?: boolean }).block
      );
      if (blocker) {
        this.debugLog(
          `PreToolUse block fired for rule ${blocker.rule.relativePath}, tool ${toolName}`
        );
        throw new Error(
          `[opencode-rules] Blocked by rule "${blocker.rule.relativePath}": ` +
            `tool "${toolName}" matched blocked pattern`
        );
      }
    }

    // No blockers: queue content and run side-effects
    // Queue each matched rule once, regardless of how many hooks matched.
    const seenRules = new Set<string>();
    const matchedHooks: MatchedHookContent[] = [];
    for (const { hook, rule } of allMatches) {
      if (!seenRules.has(rule.filePath)) {
        seenRules.add(rule.filePath);
        const lifetime =
          matchRuleSnapshots([rule], matchContext)[0]?.lifetime ?? 'ephemeral';
        matchedHooks.push({
          identity: rule.filePath,
          relativePath: rule.relativePath,
          name: rule.name,
          content: rule.strippedContent,
          lifetime,
        });

        this.debugLog(
          `${hookType} hook fired for rule ${rule.relativePath}, tool ${toolName} (${lifetime})`
        );
      }

      if (hook.run) {
        await this.executeHookSideEffect(hook.run, sessionID);
      }
    }
    if (matchedHooks.length > 0) {
      this.ruleDelivery.queueMatchedHooks({
        sessionID,
        hooks: matchedHooks,
      });
    }
  }
}
