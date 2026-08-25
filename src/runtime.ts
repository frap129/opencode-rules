import {
  matchRules,
  readAndFormatRules,
  type RuleFilterContext,
  type MatchedRuleEntry,
} from './rule-filter.js';
import { extractFilePathsFromMessages } from './message-paths.js';
import { type DiscoveredRule, getCachedRule } from './rule-discovery.js';
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
  hashContent,
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

interface SystemTransformInput {
  sessionID?: string;
}

interface SystemTransformOutput {
  system?: string | string[];
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
  now?: () => number;
}

export class OpenCodeRulesRuntime {
  private client: OpenCodeClient;
  private directory: string;
  private projectDirectory: string;
  private ruleFiles: DiscoveredRule[];
  private sessionStore: SessionStore;
  private debugLog: DebugLog;
  private now: () => number;

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.client = opts.client as OpenCodeClient;
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
      'tool.execute.after': this.onToolExecuteAfter.bind(this),
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

    return output;
  }

  /** Rebuild injected-part tracking from the message array (history is ground truth). */
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
      if (scan.ruleRelativePaths.size > 0) {
        const matchedPaths = this.ruleFiles
          .filter(rf => scan.ruleRelativePaths.has(rf.relativePath))
          .map(rf => rf.filePath);
        await writeActiveRulesState(sessionID, matchedPaths);
      }
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
      //    persisted history so restarts never duplicate parts.
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
        const contextPaths = Array.from(state.contextPaths).sort((a, b) =>
          a.localeCompare(b)
        );
        const availableToolIDs = await this.queryAvailableToolIDs();

        const filterContext: RuleFilterContext = await buildFilterContext({
          contextFilePaths: contextPaths,
          userPrompt: captured.userPrompt,
          availableToolIDs,
          modelID: captured.modelID,
          agentType: captured.agentType,
          projectDirectory: this.projectDirectory,
          debugLog: this.debugLog,
        });

        matched = await matchRules(this.ruleFiles, filterContext);
      }

      // 5. Append one synthetic part per not-yet-injected rule
      const newParts: SyntheticPart[] = [];
      const newRuleKeys: string[] = [];
      for (const rule of matched) {
        const key = ruleKeyFor(rule.relativePath, rule.strippedContent);
        if (state.injectedRuleKeys.has(key) || newRuleKeys.includes(key)) {
          continue;
        }
        newParts.push(buildRulePart(rule.relativePath, rule.strippedContent));
        newRuleKeys.push(key);
      }

      // 6. Flush queued hook injections as durable parts (content-hash dedup)
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
        newParts.push(buildHookInjectionPart(content));
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
        // Transitional bridge: suppress the legacy system.transform path
        // until it is deleted. Removed together with onSystemTransform.
        s.rulesInjected = true;
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
  ): Promise<InjectedPartsScan | undefined> {
    const fetchHistory = this.client.session?.messages;
    if (!fetchHistory) {
      // Client without the session API (older host or test mock):
      // assume a fresh session with empty history.
      this.debugLog(
        `Client lacks session.messages - assuming empty history for ${sessionID}`
      );
      return {
        ruleKeys: new Set<string>(),
        hookHashes: new Set<string>(),
        ruleRelativePaths: new Set<string>(),
      };
    }
    try {
      const result = await fetchHistory({
        path: { id: sessionID },
        query: { directory: this.directory },
      });
      const messages = (result?.data ?? []) as MessageWithInfo[];
      return scanInjectedParts(messages);
    } catch (error) {
      logWarning('Failed to fetch session history', error);
      return undefined;
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
      // opencode passes this output object to every system-transform hook and
      // ignores hook return values, so mutate the backing array in place;
      // rebinding output.system to a string is discarded by opencode and
      // breaks sibling plugins that call .join() on it.
      const existing = output.system.join('\n\n');
      const consolidated =
        existing.length > 0
          ? `${existing}\n\n${combinedSystem}`
          : combinedSystem;
      output.system.length = 0;
      output.system.push(consolidated);
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

  /** Evaluate hooks for a tool invocation and queue matches.
   * @throws {Error} When a PreToolUse hook with block:true matches the tool and arguments. */
  private async evaluateAndQueueHooks(
    hookType: 'PreToolUse' | 'PostToolUse',
    sessionID: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<void> {
    const serializedArgs = serializeToolArgs(args);

    // First pass: collect all matched hooks across all rules
    const allMatches: Array<{
      hook: { type: string; run?: string };
      relativePath: string;
      strippedContent: string;
    }> = [];

    for (const { filePath: rulePath, relativePath } of this.ruleFiles) {
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
        throw new Error(
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
        await this.executeHookSideEffect(hook.run, sessionID);
      }
    }
  }
}
