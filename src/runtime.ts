import {
  readAndFormatRules,
  extractFilePathsFromMessages,
  type DiscoveredRule,
  type RuleFilterContext,
} from './utils.js';
import {
  extractLatestUserPrompt,
  extractSessionID,
  extractSlashCommand,
  normalizeContextPath,
  sanitizePathForContext,
  toExtractableMessages,
  type MessageWithInfo,
} from './message-context.js';
import { extractConnectedMcpCapabilityIDs } from './mcp-tools.js';
import {
  createDebugLog,
  createWarnLog,
  type DebugLog,
  type WarnLog,
} from './debug.js';
import type { SessionStore } from './session-store.js';
import { detectProjectTags } from './project-fingerprint.js';
import { getGitBranch } from './git-branch.js';

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
  warnLog?: WarnLog;
  now?: () => number;
}

export class OpenCodeRulesRuntime {
  private client: unknown;
  private directory: string;
  private projectDirectory: string;
  private ruleFiles: DiscoveredRule[];
  private sessionStore: SessionStore;
  private debugLog: DebugLog;
  private warnLog: WarnLog;
  private now: () => number;

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.client = opts.client;
    this.directory = opts.directory;
    this.projectDirectory = opts.projectDirectory;
    this.ruleFiles = opts.ruleFiles;
    this.sessionStore = opts.sessionStore;
    this.debugLog = opts.debugLog ?? createDebugLog();
    this.warnLog = opts.warnLog ?? createWarnLog();
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
    input: { sessionID?: string; model?: { modelID?: string }; agent?: string },
    output: {
      message?: { role?: string };
      parts?: Array<{ type?: string; text?: string; synthetic?: boolean }>;
    }
  ): Promise<void> {
    const sessionID = input?.sessionID;
    if (!sessionID) {
      this.debugLog('No sessionID in chat.message hook input');
      return;
    }

    if (output?.message?.role !== 'user') {
      return;
    }

    const textParts: string[] = [];
    if (output.parts) {
      for (const part of output.parts) {
        if (part.synthetic) continue;

        if (part.type === 'text' && part.text) {
          textParts.push(part.text);
        } else if (typeof part.text === 'string' && !part.type) {
          textParts.push(part.text);
        }
      }
    }

    this.sessionStore.upsert(sessionID, state => {
      if (textParts.length > 0) {
        const userPrompt = textParts
          .map(t => t.trim())
          .filter(Boolean)
          .join(' ')
          .trim();

        if (userPrompt) {
          state.lastUserPrompt = userPrompt;
        }
      }

      if (input.model?.modelID) {
        state.lastModelID = input.model.modelID;
      }
      if (input.agent) {
        state.lastAgentType = input.agent;
      }
    });

    this.debugLog(
      `Updated session ${sessionID} from chat.message (model=${input.model?.modelID ?? 'none'}, agent=${input.agent ?? 'none'})`
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

    const contextPaths = sessionState
      ? Array.from(sessionState.contextPaths).sort((a, b) => a.localeCompare(b))
      : [];
    const userPrompt = sessionState?.lastUserPrompt;

    const availableToolIDs = await this.queryAvailableToolIDs();

    const filterContext = await this.buildFilterContext({
      contextFilePaths: contextPaths,
      userPrompt,
      availableToolIDs,
      modelID: sessionState?.lastModelID,
      agentType: sessionState?.lastAgentType,
    });

    const formattedRules = await readAndFormatRules(
      this.ruleFiles,
      filterContext
    );

    if (!formattedRules) {
      this.debugLog('No applicable rules for current context');
      return output ?? {};
    }

    this.debugLog('Injecting rules into system prompt');

    if (!output) {
      return { system: formattedRules };
    }

    if (Array.isArray(output.system)) {
      output.system.push(formattedRules);
      return output;
    }

    output.system = output.system
      ? `${output.system}\n\n${formattedRules}`
      : formattedRules;

    return output;
  }

  private async buildFilterContext(opts: {
    contextFilePaths: string[];
    userPrompt: string | undefined;
    availableToolIDs: string[];
    modelID: string | undefined;
    agentType: string | undefined;
  }): Promise<RuleFilterContext> {
    const {
      contextFilePaths,
      userPrompt,
      availableToolIDs,
      modelID,
      agentType,
    } = opts;

    const command = extractSlashCommand(userPrompt);

    let projectTags: string[] | undefined;
    try {
      projectTags = await detectProjectTags(this.projectDirectory);
      if (projectTags.length === 0) {
        projectTags = undefined;
      }
    } catch {
      projectTags = undefined;
    }

    let gitBranch: string | undefined;
    try {
      gitBranch = await getGitBranch(this.projectDirectory);
    } catch {
      gitBranch = undefined;
    }

    const os = process.platform;
    const ci = detectCiEnvironment();

    const context: RuleFilterContext = {
      os,
      ci,
    };

    if (contextFilePaths.length > 0) {
      context.contextFilePaths = contextFilePaths;
    }
    if (userPrompt !== undefined) {
      context.userPrompt = userPrompt;
    }
    if (availableToolIDs.length > 0) {
      context.availableToolIDs = availableToolIDs;
    }
    if (modelID !== undefined) {
      context.modelID = modelID;
    }
    if (agentType !== undefined) {
      context.agentType = agentType;
    }
    if (command !== undefined) {
      context.command = command;
    }
    if (projectTags !== undefined) {
      context.projectTags = projectTags;
    }
    if (gitBranch !== undefined) {
      context.gitBranch = gitBranch;
    }

    this.debugLog(
      `Filter context: model=${modelID ?? 'none'}, agent=${agentType ?? 'none'}, ` +
        `command=${command ?? 'none'}, branch=${gitBranch ?? 'none'}, ` +
        `os=${os}, ci=${ci}, projectTags=${projectTags?.join(',') ?? 'none'}`
    );

    return context;
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
      this.warnLog(`Failed to query tool IDs: ${message}`);
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
      this.warnLog(`Failed to query MCP status: ${message}`);
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
}

/**
 * Parse an env variable value semantically: 'false', '0', '' => false; other non-empty => true.
 * Returns undefined if the variable is not set.
 */
function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === '') return false;
  const lower = value.toLowerCase();
  if (lower === 'false' || lower === '0') return false;
  return true;
}

