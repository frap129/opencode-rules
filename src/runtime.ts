import { readAndFormatRules, type RuleFilterContext } from './rule-filter.js';
import { extractFilePathsFromMessages } from './message-paths.js';
import {
  type DiscoveredRule,
  getCachedRule,
  discoverProjectRuleFiles,
} from './rule-discovery.js';
import { toV1Messages } from './v2-messages.js';
import { expandToolKeys } from './tool-ids.js';
import type {
  V2Cleanup,
  V2PluginContext,
  V2SessionContext,
  V2ToolExecuteAfter,
  V2ToolExecuteBefore,
} from './v2-types.js';
import {
  extractLatestUserPrompt,
  extractSessionID,
  normalizeContextPath,
  sanitizePathForContext,
  filterValidMessages,
  type MessageWithInfo,
} from './message-context.js';
import { extractConnectedMcpCapabilityIDs } from './mcp-tools.js';
import { createDebugLog, logWarning, type DebugLog } from './debug.js';
import type { SessionStore } from './session-store.js';
import { buildFilterContext } from './runtime-context.js';
import {
  updateSessionFromChatMessage,
  type ChatMessageInput,
  type ChatMessageOutput,
} from './runtime-chat.js';
import { writeActiveRulesState } from './active-rules-state.js';
import { evaluateHooks, serializeToolArgs } from './rule-hooks.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface MessagesTransformOutput {
  messages: MessageWithInfo[];
}

interface SystemTransformInput {
  sessionID?: string;
}

interface SystemTransformOutput {
  system?: string;
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
}

interface OpenCodeRulesRuntimeOptions {
  client?: unknown;
  directory?: string;
  projectDirectory?: string;
  ruleFiles?: DiscoveredRule[];
  globalRules?: DiscoveredRule[];
  sessionStore: SessionStore;
  debugLog?: DebugLog;
  now?: () => number;
  directoryTTL?: number;
  failedDirectoryTTL?: number;
  emptyProjectRulesTTL?: number;
}

/** Thrown when a PreToolUse hook with block:true matches. The only intentional throw. */
export class RuleBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleBlockError';
  }
}

