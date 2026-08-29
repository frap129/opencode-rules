import {
  hasFileObservationFamily,
  matchRuleSnapshots,
  type RuleMatchContext,
  type MatchedRuleEntry,
} from './rule-filter.js';
import {
  loadRuleSnapshots,
  type DiscoveredRule,
  type RuleSnapshot,
} from './rule-discovery.js';
import {
  extractLatestUserPrompt,
  extractSessionID,
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
import type { MatchedRulesStateStore } from './matched-rules-state.js';
import { buildRuleMatchContext } from './runtime-context.js';
import {
  updateSessionFromChatMessage,
  type ChatMessageInput,
  type ChatMessageOutput,
} from './runtime-chat.js';
import { evaluateHooks, serializeToolArgs } from './rule-hooks.js';
import {
  createRuleDelivery,
  type MatchedHookContent,
  type MatchedRuleContent,
  type RuleDelivery,
} from './rule-delivery.js';
import type { RawHistoryResult } from './rule-delivery-history.js';
import {
  createSessionWorkingContext,
  type SessionWorkingContext,
} from './session-working-context.js';
import {
  createFileObservationContext,
  type FileObservationContext,
} from './file-observation-context.js';
import {
  isRuleAdmissionPart,
  type DeliveryPart,
} from './rule-delivery-codec.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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
    prompt?: (args: {
      path: { id: string };
      query?: { directory?: string };
      body: {
        messageID?: string;
        noReply: boolean;
        parts: Array<{
          id?: string;
          type: 'text';
          text: string;
          synthetic?: boolean;
          metadata?: Record<string, unknown>;
        }>;
      };
    }) => Promise<unknown>;
  };
}

interface OpenCodeRulesRuntimeOptions {
  client: unknown;
  directory: string;
  projectDirectory: string;
  ruleFiles: DiscoveredRule[];
  sessionStore: SessionStore;
  matchedRulesStateStore: MatchedRulesStateStore;
  debugLog?: DebugLog;
}

/** One object-shaped input for the single session-rule evaluation path. */
interface SessionRuleEvaluationInput {
  sessionID: string;
  userPrompt: string | undefined;
  modelID: string | undefined;
  agentType: string | undefined;
  selectSnapshot?: (snapshot: RuleSnapshot) => boolean;
}