/**
 * Check if a string value represents a truthy CI environment variable.
 * Treats 'false', '0', and empty strings as falsy; other non-empty values as truthy.
 */
function isTruthyEnvValue(value: string | undefined): boolean {
  return parseEnvBoolean(value) === true;
}

/**
 * Detect if running in a CI environment by checking common CI environment variables.
 *
 * If process.env.CI is explicitly set, it is treated as authoritative:
 * - CI='false' or CI='0' or CI='' => return false (no provider var fallback)
 * - CI='true' or CI='1' or any truthy value => return true
 *
 * If process.env.CI is not set (undefined), fall back to provider-specific detection.
 */
function detectCiEnvironment(): boolean {
  const env = process.env;

  // If CI is explicitly set, treat it as authoritative (no fallback to provider vars)
  const ciExplicit = parseEnvBoolean(env.CI);
  if (ciExplicit !== undefined) {
    return ciExplicit;
  }

  // CI not set - fall back to provider-specific env vars
  return (
    isTruthyEnvValue(env.CONTINUOUS_INTEGRATION) ||
    isTruthyEnvValue(env.BUILD_NUMBER) ||
    isTruthyEnvValue(env.GITHUB_ACTIONS) ||
    isTruthyEnvValue(env.GITLAB_CI) ||
    isTruthyEnvValue(env.CIRCLECI) ||
    isTruthyEnvValue(env.TRAVIS) ||
    isTruthyEnvValue(env.JENKINS_URL) ||
    isTruthyEnvValue(env.BUILDKITE) ||
    isTruthyEnvValue(env.TEAMCITY_VERSION)
  );
}
