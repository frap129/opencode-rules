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
import type { MessageWithInfo } from '../session/message-extraction.js';
import { fromContextMessages } from '../session/v2-messages.js';
import { createDebugLog, formatError, type DebugLog } from '../shared/debug.js';
import type { SessionStore } from '../session/session-store.js';
import type { MatchedRulesStateStore } from '../session/matched-rules-state.js';
import { buildRuleMatchContext } from './match-context.js';
import { captureSessionContext, captureSessionPrompt } from './chat-capture.js';
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
import type { DeliveryPart } from '../delivery/rule-delivery-codec.js';
import {
  OpenCodeClientAdapter,
  type OpenCodeClient,
} from './client-adapter.js';
import { ToolHookFlow } from './tool-hook-flow.js';

// v2 hook payloads, kept structural so the orchestrator stays testable
// without importing the beta package's Effect-branded types.
export interface V2ToolExecuteBeforeInput {
  tool?: string;
  sessionID?: string;
  agent?: string;
  messageID?: string;
  id?: string;
  input?: unknown;
}

export interface V2ToolExecuteAfterInput {
  tool?: string;
  sessionID?: string;
  agent?: string;
  messageID?: string;
  id?: string;
  input?: unknown;
  status?: string;
  result?: { output?: unknown; content?: unknown; metadata?: unknown };
  error?: unknown;
}

export interface V2SessionContextInput {
  sessionID?: string;
  agent?: string;
  /** v2 hook shape: Model.Ref ({ providerID, id, variant? }); id is the model ID. */
  model?: { id?: string; providerID?: string; variant?: string };
  messages?: unknown;
  tools?: Record<string, unknown>;
}

export interface V2SessionPromptInput {
  sessionID?: string;
  messageID?: string;
  prompt?: { text?: string };
}

export interface V2EventInput {
  type?: string;
  data?: { sessionID?: unknown };
}

export interface V2DeliverySink {
  /** Durable injection: ctx.session.synthetic. */
  synthetic(input: {
    sessionID: string;
    id: string;
    text: string;
    metadata?: Record<string, unknown>;
    delivery?: 'steer' | 'queue';
  }): Promise<unknown>;
}

