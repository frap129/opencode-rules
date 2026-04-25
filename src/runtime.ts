import { readAndFormatRules, type RuleFilterContext } from './rule-filter.js';
import { extractFilePathsFromMessages } from './message-paths.js';
import { type DiscoveredRule, getCachedRule } from './rule-discovery.js';
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
import { evaluateHooks, serializeToolArgs } from './rule-hooks.js';
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

    // Evaluate PreToolUse hooks
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
    if (existingState && existingState.seededFromHistory) {
      this.debugLog(`Session ${sessionID} already seeded, skipping rescan`);
      return output;
    }

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

  private async onChatMessage(
    input: ChatMessageInput,
    output: ChatMessageOutput
  ): Promise<void> {
    handleChatMessage(input, output, this.sessionStore, this.debugLog);
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

      const filterContextOpts: BuildFilterContextOptions = {
        contextFilePaths: contextPaths,
        userPrompt,
        availableToolIDs,
        modelID: sessionState?.lastModelID,
        agentType: sessionState?.lastAgentType,
      };

      const filterContext: RuleFilterContext = await buildFilterContext(
        filterContextOpts,
        this.projectDirectory,
        this.debugLog
      );

      const result = await readAndFormatRules(this.ruleFiles, filterContext);
      formattedRules = result.formattedRules;

      if (sessionID) {
        writeActiveRulesState(sessionID, result.matchedPaths);
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
      output.system.push(combinedSystem);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[opencode-rules] Warning: Hook side-effect failed: ${message}`
      );
    }
  }

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
