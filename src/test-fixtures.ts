/**
 * Shared test fixtures, builders, and helpers for opencode-rules tests.
 * Extracted to reduce duplication and tighten typing across test files.
 */
import path from 'path';
import os from 'os';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import type { DiscoveredRule } from './utils.js';

// ============================================================================
// Test Directory Management
// ============================================================================

export interface TestDirs {
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
// Rule Conversion Helpers
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

export const CI_ENV_VARS = [
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
// Mock Object Builders
// ============================================================================

export interface MockPluginInput {
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
// Message Part Builders
// ============================================================================

export interface TextPart {
  type: 'text';
  text: string;
  sessionID?: string;
  synthetic?: boolean;
}

export interface ToolInvocationPart {
  type: 'tool-invocation';
  toolInvocation: {
    toolName: string;
    args: Record<string, unknown>;
  };
  sessionID?: string;
}

export type MessagePart = TextPart | ToolInvocationPart;

export interface MockMessage {
  role: 'user' | 'assistant';
  parts: MessagePart[];
}

/**
 * Creates a text message part with optional sessionID.
 */
export function textPart(text: string, sessionID?: string): TextPart {
  const part: TextPart = { type: 'text', text };
  if (sessionID) part.sessionID = sessionID;
  return part;
}

/**
 * Creates a tool invocation part for read operations.
 */
export function readToolPart(
  filePath: string,
  sessionID?: string
): ToolInvocationPart {
  const part: ToolInvocationPart = {
    type: 'tool-invocation',
    toolInvocation: { toolName: 'read', args: { filePath } },
  };
  if (sessionID) part.sessionID = sessionID;
  return part;
}

/**
 * Creates a tool invocation part for glob operations.
 */
export function globToolPart(
  pattern: string,
  sessionID?: string
): ToolInvocationPart {
  const part: ToolInvocationPart = {
    type: 'tool-invocation',
    toolInvocation: { toolName: 'glob', args: { pattern } },
  };
  if (sessionID) part.sessionID = sessionID;
  return part;
}

/**
 * Creates a mock message with the given role and parts.
 */
export function mockMessage(
  role: 'user' | 'assistant',
  parts: MessagePart[]
): MockMessage {
  return { role, parts };
}

// ============================================================================
// Rule File Helpers
// ============================================================================

/**
 * Writes a rule file with optional YAML frontmatter.
 */
export function writeRuleFile(
  dir: string,
  filename: string,
  content: string,
  metadata?: Record<string, unknown>
): string {
  const filePath = path.join(dir, filename);
  let fileContent = content;

  if (metadata && Object.keys(metadata).length > 0) {
    const yamlLines = ['---'];
    for (const [key, value] of Object.entries(metadata)) {
      if (Array.isArray(value)) {
        yamlLines.push(`${key}:`);
        for (const item of value) {
          yamlLines.push(`  - "${item}"`);
        }
      } else if (typeof value === 'boolean') {
        yamlLines.push(`${key}: ${value}`);
      } else {
        yamlLines.push(`${key}: ${value}`);
      }
    }
    yamlLines.push('---', '', content);
    fileContent = yamlLines.join('\n');
  }

  writeFileSync(filePath, fileContent);
  return filePath;
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
