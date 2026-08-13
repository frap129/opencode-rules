/**
 * Shared test fixtures, builders, and helpers for opencode-rules tests.
 * Extracted to reduce duplication and tighten typing across test files.
 */
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { DiscoveredRule } from './utils.js';
import type {
  V2PluginContext,
  V2SessionContext,
  V2ToolExecuteAfter,
  V2ToolExecuteBefore,
} from './v2-types.js';
import { OpenCodeRulesRuntime } from './runtime.js';
import { SessionStore } from './session-store.js';
import { __testOnly } from './index.js';
import type { DebugLog } from './debug.js';
import { vi, type Mock } from 'vitest';

// ============================================================================
// Test Directory Management
// ============================================================================

interface TestDirs {
  testDir: string;
  globalRulesDir: string;
  projectRulesDir: string;
}

let currentTestDirs: TestDirs | null = null;

export function setupTestDirs(): TestDirs {
  const testDir = mkdtempSync(path.join(os.tmpdir(), 'opencode-rules-test-'));
  const globalRulesDir = path.join(testDir, '.config', 'opencode', 'rules');
  const projectRulesDir = path.join(testDir, 'project', '.opencode', 'rules');
  mkdirSync(globalRulesDir, { recursive: true });
  mkdirSync(projectRulesDir, { recursive: true });
  currentTestDirs = { testDir, globalRulesDir, projectRulesDir };
  return currentTestDirs;
}

export function teardownTestDirs(): void {
  if (currentTestDirs?.testDir) {
    rmSync(currentTestDirs.testDir, { recursive: true, force: true });
    currentTestDirs = null;
  }
}

export function getTestDirs(): TestDirs {
  if (!currentTestDirs) {
    throw new Error('Test dirs not initialized. Call setupTestDirs() first.');
  }
  return currentTestDirs;
}

// ============================================================================
// Rule Helpers
// ============================================================================

/**
 * Converts file paths to DiscoveredRule objects for testing.
 */
export function toRules(paths: string[]): DiscoveredRule[] {
  return paths.map(filePath => ({
    filePath,
    relativePath: path.basename(filePath),
  }));
}

// ============================================================================
// CI Environment Helpers
// ============================================================================

const CI_ENV_VARS = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'BUILD_NUMBER',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'TRAVIS',
  'JENKINS_URL',
  'BUILDKITE',
  'TEAMCITY_VERSION',
] as const;

export type CiEnvSnapshot = Record<string, string | undefined>;

export function saveCiEnvVars(): CiEnvSnapshot {
  const saved: CiEnvSnapshot = {};
  for (const key of CI_ENV_VARS) {
    saved[key] = process.env[key];
  }
  return saved;
}

export function clearCiEnvVars(): void {
  for (const key of CI_ENV_VARS) {
    delete process.env[key];
  }
}

