import { evaluateHooks, serializeToolArgs } from '../rules/rule-hooks.js';
import {
  matchRuleSnapshots,
  type RuleMatchContext,
} from '../rules/rule-filter.js';
import type { RuleSnapshot } from '../rules/rule-discovery.js';
import { logWarning, type DebugLog } from '../shared/debug.js';
import type {
  MatchedHookContent,
  MatchedHooksInput,
} from '../delivery/rule-delivery.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class ToolHookFlow {
  private readonly debugLog: DebugLog;
  private readonly projectDirectory: string;
  private readonly ensureSessionRuleSnapshot: (
    sessionID: string
  ) => Promise<RuleSnapshot[]>;
  private readonly buildMatchContext: (
    sessionID: string
  ) => Promise<RuleMatchContext>;
  private readonly queueMatchedHooks: (input: MatchedHooksInput) => void;

  constructor(options: {
    debugLog: DebugLog;
    projectDirectory: string;
    ensureSessionRuleSnapshot: (sessionID: string) => Promise<RuleSnapshot[]>;
    buildMatchContext: (sessionID: string) => Promise<RuleMatchContext>;
    queueMatchedHooks: (input: MatchedHooksInput) => void;
  }) {
    this.debugLog = options.debugLog;
    this.projectDirectory = options.projectDirectory;
    this.ensureSessionRuleSnapshot = options.ensureSessionRuleSnapshot;
    this.buildMatchContext = options.buildMatchContext;
    this.queueMatchedHooks = options.queueMatchedHooks;
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

  /** @throws when a blocking PreToolUse hook matches. */
  async evaluateAndQueueHooks(
    hookType: 'PreToolUse' | 'PostToolUse',
    sessionID: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<void> {
    const serializedArgs = serializeToolArgs(args);

    const snapshots = await this.ensureSessionRuleSnapshot(sessionID);

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

    // The context queries (tool RPCs, project tags, git branch) are the
    // expensive part of this path; skip them when nothing matched.
    const matchContext = await this.buildMatchContext(sessionID);

    // A blocker must fire before any side-effect runs.
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

    // Queue each rule once no matter how many of its hooks matched.
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
      this.queueMatchedHooks({
        sessionID,
        hooks: matchedHooks,
      });
    }
  }
}
