import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { __testOnly } from './index.js';
import type { MatchedRulesStateStore } from './session/matched-rules-state.js';

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

// Injecting the store keeps tests off the real ~/.opencode state directory.
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

export type EnvSnapshot = Map<string, string | undefined>;

export function saveEnv(...keys: string[]): EnvSnapshot {
  const saved: EnvSnapshot = new Map();
  for (const key of keys) {
    // Map.set preserves the undefined value, distinguishing it from absent.
    saved.set(key, process.env[key]);
  }
  return saved;
}

export function restoreEnv(saved: EnvSnapshot): void {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
