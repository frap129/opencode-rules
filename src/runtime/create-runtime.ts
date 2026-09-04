// Test seam and runtime factory. The v2 plugin loader imports only the
// default export of src/index.ts, so tests construct the runtime directly
// through this module instead of a named-export workaround (v1's
// __testOnly is retired).

import { discoverRuleFiles } from '../rules/rule-discovery.js';
import { OpenCodeRulesRuntime } from './orchestrator.js';
import { SessionStore } from '../session/session-store.js';
import { MatchedRulesStateStore } from '../session/matched-rules-state.js';
import { createDebugLog, type DebugLog } from '../shared/debug.js';

export interface CreateRuntimeOptions {
  client: unknown;
  directory: string;
  projectDirectory: string;
  ruleFiles?: DiscoveredRuleInput[];
  sessionStore?: SessionStore;
  matchedRulesStateStore?: MatchedRulesStateStore;
  debugLog?: DebugLog;
}

type DiscoveredRuleInput = Awaited<
  ReturnType<typeof discoverRuleFiles>
>[number];

/**
 * Builds the runtime with its own per-plugin stores by default. Tests may
 * inject a SessionStore (state inspection) or a MatchedRulesStateStore
 * pointed at a temp stateDir (sidebar state port).
 */
export async function createRuntime(
  opts: CreateRuntimeOptions
): Promise<OpenCodeRulesRuntime> {
  const debugLog = opts.debugLog ?? createDebugLog();
  const ruleFiles = opts.ruleFiles ?? (await discoverRuleFiles(opts.directory));
  debugLog(`Discovered ${ruleFiles.length} rule file(s)`);
  return new OpenCodeRulesRuntime({
    client: opts.client,
    directory: opts.directory,
    projectDirectory: opts.projectDirectory,
    ruleFiles,
    sessionStore: opts.sessionStore ?? new SessionStore(),
    matchedRulesStateStore:
      opts.matchedRulesStateStore ?? new MatchedRulesStateStore(),
    debugLog,
  });
}
