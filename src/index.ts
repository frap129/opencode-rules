/**
 * OpenCode Rules Plugin
 *
 * Discovers markdown rule files and injects them into the system prompt.
 */

interface LegacyPluginInput {
  client: unknown;
  directory: string;
}
import { discoverRuleFiles } from './utils.js';
import { OpenCodeRulesRuntime } from './runtime.js';
import { SessionStore, type SessionState } from './session-store.js';

const sessionStore = new SessionStore();
import { createDebugLog } from './debug.js';

const debugLog = createDebugLog();

const openCodeRulesPlugin = async (pluginInput: LegacyPluginInput) => {
  const ruleFiles = await discoverRuleFiles(pluginInput.directory);
  debugLog(`Discovered ${ruleFiles.length} rule file(s)`);

  const runtime = new OpenCodeRulesRuntime({
    client: pluginInput.client,
    directory: pluginInput.directory,
    projectDirectory: pluginInput.directory,
    ruleFiles,
    sessionStore,
    debugLog,
  });

  return runtime.createHooks();
};

/**
 * Test-only exports for accessing internal state and functions.
 * @internal - Test utilities only. Not part of public API.
 */
// NOTE: OpenCode's plugin loader calls every named export as a plugin initializer.
// To avoid runtime crashes, __testOnly must be callable.
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
    getSeedCount: (sessionID: string): number => {
      return sessionStore.get(sessionID)?.seedCount ?? 0;
    },
    getSessionStore: (): SessionStore => {
      return sessionStore;
    },
  })
);

const id = 'opencode-rules' as const;
const server = openCodeRulesPlugin;
export default { id, server };
export { __testOnly };
