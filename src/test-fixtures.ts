/**
 * Shared test fixtures, builders, and helpers for opencode-rules tests.
 * Extracted to reduce duplication and tighten typing across test files.
 */
import path from 'path';
import os from 'os';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import type { DiscoveredRule } from './utils.js';

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
// Environment Snapshot Helpers
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
// Environment Snapshot Helpers
// ============================================================================

interface MockPluginInput {
  testDir: string;
  toolIds?: string[];
  mcpStatus?: Record<string, { status: string }>;
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
  } = {
    tool: { ids: async () => ({ data: opts.toolIds ?? [] }) },
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
// Environment Snapshot Helpers
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