export function restoreCiEnvVars(saved: CiEnvSnapshot): void {
  for (const key of CI_ENV_VARS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
}

// ============================================================================
// Generic Environment Snapshot Helpers
// ============================================================================

/**
 * Snapshot of environment variables. Uses a symbol marker to distinguish
 * between "key was undefined" vs "key not tracked".
 */
export type EnvSnapshot = Map<string, string | undefined>;

/**
 * Saves the current value of specified environment keys (including undefined).
 * Returns a snapshot that can be passed to restoreEnv() to restore original state.
 */
export function saveEnv(...keys: string[]): EnvSnapshot {
  const saved: EnvSnapshot = new Map();
  for (const key of keys) {
    // Store the value even if undefined - this is crucial for proper restore
    saved.set(key, process.env[key]);
  }
  return saved;
}

/**
 * Restores environment variables to their snapshotted state.
 * Keys that were undefined in the snapshot are deleted from process.env.
 */
export function restoreEnv(saved: EnvSnapshot): void {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ============================================================================
// V2 Plugin Context Helpers
// ============================================================================

/** Creates a mutable V2 session-context payload for the context hook. */
export function createMockSessionContext(
  overrides: Partial<V2SessionContext> = {}
): V2SessionContext {
  return {
    sessionID: 'test-session',
    agent: 'build',
    model: { id: 'claude-opus', providerID: 'anthropic' },
    system: [],
    messages: [],
    tools: {},
    ...overrides,
  };
}

/** Creates a V2 tool.execute.before payload. */
export function createMockToolExecuteBefore(
  overrides: Partial<V2ToolExecuteBefore> = {}
): V2ToolExecuteBefore {
  return {
    tool: 'read',
    sessionID: 'test-session',
    agent: 'build',
    messageID: 'msg-1',
    id: 'call-1',
    input: { filePath: 'src/index.ts' },
    ...overrides,
  };
}

/** Creates a V2 tool.execute.after payload. */
export function createMockToolExecuteAfter(
  overrides: Partial<V2ToolExecuteAfter> = {}
): V2ToolExecuteAfter {
  return {
    tool: 'read',
    sessionID: 'test-session',
    agent: 'build',
    messageID: 'msg-1',
    id: 'call-1',
    input: { filePath: 'src/index.ts' },
    status: 'completed',
    result: { output: {}, metadata: {} },
    ...overrides,
  } as V2ToolExecuteAfter;
}

export interface RuntimeHarness {
  runtime: OpenCodeRulesRuntime;
  ctx: V2PluginContext;
  /** Callbacks captured by the mock hook registrars, keyed by hook name. */
  hookRegistry: {
    context?: (input: V2SessionContext) => Promise<void>;
    'execute.before'?: (input: V2ToolExecuteBefore) => Promise<void>;
    'execute.after'?: (input: V2ToolExecuteAfter) => Promise<void>;
  };
  sessionGet: Mock<
    [],
    Promise<{ location: { directory: string } } | undefined>
  >;
  cleanup: Awaited<ReturnType<OpenCodeRulesRuntime['registerHooks']>>;
}

export interface CreateRuntimeOptions {
  globalRules?: DiscoveredRule[];
  sessionStore?: SessionStore;
  debugLog?: DebugLog;
  now?: () => number;
  /** Directory returned by the mock session.get. Undefined => get returns undefined. */
  sessionDirectory?: string;
}

/** Constructs a runtime and registers it against a mock V2 plugin context. */
export async function createRuntime(
  opts: CreateRuntimeOptions = {}
): Promise<RuntimeHarness> {
  const hookRegistry: RuntimeHarness['hookRegistry'] = {};
  const sessionGet = vi.fn(async () =>
    opts.sessionDirectory
      ? { location: { directory: opts.sessionDirectory } }
      : undefined
  );
  const ctx = {
    session: {
      get: sessionGet,
      hook: vi.fn(
        async (
          name: 'context',
          cb: (input: V2SessionContext) => Promise<void>
        ) => {
          if (name === 'context') hookRegistry.context = cb;
          return { dispose: vi.fn(async () => {}) };
        }
      ),
    },
    tool: {
      hook: vi.fn(
        async (
          name: 'execute.before' | 'execute.after',
          cb: (input: V2ToolExecuteBefore | V2ToolExecuteAfter) => Promise<void>
        ) => {
          if (name === 'execute.before') {
            hookRegistry['execute.before'] = cb as (
              input: V2ToolExecuteBefore
            ) => Promise<void>;
          } else {
            hookRegistry['execute.after'] = cb as (
              input: V2ToolExecuteAfter
            ) => Promise<void>;
          }
          return { dispose: vi.fn(async () => {}) };
        }
      ),
    },
  } as unknown as V2PluginContext;

  const runtime = new OpenCodeRulesRuntime({
    globalRules: opts.globalRules ?? [],
    sessionStore: opts.sessionStore ?? __testOnly.getSessionStore(),
    ...(opts.debugLog !== undefined ? { debugLog: opts.debugLog } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });

  const cleanup = await runtime.registerHooks(ctx);
  return { runtime, ctx, hookRegistry, sessionGet, cleanup };
}

/** Extracts the concatenated text of all text SystemParts. */
export function systemText(
  system: Array<{ type: 'text'; text: string }>
): string {
  return system.map(p => p.text).join('\n\n');
}
