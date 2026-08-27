import {
  matchRuleSnapshots,
  type RuleFilterContext,
  type MatchedRuleEntry,
  type RuleLifetime,
} from './rule-filter.js';
import { extractFilePathsFromMessages } from './message-paths.js';
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
import { buildFilterContext } from './runtime-context.js';
import {
  updateSessionFromChatMessage,
  type ChatMessageInput,
  type ChatMessageOutput,
} from './runtime-chat.js';
import { writeActiveRulesState } from './active-rules-state.js';
import { evaluateHooks, serializeToolArgs } from './rule-hooks.js';
import {
  buildRulePart,
  buildHookInjectionPart,
  buildTransientHookMessage,
  buildTransientRuleMessage,
  hashContent,
  isTransientMessageId,
  ruleKeyFor,
  scanInjectedParts,
  type InjectedPartsScan,
  type SyntheticPart,
} from './synthetic-injection.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface MessagesTransformOutput {
  messages: MessageWithInfo[];
}

interface HistoryScanResult extends InjectedPartsScan {
  contextPaths: string[];
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
  private snapshotPromises = new Map<string, Promise<RuleSnapshot[]>>();

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.client = opts.client as OpenCodeClient;
    this.directory = opts.directory;
    this.projectDirectory = opts.projectDirectory;
    this.ruleFiles = opts.ruleFiles;
    this.sessionStore = opts.sessionStore;
    this.debugLog = opts.debugLog ?? createDebugLog();
  }

  createHooks(): Record<string, unknown> {
    return {
      'tool.execute.before': this.onToolExecuteBefore.bind(this),
      'tool.execute.after': this.onToolExecuteAfter.bind(this),
      'experimental.chat.messages.transform':
        this.onMessagesTransform.bind(this),
      'chat.message': this.onChatMessage.bind(this),
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

      await this.rescanInjectedParts(sessionID, output.messages);
    } else if (existingState.needsRuleRescan) {
      this.debugLog(`Session ${sessionID} needs rule rescan - rescanning now`);
      await this.rescanInjectedParts(sessionID, output.messages);
    }

    try {
      const currentState = this.sessionStore.get(sessionID);
      if (currentState && !currentState.needsRuleRescan) {
        const prompt = extractLatestUserPrompt(output.messages);
        const matches = await this.evaluateSessionRules(
          sessionID,
          prompt,
          currentState.lastModelID,
          currentState.lastAgentType
        );
        this.appendTransientRuleInjections(sessionID, output.messages, matches);
      }
    } catch (error) {
      this.debugLog(
        `Ephemeral rule evaluation failed for ${sessionID}: ${formatError(error)}`
      );
    }

    this.appendTransientHookInjections(sessionID, output.messages);
    this.appendTransientEphemeralHookInjections(sessionID, output.messages);

    return output;
  }

  /** Resolve the info transient synthetic messages should inherit: the latest
   * real user message (authoritative model object and agent), skipping
   * transient messages appended earlier in the same dispatch. Falls back to
   * the last message's info (the builders synthesize a model object from
   * flat fields when needed). */
  private transientBaseInfo(
    messages: MessageWithInfo[]
  ): Record<string, unknown> {
    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i]?.info;
      if (!info || info.role !== 'user') continue;
      if (isTransientMessageId(info.id)) continue;
      return info as Record<string, unknown>;
    }
    const last = messages[messages.length - 1]?.info;
    return (last ?? {}) as Record<string, unknown>;
  }

  /** Append request-scoped synthetic user messages carrying pending hook
   * texts. Never persisted: opencode discards messages.transform mutations
   * after the model dispatch. Idempotent by deterministic id/content. */
  private appendTransientHookInjections(
    sessionID: string,
    messages: MessageWithInfo[]
  ): void {
    try {
      const state = this.sessionStore.get(sessionID);
      const pending = state?.pendingHookInjections;
      if (!pending || pending.length === 0 || messages.length === 0) {
        return;
      }

      // Presence check: skip contents already carried by this request.
      const presentIds = new Set<string>();
      for (const message of messages) {
        if (typeof message.info?.id === 'string') {
          presentIds.add(message.info.id);
        }
        for (const part of message.parts ?? []) {
          if (typeof part.id === 'string') {
            presentIds.add(part.id);
          }
        }
      }

      const lastMessage = messages[messages.length - 1];
      if (!lastMessage?.parts) {
        return;
      }

      for (const content of new Set(pending)) {
        const hash = hashContent(content);
        const transientMessageId = `msg_rules_hook_${hash}`;
        const transientPartId = `prt_hook_transient_${hash}`;
        if (
          presentIds.has(transientMessageId) ||
          presentIds.has(transientPartId) ||
          presentIds.has(`prt_hook_${hash}`)
        ) {
          continue;
        }
        const transient = buildTransientHookMessage(
          content,
          this.transientBaseInfo(messages)
        );
        transient.parts[0] = {
          ...transient.parts[0],
          sessionID,
          messageID: transient.info.id,
        };
        messages.push(transient as MessageWithInfo);
      }
    } catch (error) {
      this.debugLog(
        `Transient injection failed for ${sessionID}: ${formatError(error)}`
      );
    }
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

  /** Assemble the shared filter context from session state and live queries. */
  private async buildSessionFilterContext(
    sessionID: string,
    userPrompt: string | undefined,
    modelID: string | undefined,
    agentType: string | undefined
  ): Promise<RuleFilterContext> {
    const state = this.sessionStore.get(sessionID);
    const contextFilePaths = Array.from(state?.contextPaths ?? []).sort(
      (a, b) => a.localeCompare(b)
    );
    const availableToolIDs = await this.queryAvailableToolIDs();
    return buildFilterContext({
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
    const context = await this.buildSessionFilterContext(
      sessionID,
      userPrompt,
      modelID,
      agentType
    );
    return matchRuleSnapshots(snapshots, context);
  }

  /** Append request-scoped synthetic user messages carrying ephemeral rule
   * matches for the current model dispatch. Never persisted: transform
   * mutations are discarded after dispatch. Idempotent by deterministic
   * ids and durable-key dedup. */
  private appendTransientRuleInjections(
    sessionID: string,
    messages: MessageWithInfo[],
    matches: MatchedRuleEntry[]
  ): void {
    const state = this.sessionStore.get(sessionID);
    const lastMessage = messages[messages.length - 1];
    if (!state || !lastMessage?.parts) return;

    const presentIds = new Set<string>();
    for (const message of messages) {
      if (typeof message.info?.id === 'string') presentIds.add(message.info.id);
      for (const part of message.parts ?? []) {
        if (typeof part.id === 'string') presentIds.add(part.id);
      }
    }
    const persistedKeys = new Set([
      ...state.injectedRuleKeys,
      ...scanInjectedParts(messages).ruleKeys,
    ]);

    for (const rule of matches) {
      if (rule.lifetime !== 'ephemeral') continue;
      const key = ruleKeyFor(rule.relativePath, rule.strippedContent);
      if (persistedKeys.has(key)) continue;
      const transient = buildTransientRuleMessage(
        rule.relativePath,
        rule.strippedContent,
        this.transientBaseInfo(messages)
      );
      if (
        presentIds.has(transient.info.id) ||
        presentIds.has(transient.parts[0]!.id)
      )
        continue;
      transient.parts[0] = {
        ...transient.parts[0]!,
        sessionID,
        messageID: transient.info.id,
      };
      messages.push(transient as MessageWithInfo);
      presentIds.add(transient.info.id);
      presentIds.add(transient.parts[0]!.id);
    }
  }

  /** Append request-scoped synthetic user messages carrying ephemeral hook
   * texts owned by ephemeral rules. Consumed only by transform; the queue
   * is cleared after a successful or duplicate-free delivery and retained
   * when no message can be transformed. */
  private appendTransientEphemeralHookInjections(
    sessionID: string,
    messages: MessageWithInfo[]
  ): void {
    const state = this.sessionStore.get(sessionID);
    if (!state?.pendingEphemeralHookInjections?.length) return;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.parts) return;

    const pending = [...new Set(state.pendingEphemeralHookInjections)];
    const presentIds = new Set<string>();
    for (const message of messages) {
      if (typeof message.info?.id === 'string') presentIds.add(message.info.id);
      for (const part of message.parts ?? []) {
        if (typeof part.id === 'string') presentIds.add(part.id);
      }
    }

    for (const content of pending) {
      const transient = buildTransientHookMessage(
        content,
        this.transientBaseInfo(messages)
      );
      const hash = hashContent(content);
      if (
        !presentIds.has(transient.info.id) &&
        !presentIds.has(transient.parts[0]!.id) &&
        !presentIds.has(`prt_hook_${hash}`)
      ) {
        transient.parts[0] = {
          ...transient.parts[0]!,
          sessionID,
          messageID: transient.info.id,
        };
        messages.push(transient as MessageWithInfo);
        presentIds.add(transient.info.id);
        presentIds.add(transient.parts[0]!.id);
      }
    }

    this.sessionStore.upsert(sessionID, next => {
      next.pendingEphemeralHookInjections = [];
    });
  }

  /** Rebuild injected-part tracking from the message array (history is ground truth).
   * Never writes active-rules state: history is not the source of current
   * activity; only the complete user-turn evaluation in chat.message is. */
  private async rescanInjectedParts(
    sessionID: string,
    messages: MessageWithInfo[]
  ): Promise<void> {
    try {
      const scan = scanInjectedParts(messages);
      this.sessionStore.upsert(sessionID, state => {
        state.injectedRuleKeys = new Set(scan.ruleKeys);
        state.injectedHookHashes = new Set(scan.hookHashes);
        state.needsRuleRescan = false;
      });
      this.debugLog(
        `Rescanned injected parts for session ${sessionID}: ${scan.ruleKeys.size} rule key(s), ${scan.hookHashes.size} hook hash(es)`
      );
    } catch (error) {
      // Keep existing state; the flag (if set) stays for the next dispatch.
      this.debugLog(
        `History scan failed for ${sessionID}: ${formatError(error)}`
      );
    }
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

      // 2. First message of a session run: rebuild injection keys from
      //    persisted history so restarts never duplicate parts. Once the
      //    history scan completes, in-memory keys are authoritative for
      //    the session; later turns must not re-derive (and potentially
      //    drop) keys from a stale client snapshot.
      const initialState = this.sessionStore.get(sessionID);
      if (initialState && !initialState.seededFromHistory) {
        const scanned = await this.scanHistoryFromClient(sessionID);
        if (scanned === undefined) {
          this.sessionStore.upsert(sessionID, state => {
            state.needsRuleRescan = true;
          });
          this.debugLog(
            `History fetch failed for ${sessionID} - skipping injection this turn`
          );
          return;
        }
        this.sessionStore.upsert(sessionID, state => {
          state.injectedRuleKeys = new Set(scanned.ruleKeys);
          state.injectedHookHashes = new Set(scanned.hookHashes);
          for (const p of scanned.contextPaths) {
            state.contextPaths.add(
              normalizeContextPath(p, this.projectDirectory)
            );
          }
          state.seededFromHistory = true;
        });
      }

      // 3. Never append while a rescan is pending (history keys unknown/stale)
      const state = this.sessionStore.get(sessionID);
      if (!state || state.needsRuleRescan) {
        this.debugLog(
          `Session ${sessionID} needs rule rescan - skipping injection this turn`
        );
        return;
      }

      // 4. Rule matching (skipped for messages without non-synthetic text)
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

      // 5. Resolve the owning message id and guard before any part
      //    construction or store mutation: persisted parts must carry
      //    sessionID/messageID (SDK schema), so skip rather than emit
      //    schema-invalid parts. The pending queue stays intact for retry.
      const messageID = input.messageID ?? output.message?.id;
      if (!messageID) {
        this.debugLog(
          `No messageID available for session ${sessionID} - skipping synthetic part injection`
        );
        return;
      }

      // 6. Append one synthetic part per not-yet-injected durable rule
      const newParts: SyntheticPart[] = [];
      const newRuleKeys: string[] = [];
      for (const rule of durableMatches) {
        const key = ruleKeyFor(rule.relativePath, rule.strippedContent);
        if (state.injectedRuleKeys.has(key) || newRuleKeys.includes(key)) {
          continue;
        }
        newParts.push({
          ...buildRulePart(rule.relativePath, rule.strippedContent),
          sessionID,
          messageID,
        });
        newRuleKeys.push(key);
      }

      // 7. Flush queued hook injections as durable parts (content-hash dedup)
      const newHookHashes: string[] = [];
      const pending = state.pendingHookInjections ?? [];
      for (const content of new Set(pending)) {
        const hash = hashContent(content);
        if (
          state.injectedHookHashes.has(hash) ||
          newHookHashes.includes(hash)
        ) {
          continue;
        }
        newParts.push({
          ...buildHookInjectionPart(content),
          sessionID,
          messageID,
        });
        newHookHashes.push(hash);
      }

      if (newParts.length > 0) {
        if (!output.parts) {
          output.parts = [];
        }
        output.parts.push(...newParts);
      }

      this.sessionStore.upsert(sessionID, s => {
        for (const key of newRuleKeys) {
          s.injectedRuleKeys.add(key);
        }
        for (const hash of newHookHashes) {
          s.injectedHookHashes.add(hash);
        }
        s.pendingHookInjections = [];
      });

      if (captured.userPrompt) {
        await writeActiveRulesState(
          sessionID,
          matched.map(r => r.filePath)
        );
      }

      this.debugLog(
        `Appended ${newParts.length} synthetic part(s) for session ${sessionID}`
      );
    } catch (error) {
      this.debugLog(`chat.message handler failed: ${formatError(error)}`);
    }
  }

  /** Fetch persisted history via the client and scan it for injected parts.
   * Returns undefined when the fetch fails (history state unknown). */
  private async scanHistoryFromClient(
    sessionID: string
  ): Promise<HistoryScanResult | undefined> {
    const session = this.client.session;
    if (!session?.messages) {
      // Client without the session API (older host or test mock):
      // assume a fresh session with empty history.
      this.debugLog(
        `Client lacks session.messages - assuming empty history for ${sessionID}`
      );
      return {
        ruleKeys: new Set<string>(),
        hookHashes: new Set<string>(),
        ruleRelativePaths: new Set<string>(),
        contextPaths: [],
      };
    }
    try {
      // SDK methods rely on instance state via `this`; must not be called detached.
      const result = await session.messages({
        path: { id: sessionID },
        query: { directory: this.directory },
      });
      const messages = (result?.data ?? []) as MessageWithInfo[];
      const scan = scanInjectedParts(messages);
      let contextPaths: string[] = [];
      try {
        contextPaths = extractFilePathsFromMessages(
          filterValidMessages(messages)
        );
      } catch (error) {
        this.debugLog(
          `History context path extraction failed for ${sessionID}: ${formatError(error)}`
        );
      }
      return { ...scan, contextPaths };
    } catch (error) {
      logWarning('Failed to fetch session history', error);
      return undefined;
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

    // Rule re-append must be decoupled from path tracking: pure chat
    // sessions compact too. Consumed by the first post-compaction rescan.
    this.sessionStore.upsert(sessionID, state => {
      state.needsRuleRescan = true;
    });

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

  /** Classify the delivery lifetime of a hook-owning rule. A rule whose
   * durable part is already persisted is durable; otherwise the current
   * condition provenance decides, defaulting to ephemeral when unproven. */
  private classifyHookRuleLifetime(
    sessionID: string,
    rule: RuleSnapshot,
    context: RuleFilterContext
  ): RuleLifetime {
    const key = ruleKeyFor(rule.relativePath, rule.strippedContent);
    if (this.sessionStore.get(sessionID)?.injectedRuleKeys.has(key)) {
      return 'durable';
    }
    return matchRuleSnapshots([rule], context)[0]?.lifetime ?? 'ephemeral';
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
    const filterContext = await this.buildSessionFilterContext(
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
    // Deduplicate content per rule (one injection per rule, regardless of how many hooks matched)
    const seenContent = new Set<string>();
    for (const { hook, rule } of allMatches) {
      if (!seenContent.has(rule.strippedContent)) {
        seenContent.add(rule.strippedContent);
        const lifetime = this.classifyHookRuleLifetime(
          sessionID,
          rule,
          filterContext
        );

        this.sessionStore.upsert(sessionID, state => {
          const queue =
            lifetime === 'durable'
              ? state.pendingHookInjections
              : state.pendingEphemeralHookInjections;
          if (queue) {
            queue.push(rule.strippedContent);
          } else if (lifetime === 'durable') {
            state.pendingHookInjections = [rule.strippedContent];
          } else {
            state.pendingEphemeralHookInjections = [rule.strippedContent];
          }
        });

        this.debugLog(
          `${hookType} hook fired for rule ${rule.relativePath}, tool ${toolName} (${lifetime})`
        );
      }

      if (hook.run) {
        await this.executeHookSideEffect(hook.run, sessionID);
      }
    }
  }
}
