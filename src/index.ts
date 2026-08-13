/**
 * OpenCode Rules Plugin (OpenCode v2)
 *
 * Discovers markdown rule files and injects them into the system prompt
 * through the session context hook.
 */

import { Plugin } from '@opencode-ai/plugin';
import { discoverRuleFiles } from './utils.js';
import { OpenCodeRulesRuntime } from './runtime.js';
import { SessionStore, type SessionState } from './session-store.js';
import { createDebugLog, logWarning } from './debug.js';
import type { V2PluginContext } from './v2-types.js';

const sessionStore = new SessionStore();
const debugLog = createDebugLog();

const id = 'opencode-rules' as const;

export default Plugin.define({
  id,
  async setup(ctx: Plugin.Context) {
    try {
      const globalRules = await discoverRuleFiles();
      debugLog(`Discovered ${globalRules.length} global rule file(s)`);

      const runtime = new OpenCodeRulesRuntime({
        globalRules,
        sessionStore,
        debugLog,
      });

      return await runtime.registerHooks(ctx as unknown as V2PluginContext);
    } catch (error) {
      logWarning('Plugin setup failed', error);
      return undefined;
    }
  },
});

/**
 * Test-only exports for accessing internal state and functions.
 * @internal - Test utilities only. Not part of public API.
 */
// NOTE: The v2 plugin loader reads only the default export; named exports
// are ignored, so __testOnly is safe to keep as a plain named export.
const __testOnly = Object.freeze(
  Object.assign(async () => ({}), {
    setSessionStateLimit: (limit: number): void => {
      sessionStore.setMax(limit);
    },
    getSessionStateIDs: (): string[] => sessionStore.ids(),
    getSessionStateSnapshot: (sessionID: string): SessionState | undefined =>
      sessionStore.snapshot(sessionID),
    upsertSessionState: (
      sessionID: string,
      mutator: (state: SessionState) => void
    ): void => {
      sessionStore.upsert(sessionID, mutator);
    },
    resetSessionState: (): void => {
      sessionStore.reset();
    },
    getSeedCount: (sessionID: string): number =>
      sessionStore.get(sessionID)?.seedCount ?? 0,
    getSessionStore: (): SessionStore => sessionStore,
  })
);

export { __testOnly };
