import {
  hasFileObservationFamily,
  matchRuleSnapshots,
  type RuleMatchContext,
  type MatchedRuleEntry,
} from '../rules/rule-filter.js';
import {
  loadRuleSnapshots,
  type DiscoveredRule,
  type RuleSnapshot,
} from '../rules/rule-discovery.js';
import {
  extractLatestUserPrompt,
  extractSessionID,
  type MessageWithInfo,
} from '../session/message-extraction.js';
import { createDebugLog, formatError, type DebugLog } from '../shared/debug.js';
import type { SessionStore } from '../session/session-store.js';
import type { MatchedRulesStateStore } from '../session/matched-rules-state.js';
import { buildRuleMatchContext } from './match-context.js';
import {
  updateSessionFromChatMessage,
  type ChatMessageInput,
  type ChatMessageOutput,
} from './chat-capture.js';
import {
  createRuleDelivery,
  type MatchedRuleContent,
  type RuleDelivery,
} from '../delivery/rule-delivery.js';
import {
  createSessionWorkingContext,
  type SessionWorkingContext,
} from '../session/session-working-context.js';
import {
  createFileObservationContext,
  type FileObservationContext,
} from '../session/file-observation-context.js';
import { isRuleAdmissionPart } from '../delivery/rule-delivery-codec.js';
import {
  OpenCodeClientAdapter,
  type OpenCodeClient,
} from './client-adapter.js';
import { ToolHookFlow } from './tool-hook-flow.js';

interface MessagesTransformOutput {
  messages: MessageWithInfo[];
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

interface SessionRuleEvaluationInput {
  sessionID: string;
  userPrompt: string | undefined;
  modelID: string | undefined;
  agentType: string | undefined;
  selectSnapshot?: (snapshot: RuleSnapshot) => boolean;
}

export class OpenCodeRulesRuntime {
  private directory: string;
  private ruleFiles: DiscoveredRule[];
  private sessionStore: SessionStore;
  private matchedRulesStateStore: MatchedRulesStateStore;
  private debugLog: DebugLog;
  private clientAdapter: OpenCodeClientAdapter;
  private toolHookFlow: ToolHookFlow;
  private ruleDelivery: RuleDelivery;
  private sessionWorkingContext: SessionWorkingContext;
  private fileObservationContext: FileObservationContext;
  private snapshotPromises = new Map<string, Promise<RuleSnapshot[]>>();

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.directory = opts.directory;
    this.ruleFiles = opts.ruleFiles;
    this.sessionStore = opts.sessionStore;
    this.matchedRulesStateStore = opts.matchedRulesStateStore;
    this.debugLog = opts.debugLog ?? createDebugLog();
    this.clientAdapter = new OpenCodeClientAdapter({
      client: opts.client as OpenCodeClient,
      directory: opts.directory,
      projectDirectory: opts.projectDirectory,
      debugLog: this.debugLog,
    });
    this.fileObservationContext = createFileObservationContext({
      projectDirectory: opts.projectDirectory,
    });
    this.sessionWorkingContext = createSessionWorkingContext({
      sessionStore: opts.sessionStore,
      projectDirectory: opts.projectDirectory,
      readHistory: sessionID => this.clientAdapter.readClientHistory(sessionID),
      debugLog: this.debugLog,
    });
    this.ruleDelivery = createRuleDelivery({
      rawHistory: this.sessionWorkingContext.rawHistory,
      debugLog: this.debugLog,
      persistAdmission: (sessionID, part) =>
        this.clientAdapter.persistRuleAdmission(sessionID, part),
    });
    this.toolHookFlow = new ToolHookFlow({
      debugLog: this.debugLog,
      projectDirectory: opts.projectDirectory,
      ensureSessionRuleSnapshot: sessionID =>
        this.ensureSessionRuleSnapshot(sessionID),
      buildMatchContext: sessionID =>
        this.buildSessionRuleMatchContext(sessionID),
      queueMatchedHooks: input => this.ruleDelivery.queueMatchedHooks(input),
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

    // A failed or blocked execution must never activate globs/fileContains
    // rules; only successful after-hook events feed the observation store.
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

    // Output text supports fileContains matching; failed executions never
    // reach this hook.
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
      // Union, never replace: an admission must not clobber sidebar state
      // written by durable turns.
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

  private async buildSessionRuleMatchContext(
    sessionID: string,
    userPrompt?: string,
    modelID?: string,
    agentType?: string
  ): Promise<RuleMatchContext> {
    const fileObservations =
      this.fileObservationContext.getForMatching(sessionID);
    const availableToolIDs = await this.clientAdapter.queryAvailableToolIDs();
    return buildRuleMatchContext({
      fileObservations,
      userPrompt,
      availableToolIDs,
      modelID,
      agentType,
      projectDirectory: this.directory,
      debugLog: this.debugLog,
    });
  }

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

      // Accumulate paths from this message before durable-turn preparation
      // so matching sees current and restored paths together.
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

  /** @throws when a blocking PreToolUse hook matches. */
  private async evaluateAndQueueHooks(
    hookType: 'PreToolUse' | 'PostToolUse',
    sessionID: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<void> {
    await this.toolHookFlow.evaluateAndQueueHooks(
      hookType,
      sessionID,
      toolName,
      args
    );
  }
}
