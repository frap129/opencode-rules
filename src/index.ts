import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import { discoverRuleFiles } from './rules/rule-discovery.js';
import { OpenCodeRulesRuntime } from './runtime/orchestrator.js';
import { SessionStore, type SessionState } from './session/session-store.js';
import { MatchedRulesStateStore } from './session/matched-rules-state.js';

const sessionStore = new SessionStore();
const matchedRulesStateStore = new MatchedRulesStateStore();
import { createDebugLog } from './shared/debug.js';

const debugLog = createDebugLog();

async function createRuntimeHooks(
  pluginInput: PluginInput,
  runtimeSessionStore: SessionStore,
  runtimeMatchedRulesStateStore: MatchedRulesStateStore
) {
  const ruleFiles = await discoverRuleFiles(pluginInput.directory);
  debugLog(`Discovered ${ruleFiles.length} rule file(s)`);

  const runtime = new OpenCodeRulesRuntime({
    client: pluginInput.client,
    directory: pluginInput.directory,
    projectDirectory: pluginInput.directory,
    ruleFiles,
    sessionStore: runtimeSessionStore,
    matchedRulesStateStore: runtimeMatchedRulesStateStore,
    debugLog,
  });

  return runtime.createHooks();
}

const openCodeRulesPlugin = async (pluginInput: PluginInput) => {
  return createRuntimeHooks(pluginInput, sessionStore, matchedRulesStateStore);
};

// NOTE: OpenCode's plugin loader calls every named export as a plugin
// initializer, so __testOnly must be callable.
const __testOnly = Object.freeze(
  Object.assign(async () => ({}), {
    setSessionStateLimit: (limit: number): void => {
      sessionStore.setMax(limit);
    },
    getSessionStateIDs: (): string[] => {
      return sessionStore.ids();
    },
    getSessionStateSnapshot: (sessionID: string): SessionState | undefined => {
      return sessionStore.snapshot(sessionID);
    },
    upsertSessionState: (
      sessionID: string,
      mutator: (state: SessionState) => void
    ): void => {
      sessionStore.upsert(sessionID, mutator);
    },
    resetSessionState: (): void => {
      sessionStore.reset();
    },
    createHooksWithMatchedRulesStateStore: (
      pluginInput: PluginInput,
      store: MatchedRulesStateStore
    ) => createRuntimeHooks(pluginInput, sessionStore, store),
  })
);

const id = 'opencode-rules' as const;
const server = openCodeRulesPlugin satisfies Plugin;
export default { id, server };
export { __testOnly };
