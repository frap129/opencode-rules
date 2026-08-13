import { readAndFormatRules } from './rule-filter.js';
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
  normalizeContextPath,
  filterValidMessages,
} from './message-context.js';
import { createDebugLog, logWarning, type DebugLog } from './debug.js';
import type { SessionStore } from './session-store.js';
import { buildFilterContext } from './runtime-context.js';
import { writeActiveRulesState } from './active-rules-state.js';
import { evaluateHooks, serializeToolArgs } from './rule-hooks.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface OpenCodeRulesRuntimeOptions {
  globalRules: DiscoveredRule[];
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
  private globalRules: DiscoveredRule[];
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
    this.globalRules = opts.globalRules;
    this.sessionStore = opts.sessionStore;
    this.debugLog = opts.debugLog ?? createDebugLog();
    this.now = opts.now ?? (() => Date.now());
    this.directoryTTL = opts.directoryTTL ?? 30_000;
    this.failedDirectoryTTL = opts.failedDirectoryTTL ?? 5_000;
    this.emptyProjectRulesTTL = opts.emptyProjectRulesTTL ?? 60_000;
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
      registrations.length = 0; // Registrations already disposed; keep the returned cleanup a no-op.
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
      const arg = args.path ?? args.filePath;
      if (typeof arg === 'string' && arg.length > 0) {
        filePath = arg;
      }
    } else if (['glob', 'grep'].includes(toolName)) {
      const arg = args.path;
      if (typeof arg === 'string' && arg.length > 0) {
        filePath = arg;
      }
    } else if (toolName === 'bash' || toolName === 'shell') {
      const arg = args.workdir ?? args.cwd;
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
      if (files.length === 0) {
        this.projectRulesEmptyAt.set(directory, this.now());
      } else {
        this.projectRulesCache.set(directory, files);
      }
      return files;
    });
    promise
      .finally(() => this.projectRulesInFlight.delete(directory))
      .catch(() => {});
    this.projectRulesInFlight.set(directory, promise);
    return promise;
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
   * @throws {RuleBlockError} When a PreToolUse hook with block:true matches the tool and arguments. */
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
