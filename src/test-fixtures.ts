/**
 * Shared test fixtures, builders, and helpers for opencode-rules tests.
 * Extracted to reduce duplication and tighten typing across test files.
 */
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { __testOnly } from './index.js';
import type { MatchedRulesStateStore } from './matched-rules-state.js';

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
// Mock Plugin Input Helpers
// ============================================================================

interface MockPluginInput {
  testDir: string;
  toolIds?: string[];
  mcpStatus?: Record<string, { status: string }>;
  history?: Array<{ info?: unknown; parts?: unknown[] }>;
  sessionPrompt?: (args: {
    path: { id: string };
    query?: { directory?: string };
    body: {
      messageID?: string;
      noReply?: boolean;
      parts: Array<Record<string, unknown>>;
    };
  }) => Promise<unknown>;
}

/**
 * Creates a typed mock input object for the plugin function.
 */
export function createMockPluginInput(opts: MockPluginInput): {
  client: {
    tool: { ids: () => Promise<{ data: string[] }> };
    mcp?: {
      status: () => Promise<{ data: Record<string, { status: string }> }>;
    };
    session: {
      messages: () => Promise<{
        data: Array<{ info?: unknown; parts?: unknown[] }>;
      }>;
    };
  };
  project: Record<string, unknown>;
  directory: string;
  worktree: string;
  $: Record<string, unknown>;
  serverUrl: URL;
} {
  const client: {
    tool: { ids: () => Promise<{ data: string[] }> };
    mcp?: {
      status: () => Promise<{ data: Record<string, { status: string }> }>;
    };
    session: {
      messages: () => Promise<{
        data: Array<{ info?: unknown; parts?: unknown[] }>;
      }>;
    };
  } = {
    tool: { ids: async () => ({ data: opts.toolIds ?? [] }) },
    session: {
      messages: async () => ({ data: opts.history ?? [] }),
      ...(opts.sessionPrompt ? { prompt: opts.sessionPrompt } : {}),
    },
  };

  if (opts.mcpStatus) {
    client.mcp = {
      status: async () => ({ data: opts.mcpStatus! }),
    };
  }

  return {
    client,
    project: {},
    directory: opts.testDir,
    worktree: opts.testDir,
    $: {},
    serverUrl: new URL('http://localhost:3000'),
  };
}

// ============================================================================
// Shared Plugin-Runtime Test Seam
// ============================================================================

/**
 * Creates plugin hooks with an injected matched-rules state store so tests
 * never touch the real ~/.opencode state directory. Accepts a pre-built mock
 * input so tests can pass a custom `sessionPrompt` spy.
 */
export function createHooksWithStore(
  mockInput: ReturnType<typeof createMockPluginInput>,
  store: MatchedRulesStateStore
): ReturnType<typeof __testOnly.createHooksWithMatchedRulesStateStore> {
  return __testOnly.createHooksWithMatchedRulesStateStore(
    mockInput as unknown as Parameters<
      typeof __testOnly.createHooksWithMatchedRulesStateStore
    >[0],
    store
  );
}

export type HookChatMessage = (
  input: { sessionID: string; messageID?: string },
  output: HookChatOutput
) => Promise<void>;

export type HookChatOutput = {
  message: {
    role: string;
    id?: string;
    agent?: string;
    model?: { modelID?: string };
  };
  parts: Array<{
    id?: string;
    type?: string;
    text?: string;
    synthetic?: boolean;
    sessionID?: string;
    messageID?: string;
  }>;
};

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