export class OpenCodeRulesRuntime {
  private client: OpenCodeClient;
  private directory: string;
  private projectDirectory: string;
  private ruleFiles: DiscoveredRule[];
  private sessionStore: SessionStore;
  private matchedRulesStateStore: MatchedRulesStateStore;
  private debugLog: DebugLog;
  private ruleDelivery: RuleDelivery;
  private sessionWorkingContext: SessionWorkingContext;
  private fileObservationContext: FileObservationContext;
  private snapshotPromises = new Map<string, Promise<RuleSnapshot[]>>();

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.client = opts.client as OpenCodeClient;
    this.directory = opts.directory;
    this.projectDirectory = opts.projectDirectory;
    this.ruleFiles = opts.ruleFiles;
    this.sessionStore = opts.sessionStore;
    this.matchedRulesStateStore = opts.matchedRulesStateStore;
    this.debugLog = opts.debugLog ?? createDebugLog();
    this.fileObservationContext = createFileObservationContext({
      projectDirectory: opts.projectDirectory,
    });
    this.sessionWorkingContext = createSessionWorkingContext({
      sessionStore: opts.sessionStore,
      projectDirectory: opts.projectDirectory,
      readHistory: sessionID => this.readClientHistory(sessionID),
      debugLog: this.debugLog,
    });
    this.ruleDelivery = createRuleDelivery({
      rawHistory: this.sessionWorkingContext.rawHistory,
      debugLog: this.debugLog,
      persistAdmission: (sessionID, part) =>
        this.persistRuleAdmission(sessionID, part),
    });
  }

  private async persistRuleAdmission(
    sessionID: string,
    part: DeliveryPart
  ): Promise<void> {
    const prompt = this.client.session?.prompt;
    if (!prompt || part.type !== 'text' || typeof part.text !== 'string') {
      throw new Error('OpenCode session.prompt is unavailable');
    }
    await prompt({
      path: { id: sessionID },
      query: { directory: this.projectDirectory },
      body: {
        ...(typeof part.messageID === 'string'
          ? { messageID: part.messageID }
          : {}),
        noReply: true,
        parts: [
          {
            ...(typeof part.id === 'string' ? { id: part.id } : {}),
            type: 'text',
            text: part.text,
            synthetic: true,
            ...(part.metadata ? { metadata: part.metadata } : {}),
          },
        ],
      },
    });
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
    this.sessionWorkingContext.workingContext.invalidateHistoryReads(
      properties.sessionID
    );
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

    // Pre-success: no File observation is recorded here. A failed or blocked
    // execution must never activate globs/fileContains rules; only the
    // after-hook (successful events) feeds the observation store.
    await this.evaluateAndQueueHooks('PreToolUse', sessionID, toolName, args);
  }

  private async onToolExecuteAfter(
    input: {
      tool?: string;
      sessionID?: string;
      callID?: string;
      args?: Record<string, unknown>;
    },
    output: { title?: string; output?: string; metadata?: unknown }
  ): Promise<void> {
    const sessionID = input?.sessionID;
    const toolName = input?.tool;
    const args = input?.args;

    if (!sessionID || !toolName || !args) {
      return;
    }

    // Successful tool events produce File observations; failed executions
    // never reach this hook. Output text supports fileContains matching.
    const observations = this.fileObservationContext.recordToolEvent(
      sessionID,
      {
        tool: toolName,
        args,
        ...(typeof output?.output === 'string' && output.output.length > 0
          ? { output: output.output }
          : {}),
      }
    );
    this.sessionWorkingContext.workingContext.recordObservations(
      sessionID,
      observations
    );

    if (observations.length > 0) {
      await this.admitObservationMatches(sessionID);
    }

    await this.evaluateAndQueueHooks('PostToolUse', sessionID, toolName, args);
  }

  private async admitObservationMatches(sessionID: string): Promise<void> {
    const state = this.sessionStore.get(sessionID);
    const matches = (
      await this.evaluateSessionRules({
        sessionID,
        userPrompt: state?.lastUserPrompt,
        modelID: state?.lastModelID,
        agentType: state?.lastAgentType,
        // Only file-observation-family rules can be triggered by a fresh
        // observation; other condition kinds are evaluated per dispatch.
        selectSnapshot: rule => hasFileObservationFamily(rule.metadata),
      })
    ).filter(rule => rule.lifetime === 'durable');
    if (matches.length === 0) return;
    const result = await this.ruleDelivery.admitDurableMatches({
      sessionID,
      rules: this.toDeliveryRules(matches),
    });
    if (result === 'accepted') {
      // Union with existing sidebar state; never clobber previously
      // matched rules from durable turns.
      await this.matchedRulesStateStore.merge(
        sessionID,
        matches.map(rule => rule.filePath)
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

    const seededByTransform =
      this.sessionWorkingContext.workingContext.seedFromSuppliedMessages(
        sessionID,
        output.messages
      );
    if (seededByTransform) {
      const userPrompt = extractLatestUserPrompt(output.messages);
      if (userPrompt) {
        this.sessionStore.upsert(sessionID, state => {
          if (!state.lastUserPrompt) {
            state.lastUserPrompt = userPrompt;
          }
        });
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
        const matches = await this.evaluateSessionRules({
          sessionID,
          userPrompt: prompt,
          modelID: currentState.lastModelID,
          agentType: currentState.lastAgentType,
        });
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
    await this.ruleDelivery.retryPendingAdmissions(sessionID);

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
    const fileObservations =
      this.fileObservationContext.getForMatching(sessionID);
    const availableToolIDs = await this.queryAvailableToolIDs();
    return buildRuleMatchContext({
      fileObservations,
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
    input: SessionRuleEvaluationInput
  ): Promise<MatchedRuleEntry[]> {
    const snapshots = await this.ensureSessionRuleSnapshot(input.sessionID);
    const selected = input.selectSnapshot
      ? snapshots.filter(input.selectSnapshot)
      : snapshots;
    const context = await this.buildSessionRuleMatchContext(
      input.sessionID,
      input.userPrompt,
      input.modelID,
      input.agentType
    );
    return matchRuleSnapshots(selected, context);
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
      if (output.parts?.some(part => isRuleAdmissionPart(part))) return;
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

      // 1. Accumulate file paths mentioned in this message before durable-turn
      // preparation so matching sees current and restored paths.
      if (output.parts && output.parts.length > 0) {
        this.sessionWorkingContext.workingContext.recordMessageParts(
          sessionID,
          output.parts
        );
      }

      await this.sessionWorkingContext.workingContext.prepareDurableTurn(
        sessionID
      );

      let matched: MatchedRuleEntry[] = [];
      if (captured.userPrompt) {
        matched = await this.evaluateSessionRules({
          sessionID,
          userPrompt: captured.userPrompt,
          modelID: captured.modelID,
          agentType: captured.agentType,
        });
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
        await this.matchedRulesStateStore.write(
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

    const projection =
      this.sessionWorkingContext.workingContext.prepareForCompaction(sessionID);
    if (!projection) {
      this.debugLog(
        `No context paths for session ${sessionID} during compaction`
      );
      return;
    }

    if (!output.context) {
      output.context = [];
    }

    output.context.push(projection);

    this.debugLog(
      `Added Working-context projection to compaction for session ${sessionID}`
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