export class OpenCodeRulesRuntime {
  private client: OpenCodeClient;
  private directory: string;
  private projectDirectory: string;
  private ruleFiles: DiscoveredRule[];
  private globalRules: DiscoveredRule[] = [];
  private sessionStore: SessionStore;
  private debugLog: DebugLog;
  private now: () => number;
  private ctx: V2PluginContext | undefined;
  private directoryTTL: number;
  private failedDirectoryTTL: number;
  private emptyProjectRulesTTL: number;
  private directoryCache = new Map<string, { directory: string; at: number }>();
  private directoryFailCache = new Map<string, { at: number }>();
  private projectRulesCache = new Map<string, DiscoveredRule[]>();
  private projectRulesEmptyAt = new Map<string, number>();
  private projectRulesInFlight = new Map<string, Promise<DiscoveredRule[]>>();

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.client = opts.client as OpenCodeClient;
    this.directory = opts.directory ?? '';
    this.projectDirectory = opts.projectDirectory ?? opts.directory ?? '';
    this.ruleFiles = opts.ruleFiles ?? [];
    this.globalRules = opts.globalRules ?? [];
    this.sessionStore = opts.sessionStore;
    this.debugLog = opts.debugLog ?? createDebugLog();
    this.now = opts.now ?? (() => Date.now());
    this.directoryTTL = opts.directoryTTL ?? 30_000;
    this.failedDirectoryTTL = opts.failedDirectoryTTL ?? 5_000;
    this.emptyProjectRulesTTL = opts.emptyProjectRulesTTL ?? 60_000;
  }

  createHooks(): Record<string, unknown> {
    return {
      'tool.execute.before': this.onToolExecuteBefore.bind(this),
      'tool.execute.after': this.onToolExecuteAfter.bind(this),
      'experimental.chat.messages.transform':
        this.onMessagesTransform.bind(this),
      'chat.message': this.onChatMessage.bind(this),
      'experimental.chat.system.transform': this.onSystemTransform.bind(this),
      'experimental.session.compacting': this.onSessionCompacting.bind(this),
    };
  }

  /**
   * Registers the three V2 hooks. Returns a cleanup that disposes every
   * registration. Never rejects: registration failures are logged and the
   * already-registered hooks are disposed.
   */
  async registerHooks(ctx: V2PluginContext): Promise<V2Cleanup> {
    this.ctx = ctx;
    const registrations: Array<{ dispose: () => Promise<void> }> = [];
    try {
      registrations.push(
        await ctx.session.hook('context', c =>
          this.safe('context', () => this.onContext(c))
        )
      );
      registrations.push(
        await ctx.tool.hook('execute.before', e =>
          this.safe('tool.execute.before', () => this.onToolExecuteBeforeV2(e))
        )
      );
      registrations.push(
        await ctx.tool.hook('execute.after', e =>
          this.safe('tool.execute.after', () => this.onToolExecuteAfterV2(e))
        )
      );
    } catch (error) {
      await this.disposeRegistrations(registrations);
      logWarning('Failed to register plugin hooks', error);
    }
    return async () => {
      await this.disposeRegistrations(registrations);
    };
  }

  /** Dispose every registration, logging (never propagating) any rejection. */
  private async disposeRegistrations(
    registrations: Array<{ dispose: () => Promise<void> }>
  ): Promise<void> {
    const results = await Promise.allSettled(
      registrations.map(r => r.dispose())
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        logWarning('Failed to dispose plugin hook registration', result.reason);
      }
    }
  }

  /** Log-and-swallow wrapper: hook handlers must never throw (except RuleBlockError). */
  private async safe(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      if (error instanceof RuleBlockError) {
        throw error;
      }
      logWarning(`Hook handler failed: ${label}`, error);
    }
  }

  private async onContext(ctx: V2SessionContext): Promise<void> {
    const sessionID = ctx.sessionID;

    // 1. Capture model/agent on every dispatch
    this.sessionStore.upsert(sessionID, state => {
      if (ctx.model?.id) {
        state.lastModelID = ctx.model.id;
      }
      if (ctx.agent) {
        state.lastAgentType = ctx.agent;
      }
    });

    // 2. Resolve the project directory for this session
    const directory = await this.resolveDirectory(sessionID);

    // 3. Adapt V2 messages once, shared by seeding and prompt capture
    const v1Messages = toV1Messages(ctx.messages ?? []);

    // 4. Seed context paths + prompt from history once per session
    const existingState = this.sessionStore.get(sessionID);
    if (!existingState?.seededFromHistory) {
      const contextPaths = extractFilePathsFromMessages(
        filterValidMessages(v1Messages)
      );
      const userPrompt = extractLatestUserPrompt(v1Messages);

      this.sessionStore.upsert(sessionID, state => {
        for (const p of contextPaths) {
          state.contextPaths.add(normalizeContextPath(p, directory));
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
    }

    // 5. Per-turn prompt capture (replaces chat.message): new prompt resets the dedupe gate
    const latestPrompt = extractLatestUserPrompt(v1Messages);
    // SessionStore.get returns a LIVE reference: the upsert below mutates this
    // same object in place, so the step-8 `currentState?.rulesInjected` read
    // observes the reset. A copy-on-write store refactor would break the
    // re-injection gate unless this is re-read after the upsert.
    const currentState = this.sessionStore.get(sessionID);
    if (latestPrompt && latestPrompt !== currentState?.lastUserPrompt) {
      this.sessionStore.upsert(sessionID, state => {
        state.lastUserPrompt = latestPrompt;
        state.rulesInjected = false;
      });
      this.debugLog(`New user prompt captured for session ${sessionID}`);
    }

    // 6. Compaction-window gate (session-store logic unchanged; flag is never set in V2,
    //    so this is defensive and always passes)
    const skip = this.sessionStore.shouldSkipInjection(
      sessionID,
      this.now(),
      30_000
    );
    if (skip) {
      this.debugLog(
        `Session ${sessionID} is compacting - skipping rule injection`
      );
      return;
    }

    // 7. Flush pending hook injections (always — not gated by rulesInjected)
    let hookInjectionsText: string | undefined;
    const sessionState = this.sessionStore.get(sessionID);
    if (
      sessionState?.pendingHookInjections &&
      sessionState.pendingHookInjections.length > 0
    ) {
      const uniqueInjections = [...new Set(sessionState.pendingHookInjections)];
      hookInjectionsText = uniqueInjections.join('\n\n---\n\n');
      this.sessionStore.upsert(sessionID, state => {
        state.pendingHookInjections = [];
      });
      this.debugLog(
        `Flushing ${uniqueInjections.length} pending hook injection(s) for session ${sessionID}`
      );
    }

    // 8. Static rules, gated by rulesInjected
    let formattedRules: string | undefined;
    if (!currentState?.rulesInjected) {
      const ruleFiles = await this.combinedRules(directory);
      const contextPaths = currentState
        ? Array.from(currentState.contextPaths).sort((a, b) =>
            a.localeCompare(b)
          )
        : [];

      const availableToolIDs = expandToolKeys(Object.keys(ctx.tools ?? {}));

      const filterContext = await buildFilterContext({
        contextFilePaths: contextPaths,
        userPrompt: currentState?.lastUserPrompt,
        availableToolIDs,
        modelID: currentState?.lastModelID,
        agentType: currentState?.lastAgentType,
        projectDirectory: directory,
        debugLog: this.debugLog,
      });

      const result = await readAndFormatRules(ruleFiles, filterContext);
      formattedRules = result.formattedRules;
      await writeActiveRulesState(sessionID, result.matchedPaths);
    } else {
      this.debugLog(
        `Session ${sessionID} already has rules injected - skipping static rule injection`
      );
    }

    // 9. Append combined content as one SystemPart
    const systemParts: string[] = [];
    if (hookInjectionsText) {
      systemParts.push(hookInjectionsText);
    }
    if (formattedRules) {
      systemParts.push(formattedRules);
    }
    if (systemParts.length === 0) {
      this.debugLog(
        'No applicable rules or hook injections for current context'
      );
      return;
    }

    ctx.system.push({ type: 'text', text: systemParts.join('\n\n---\n\n') });
    this.sessionStore.upsert(sessionID, state => {
      state.rulesInjected = true;
      state.lastInjectedAt = this.now();
    });
    this.debugLog('Injected rules into system prompt');
  }

  private async onToolExecuteBeforeV2(e: V2ToolExecuteBefore): Promise<void> {
    const sessionID = e?.sessionID;
    const toolName = e?.tool;
    const args = isRecord(e?.input) ? e.input : undefined;
    if (!sessionID || !toolName || !args) {
      return;
    }

    const directory = await this.resolveDirectory(sessionID);

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
      const normalized = normalizeContextPath(filePath, directory);
      this.sessionStore.upsert(sessionID, state => {
        state.contextPaths.add(normalized);
      });
      this.debugLog(
        `Recorded context path from tool ${toolName}: ${normalized}`
      );
    }

    await this.evaluateAndQueueHooks(
      'PreToolUse',
      sessionID,
      toolName,
      args,
      await this.combinedRules(directory),
      directory
    );
  }

  private async onToolExecuteAfterV2(e: V2ToolExecuteAfter): Promise<void> {
    const sessionID = e?.sessionID;
    const toolName = e?.tool;
    const args = isRecord(e?.input) ? e.input : undefined;
    if (!sessionID || !toolName || !args) {
      return;
    }

    const directory = await this.resolveDirectory(sessionID);
    await this.evaluateAndQueueHooks(
      'PostToolUse',
      sessionID,
      toolName,
      args,
      await this.combinedRules(directory),
      directory
    );
  }

  private async resolveDirectory(sessionID: string): Promise<string> {
    const cached = this.directoryCache.get(sessionID);
    if (cached && this.now() - cached.at < this.directoryTTL) {
      return cached.directory;
    }

    const failed = this.directoryFailCache.get(sessionID);
    if (failed && this.now() - failed.at < this.failedDirectoryTTL) {
      return process.cwd();
    }

    try {
      const info = this.ctx
        ? await this.ctx.session.get({ sessionID })
        : undefined;
      const directory = info?.location?.directory;
      if (directory) {
        this.directoryCache.set(sessionID, { directory, at: this.now() });
        this.debugLog(
          `Resolved directory for session ${sessionID}: ${directory}`
        );
        return directory;
      }
      this.directoryFailCache.set(sessionID, { at: this.now() });
      return process.cwd();
    } catch (error) {
      logWarning(`Failed to resolve directory for session ${sessionID}`, error);
      this.directoryFailCache.set(sessionID, { at: this.now() });
      return process.cwd();
    }
  }

  private async combinedRules(directory: string): Promise<DiscoveredRule[]> {
    return [
      ...this.globalRules,
      ...(await this.resolveProjectRules(directory)),
    ];
  }

  private async resolveProjectRules(
    directory: string
  ): Promise<DiscoveredRule[]> {
    const cached = this.projectRulesCache.get(directory);
    if (cached) {
      return cached;
    }

    const emptyAt = this.projectRulesEmptyAt.get(directory);
    if (
      emptyAt !== undefined &&
      this.now() - emptyAt < this.emptyProjectRulesTTL
    ) {
      return [];
    }

    const inFlight = this.projectRulesInFlight.get(directory);
    if (inFlight) {
      return inFlight;
    }

    const promise = discoverProjectRuleFiles(directory).then(files => {
      this.projectRulesInFlight.delete(directory);
      if (files.length === 0) {
        this.projectRulesEmptyAt.set(directory, this.now());
      } else {
        this.projectRulesCache.set(directory, files);
      }
      return files;
    });
    this.projectRulesInFlight.set(directory, promise);
    return promise;
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

    await this.evaluateAndQueueHooks(
      'PreToolUse',
      sessionID,
      toolName,
      args,
      this.ruleFiles,
      this.projectDirectory
    );
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

    await this.evaluateAndQueueHooks(
      'PostToolUse',
      sessionID,
      toolName,
      args,
      this.ruleFiles,
      this.projectDirectory
    );
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
      filterValidMessages(output.messages)
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
    input: ChatMessageInput,
    output: ChatMessageOutput
  ): Promise<void> {
    updateSessionFromChatMessage(
      input,
      output,
      this.sessionStore,
      this.debugLog
    );
  }

  private async onSystemTransform(
    hookInput: SystemTransformInput,
    output: SystemTransformOutput | null
  ): Promise<SystemTransformOutput> {
    const sessionID = hookInput?.sessionID;
    const sessionState = sessionID
      ? this.sessionStore.get(sessionID)
      : undefined;

    // 1. Check compaction gate (must happen before flushing hook injections —
    //    otherwise injections cleared during a compacting window are silently lost).
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

    // 2. Flush pending hook injections (always — even when rulesInjected is true).
    //    Hook-triggered content bypasses the static rulesInjected deduplication gate.
    //    Flushing here (after compaction check) ensures injections are never silently
    //    dropped: if compaction was active, they remain queued for the next turn.
    let hookInjectionsText: string | undefined;
    if (
      sessionID &&
      sessionState?.pendingHookInjections &&
      sessionState.pendingHookInjections.length > 0
    ) {
      const uniqueInjections = [...new Set(sessionState.pendingHookInjections)];
      hookInjectionsText = uniqueInjections.join('\n\n---\n\n');

      this.sessionStore.upsert(sessionID, state => {
        state.pendingHookInjections = [];
      });

      this.debugLog(
        `Flushing ${uniqueInjections.length} pending hook injection(s) for session ${sessionID}`
      );
    }

    // 3. Decide whether to process static rules.
    //    hook injections ALWAYS proceed (flushed above); static rules are gated.
    const skipStaticRules = sessionState?.rulesInjected ?? false;

    let formattedRules: string | undefined;

    if (!skipStaticRules) {
      const contextPaths = sessionState
        ? Array.from(sessionState.contextPaths).sort((a, b) =>
            a.localeCompare(b)
          )
        : [];
      const userPrompt = sessionState?.lastUserPrompt;

      const availableToolIDs = await this.queryAvailableToolIDs();

      const filterContext: RuleFilterContext = await buildFilterContext({
        contextFilePaths: contextPaths,
        userPrompt,
        availableToolIDs,
        modelID: sessionState?.lastModelID,
        agentType: sessionState?.lastAgentType,
        projectDirectory: this.projectDirectory,
        debugLog: this.debugLog,
      });

      const result = await readAndFormatRules(this.ruleFiles, filterContext);
      formattedRules = result.formattedRules;

      if (sessionID) {
        await writeActiveRulesState(sessionID, result.matchedPaths);
      }
    } else {
      this.debugLog(
        `Session ${sessionID} already has rules injected - skipping static rule injection`
      );
    }

    // 4. Build combined system content from hook injections + static rules
    const systemParts: string[] = [];

    if (hookInjectionsText) {
      systemParts.push(hookInjectionsText);
    }

    if (formattedRules) {
      systemParts.push(formattedRules);
    }

    if (systemParts.length === 0) {
      this.debugLog(
        'No applicable rules or hook injections for current context'
      );
      return output ?? {};
    }

    this.debugLog('Injecting rules into system prompt');
    const combinedSystem = systemParts.join('\n\n---\n\n');

    if (!output) {
      if (sessionID) {
        this.sessionStore.upsert(sessionID, state => {
          state.rulesInjected = true;
          state.lastInjectedAt = this.now();
        });
      }
      return { system: combinedSystem };
    }

    if (Array.isArray(output.system)) {
      output.system =
        output.system.join('\n\n') +
        (output.system.length > 0 ? '\n\n' : '') +
        combinedSystem;
    } else {
      output.system = output.system
        ? `${output.system}\n\n${combinedSystem}`
        : combinedSystem;
    }

    if (sessionID) {
      this.sessionStore.upsert(sessionID, state => {
        state.rulesInjected = true;
        state.lastInjectedAt = this.now();
      });
    }

    return output;
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

    const sessionState = this.sessionStore.get(sessionID);
    if (!sessionState || sessionState.contextPaths.size === 0) {
      this.debugLog(
        `No context paths for session ${sessionID} during compaction`
      );
      return;
    }

    this.sessionStore.markCompacting(sessionID, this.now());

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
    sessionID: string,
    cwd: string
  ): Promise<void> {
    try {
      this.debugLog(
        `Executing hook side-effect for session ${sessionID}: ${command}`
      );
      await execAsync(command, { cwd });
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
    args: Record<string, unknown>,
    ruleFiles: DiscoveredRule[],
    cwd: string
  ): Promise<void> {
    const serializedArgs = serializeToolArgs(args);

    // First pass: collect all matched hooks across all rules
    const allMatches: Array<{
      hook: { type: string; run?: string };
      relativePath: string;
      strippedContent: string;
    }> = [];

    for (const { filePath: rulePath, relativePath } of ruleFiles) {
      const cachedRule = await getCachedRule(rulePath);
      if (!cachedRule?.metadata?.hooks) continue;

      const typeFiltered = cachedRule.metadata.hooks.filter(
        h => h.type === hookType
      );
      if (typeFiltered.length === 0) continue;

      const matched = evaluateHooks(typeFiltered, {
        toolName,
        serializedArgs,
        hookType,
      });

      for (const hook of matched) {
        allMatches.push({
          hook,
          relativePath,
          strippedContent: cachedRule.strippedContent,
        });
      }
    }

    if (allMatches.length === 0) return;

    // Check for blockers globally before any queuing or side-effects
    if (hookType === 'PreToolUse') {
      const blocker = allMatches.find(
        m =>
          m.hook.type === 'PreToolUse' && (m.hook as { block?: boolean }).block
      );
      if (blocker) {
        this.debugLog(
          `PreToolUse block fired for rule ${blocker.relativePath}, tool ${toolName}`
        );
        throw new RuleBlockError(
          `[opencode-rules] Blocked by rule "${blocker.relativePath}": ` +
            `tool "${toolName}" matched blocked pattern`
        );
      }
    }

    // No blockers: queue content and run side-effects
    // Deduplicate content per rule (one injection per rule, regardless of how many hooks matched)
    const seenContent = new Set<string>();
    for (const { hook, relativePath, strippedContent } of allMatches) {
      if (!seenContent.has(strippedContent)) {
        seenContent.add(strippedContent);
        this.sessionStore.upsert(sessionID, state => {
          if (!state.pendingHookInjections) {
            state.pendingHookInjections = [];
          }
          state.pendingHookInjections.push(strippedContent);
        });

        this.debugLog(
          `${hookType} hook fired for rule ${relativePath}, tool ${toolName}`
        );
      }

      if (hook.run) {
        await this.executeHookSideEffect(hook.run, sessionID, cwd);
      }
    }
  }
}