interface HookRegistration {
  dispose(): Promise<void>;
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
  private availableToolIDs: string[] = [];
  private deliverySink: V2DeliverySink | null = null;

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.directory = opts.directory;
    this.ruleFiles = opts.ruleFiles;
    this.sessionStore = opts.sessionStore;
    this.matchedRulesStateStore = opts.matchedRulesStateStore;
    this.debugLog = opts.debugLog ?? createDebugLog();
    this.clientAdapter = new OpenCodeClientAdapter({
      client: opts.client as OpenCodeClient,
      directory: opts.directory,
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

  /**
   * Registers the v2 hooks on a plugin context and starts the event loop.
   * Returns a cleanup function disposing registrations and stopping the
   * event loop. The registered callbacks stay reachable through the context
   * for tests, which pass a mock context and invoke handlers directly.
   */
  async wire(context: {
    tool: {
      hook(
        name: 'execute.before',
        handler: (input: V2ToolExecuteBeforeInput) => Promise<void> | void
      ): Promise<HookRegistration>;
      hook(
        name: 'execute.after',
        handler: (input: V2ToolExecuteAfterInput) => Promise<void> | void
      ): Promise<HookRegistration>;
    };
    session: {
      hook(
        name: 'context',
        handler: (input: V2SessionContextInput) => Promise<void> | void
      ): Promise<HookRegistration>;
      hook(
        name: 'prompt',
        handler: (input: V2SessionPromptInput) => Promise<void> | void
      ): Promise<HookRegistration>;
      synthetic?: V2DeliverySink['synthetic'];
    };
    event: {
      subscribe(options?: {
        signal?: AbortSignal;
      }): AsyncIterable<V2EventInput>;
    };
  }): Promise<() => Promise<void>> {
    // Keep the session domain so sink calls (synthetic) stay method-bound.
    this.deliverySink = context.session.synthetic
      ? {
          synthetic: (input, ...rest) =>
            context.session.synthetic!(input, ...rest),
        }
      : null;

    const registrations: HookRegistration[] = [];
    registrations.push(
      await context.tool.hook('execute.before', input =>
        this.onToolExecuteBefore(input)
      )
    );
    registrations.push(
      await context.tool.hook('execute.after', input =>
        this.onToolExecuteAfter(input)
      )
    );
    registrations.push(
      await context.session.hook('context', input =>
        this.onSessionContext(input)
      )
    );
    registrations.push(
      await context.session.hook('prompt', input => this.onSessionPrompt(input))
    );

    const abortController = new AbortController();
    const eventLoop = this.runEventLoop(context.event, abortController.signal);

    return async () => {
      abortController.abort();
      await eventLoop.catch(() => undefined);
      for (const registration of registrations.reverse()) {
        await registration.dispose().catch(() => undefined);
      }
    };
  }

  private async runEventLoop(
    eventDomain: {
      subscribe(options?: {
        signal?: AbortSignal;
      }): AsyncIterable<V2EventInput>;
    },
    signal: AbortSignal
  ): Promise<void> {
    let events: AsyncIterable<V2EventInput>;
    try {
      events = await eventDomainSubscribe(eventDomain, signal);
    } catch (error) {
      this.debugLog(`Event subscription failed: ${formatError(error)}`);
      return;
    }
    for await (const event of events) {
      if (signal.aborted) return;
      try {
        this.onEvent(event);
      } catch (error) {
        this.debugLog(`Event handler failed: ${formatError(error)}`);
      }
    }
  }

  /**
   * v2 event stream. The v1 `message.removed` event is gone; revert events
   * (staged/committed/cleared) are the message-removal mechanism that can
   * drop a durable delivery part from history.
   */
  private onEvent(event: V2EventInput): void {
    const type = event?.type;
    const sessionID = event?.data?.sessionID;
    if (typeof sessionID !== 'string') return;

    if (
      type === 'session.revert.staged' ||
      type === 'session.revert.committed' ||
      type === 'session.revert.cleared'
    ) {
      this.ruleDelivery.markHistoryChanged(sessionID);
      this.sessionWorkingContext.workingContext.invalidateHistoryReads(
        sessionID
      );
      return;
    }

    // Compaction invalidation only; projection rides the next context
    // dispatch (map ticket #73).
    if (
      type === 'session.compaction.started' ||
      type === 'session.compaction.ended'
    ) {
      this.ruleDelivery.markCompacted(sessionID);
      this.sessionWorkingContext.workingContext.invalidateHistoryReads(
        sessionID
      );
      this.sessionStore.upsert(sessionID, state => {
        state.compacted = true;
      });
    }
  }

  private async onToolExecuteBefore(
    input: V2ToolExecuteBeforeInput
  ): Promise<void> {
    const sessionID = input?.sessionID;
    const toolName = input?.tool;
    const args = input?.input;

    if (!sessionID || !toolName || !args) {
      return;
    }

    // A failed or blocked execution must never activate globs/fileContains
    // rules; only successful after-hook events feed the observation store.
    await this.evaluateAndQueueHooks(
      'PreToolUse',
      sessionID,
      toolName,
      args as Record<string, unknown>
    );
  }

  private async onToolExecuteAfter(
    input: V2ToolExecuteAfterInput
  ): Promise<void> {
    const sessionID = input?.sessionID;
    const toolName = input?.tool;
    const args = input?.input;

    if (!sessionID || !toolName || !args) {
      return;
    }

    // A failed execution never activates globs/fileContains rules.
    if (input?.status !== 'completed') return;

    // Output text supports fileContains matching; result.content is a
    // string or a Content[] array in v2.
    const output = extractToolResultText(input.result);
    const observations = this.fileObservationContext.recordToolEvent(
      sessionID,
      {
        tool: toolName,
        args: args as Record<string, unknown>,
        ...(output !== undefined && output.length > 0 ? { output } : {}),
      }
    );
    this.sessionWorkingContext.workingContext.recordObservations(
      sessionID,
      observations
    );

    if (observations.length > 0) {
      await this.admitObservationMatches(sessionID);
    }

    await this.evaluateAndQueueHooks(
      'PostToolUse',
      sessionID,
      toolName,
      args as Record<string, unknown>
    );
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

  /**
   * Session `context` hook: per-dispatch transient injection. Replaces v1's
   * experimental.chat.messages.transform; mutates input.messages in place.
   */
  private async onSessionContext(input: V2SessionContextInput): Promise<void> {
    const sessionID = input?.sessionID;
    if (!sessionID || !Array.isArray(input?.messages)) {
      this.debugLog('No sessionID or messages in session context hook input');
      return;
    }

    // Available-tool tracking: the context hook's tool table replaces v1's
    // tool.ids RPC as the built-in tool source.
    const toolIDs = Object.keys(input.tools ?? {});
    if (toolIDs.length > 0) {
      this.availableToolIDs = toolIDs;
    }

    // Normalize AI Messages into the internal { info, parts } form; the
    // appended transient messages are converted back to v2 shape below.
    const messages = fromContextMessages(input.messages);

    const captured = captureSessionContext(
      {
        sessionID,
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        messages,
      },
      this.sessionStore,
      this.debugLog
    );

    const seededByContext =
      this.sessionWorkingContext.workingContext.seedFromSuppliedMessages(
        sessionID,
        messages
      );
    if (seededByContext && !captured?.userPrompt) {
      const userPrompt = latestUserPromptFromMessages(messages);
      if (userPrompt) {
        this.sessionStore.upsert(sessionID, state => {
          if (!state.lastUserPrompt) state.lastUserPrompt = userPrompt;
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
        const prompt =
          captured?.userPrompt ?? latestUserPromptFromMessages(messages);
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
    const messagesBefore = messages.length;
    this.ruleDelivery.deliverTransientDispatch({
      sessionID,
      matchedRules: ephemeralRules,
      messages: messages,
    });
    for (const appended of messages.slice(messagesBefore)) {
      input.messages.push(
        internalToV2Message(
          appended as MessageWithInfo & { parts?: DeliveryPart[] }
        )
      );
    }
    await this.ruleDelivery.retryPendingAdmissions(sessionID);

    // Compacted-session projection: v1 used the compaction hook's
    // output.context channel; v2 has none, so the projection rides the
    // next context dispatch.
    this.deliverCompactionProjection(sessionID, input.messages);
  }

  private deliverCompactionProjection(
    sessionID: string,
    messages: unknown
  ): void {
    let compacted = false;
    this.sessionStore.upsert(sessionID, state => {
      compacted = state.compacted === true;
      if (compacted) state.compacted = false;
    });
    if (!compacted) return;
    const projection =
      this.sessionWorkingContext.workingContext.prepareForCompaction(sessionID);
    if (!projection) {
      this.debugLog(
        `No context paths for session ${sessionID} during compaction`
      );
      return;
    }
    if (Array.isArray(messages)) {
      messages.push({
        id: 'msg_rules_compact_projection',
        role: 'user',
        content: [{ type: 'text', text: projection }],
      });
    }
    this.debugLog(
      `Added Working-context projection to dispatch for session ${sessionID}`
    );
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
    const availableToolIDs = await this.clientAdapter.queryAvailableToolIDs(
      this.availableToolIDs
    );
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

  /**
   * Session `prompt` hook: durable-rule delivery per admitted user prompt.
   * Replaces v1's chat.message handler. Delivery reuses the existing
   * RuleDelivery engine against a virtual output, then publishes each
   * appended durable part via ctx.session.synthetic: v2 hook handlers
   * cannot append parts to the user message, and synthetic messages persist
   * into history so the ledger keeps working.
   */
  private async onSessionPrompt(input: V2SessionPromptInput): Promise<void> {
    try {
      const sessionID = input?.sessionID;
      const promptText = input?.prompt?.text;
      if (!sessionID || !promptText) return;

      // Our own admission parts are prompts too; never treat them as user
      // turns (v1 skipped its admission parts in chat.message).
      if (promptText.startsWith('<system-message>')) return;

      const captured = captureSessionPrompt(
        input,
        this.sessionStore,
        this.debugLog
      );

      // Accumulate paths from history before durable-turn preparation so
      // matching sees current and restored paths together.
      await this.sessionWorkingContext.workingContext.prepareDurableTurn(
        sessionID
      );

      let matched: MatchedRuleEntry[] = [];
      if (captured?.userPrompt) {
        const state = this.sessionStore.get(sessionID);
        matched = await this.evaluateSessionRules({
          sessionID,
          userPrompt: captured.userPrompt,
          modelID: state?.lastModelID,
          agentType: state?.lastAgentType,
        });
      }
      const durableMatches = matched.filter(
        rule => rule.lifetime === 'durable'
      );

      const messageID = input?.messageID;
      const output: { parts?: DeliveryPart[] } = {};
      const result = await this.ruleDelivery.deliverDurableTurn({
        sessionID,
        ...(messageID !== undefined ? { messageID } : {}),
        matchedRules: this.toDeliveryRules(durableMatches),
        output,
      });

      if (result !== 'accepted') return;

      const sink = this.deliverySink;
      if (!sink) {
        throw new Error('ctx.session.synthetic is unavailable');
      }
      for (const part of output.parts ?? []) {
        if (part.type !== 'text' || typeof part.id !== 'string') continue;
        // v2 validates synthetic ids as Session.Message.ID ("msg_" prefix);
        // the codec's "prt_rules_" part id is an internal identity and must
        // be converted to idempotency-stable message form.
        await sink.synthetic({
          sessionID,
          id: syntheticMessageId(part.id),
          text: typeof part.text === 'string' ? part.text : '',
          ...(part.metadata !== undefined ? { metadata: part.metadata } : {}),
          delivery: 'steer',
        });
      }

      if (captured?.userPrompt) {
        await this.matchedRulesStateStore.write(
          sessionID,
          matched.map(r => r.filePath)
        );
      }
    } catch (error) {
      this.debugLog(`session.prompt handler failed: ${formatError(error)}`);
    }
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

async function eventDomainSubscribe(
  eventDomain: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<V2EventInput>;
  },
  signal: AbortSignal
): Promise<AsyncIterable<V2EventInput>> {
  return eventDomain.subscribe({ signal });
}

function extractToolResultText(
  result: { output?: unknown; content?: unknown } | undefined
): string | undefined {
  const content = result?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const value of content) {
      if (
        value !== null &&
        typeof value === 'object' &&
        (value as { type?: unknown }).type === 'text' &&
        typeof (value as { text?: unknown }).text === 'string'
      ) {
        texts.push((value as { text: string }).text);
      }
    }
    if (texts.length > 0) return texts.join('\n');
  }
  const output = result?.output;
  if (typeof output === 'string') return output;
  return undefined;
}

// v2 synthetic admission validates ids as Session.Message.ID ("msg_"
// prefix) and rejects anything else. Derive a stable "msg_" id from the
// codec part id so retries with the same rules keep idempotency.
function syntheticMessageId(partId: string): string {
  if (partId.startsWith('msg_')) return partId;
  return `msg_${partId}`;
}

function latestUserPromptFromMessages(
  messages: readonly MessageWithInfo[]
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.info?.role !== 'user') continue;
    const parts = message.parts ?? [];
    for (const part of parts) {
      if (part.synthetic) continue;
      if (part.type === 'text' && part.text) return part.text;
    }
  }
  return undefined;
}

function internalToV2ContentPart(part: DeliveryPart): unknown {
  return {
    type: 'text',
    text: part.text ?? '',
    ...(part.metadata !== undefined ? { metadata: part.metadata } : {}),
  };
}

function internalToV2Message(
  message: MessageWithInfo & { parts?: DeliveryPart[] }
): unknown {
  return {
    ...(message.info?.id !== undefined ? { id: message.info.id } : {}),
    role: message.info?.role ?? 'user',
    content: (message.parts ?? []).map(internalToV2ContentPart),
  };
}
