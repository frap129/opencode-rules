import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRuntime } from './runtime/create-runtime.js';
import type { OpenCodeRulesRuntime } from './runtime/orchestrator.js';
import type {
  V2SessionContextInput,
  V2SessionPromptInput,
  V2ToolExecuteAfterInput,
  V2ToolExecuteBeforeInput,
} from './runtime/orchestrator.js';
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

export interface SyntheticCall {
  sessionID: string;
  id: string;
  text: string;
  description?: string;
  metadata?: Record<string, unknown>;
  resume?: boolean;
}

export interface MockPluginInput {
  testDir: string;
  /** v2 mcp.list() shape: McpServer[] tagged by status. */
  mcpServers?: Array<{ name: string; status: string }>;
  /** Session history returned by client.session.context(). */
  history?: unknown[];
  /** Session context implementation; defaults to returning opts.history. */
  sessionContext?: (input: { sessionID: string }) => Promise<unknown>;
  /** Retired admission channel; tests assert this stays empty. */
  promptCalls?: Array<{
    sessionID: string;
    id?: string;
    text: string;
    metadata?: Record<string, unknown>;
    resume?: boolean;
  }>;
  /** Durable synthetic deliveries; captures calls to session.synthetic. */
  syntheticCalls?: SyntheticCall[];
  /**
   * Events drained by the runtime's event loop; use pushEvent (or seed
   * before wire) to inject v2 events through the real subscription path.
   */
  events?: MockEvent[];
}

export interface MockEvent {
  type?: string;
  data?: { sessionID?: unknown };
}

export interface HookRecorders {
  toolBefore: Array<(input: V2ToolExecuteBeforeInput) => Promise<void> | void>;
  toolAfter: Array<(input: V2ToolExecuteAfterInput) => Promise<void> | void>;
  sessionContext: Array<(input: V2SessionContextInput) => Promise<void> | void>;
  sessionPrompt: Array<(input: V2SessionPromptInput) => Promise<void> | void>;
}

export interface MockPluginContext {
  location: { directory: string };
  tool: {
    hook: (
      name: 'execute.before' | 'execute.after',
      handler: (input: never) => Promise<void> | void
    ) => Promise<{ dispose(): Promise<void> }>;
  };
  session: {
    hook: (
      name: 'context' | 'prompt',
      handler: (input: never) => Promise<void> | void
    ) => Promise<{ dispose(): Promise<void> }>;
    synthetic?: (input: SyntheticCall) => Promise<unknown>;
    /** Client surface (v2 context IS the client): session.context() history. */
    context?: (input: { sessionID: string }) => Promise<unknown>;
    /** Retired admission channel; tests assert this stays empty. */
    prompt?: (input: {
      sessionID: string;
      id?: string;
      text: string;
      metadata?: Record<string, unknown>;
      resume?: boolean;
    }) => Promise<unknown>;
  };
  event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<unknown>;
  };
  mcp: {
    list(input?: {
      location?: { directory?: string };
    }): Promise<{ data?: unknown }>;
  };
}

/**
 * Builds a mock v2 plugin context (the context IS the client in v2) that
 * records every registered hook so tests invoke handlers directly.
 */
export function createMockPluginInput(opts: MockPluginInput): {
  context: MockPluginContext;
  hooks: HookRecorders;
  syntheticCalls: NonNullable<MockPluginInput['syntheticCalls']>;
  promptCalls: NonNullable<MockPluginInput['promptCalls']>;
  /** Delivers an event to the wired runtime's event loop. */
  pushEvent: (event: MockEvent) => void;
} {
  const hooks: HookRecorders = {
    toolBefore: [],
    toolAfter: [],
    sessionContext: [],
    sessionPrompt: [],
  };
  const syntheticCalls: NonNullable<MockPluginInput['syntheticCalls']> =
    opts.syntheticCalls ?? [];
  const promptCalls: NonNullable<MockPluginInput['promptCalls']> =
    opts.promptCalls ?? [];
  opts.syntheticCalls = syntheticCalls;
  opts.promptCalls = promptCalls;

  const events: MockEvent[] = opts.events ?? [];
  opts.events = events;
  let wakeEventLoop: (() => void) | undefined;
  const waitForEvent = (): Promise<void> =>
    new Promise(resolve => {
      wakeEventLoop = resolve;
    });
  const pushEvent = (event: MockEvent): void => {
    events.push(event);
    wakeEventLoop?.();
    wakeEventLoop = undefined;
  };

  const context: MockPluginContext = {
    location: { directory: opts.testDir },
    tool: {
      hook: async (name, handler) => {
        if (name === 'execute.before') {
          hooks.toolBefore.push(handler as never);
        } else if (name === 'execute.after') {
          hooks.toolAfter.push(handler as never);
        }
        return { dispose: async () => undefined };
      },
    },
    session: {
      hook: async (name, handler) => {
        if (name === 'context') {
          hooks.sessionContext.push(handler as never);
        } else if (name === 'prompt') {
          hooks.sessionPrompt.push(handler as never);
        }
        return { dispose: async () => undefined };
      },
      synthetic: async input => {
        opts.syntheticCalls?.push(input);
        return { id: input.id };
      },
      // v2 context IS the client: history and admissions ride session.*.
      ...(opts.sessionContext
        ? { context: opts.sessionContext }
        : {
            context: async () => ({ data: opts.history ?? [] }),
          }),
      ...(opts.promptCalls
        ? {
            prompt: async (
              input: NonNullable<MockPluginContextOptions_promptCalls>[number]
            ) => {
              opts.promptCalls?.push(input);
              return { id: input.id ?? 'msg_admitted' };
            },
          }
        : {}),
    },
    event: {
      // Drains opts.events; suspends when empty until pushEvent wakes it,
      // so tests can inject v2 events through the runtime's real event
      // path at any point after wiring.
      async *subscribe() {
        let index = 0;
        while (true) {
          while (index < events.length) {
            yield events[index];
            index++;
          }
          await waitForEvent();
        }
      },
    },
    mcp: {
      list: async () => ({ data: opts.mcpServers ?? [] }),
    },
  };

  return { context, hooks, syntheticCalls, promptCalls, pushEvent };
}

type MockPluginContextOptions_promptCalls = MockPluginInput['promptCalls'];

/** Wires a runtime against a mock context; returns the runtime for state inspection. */
export async function wireRuntime(
  mockInput: ReturnType<typeof createMockPluginInput>,
  store?: MatchedRulesStateStore
): Promise<OpenCodeRulesRuntime> {
  const runtime = await createRuntime({
    client: mockInput.context,
    directory: mockInput.context.location.directory,
    projectDirectory: mockInput.context.location.directory,
    ...(store !== undefined ? { matchedRulesStateStore: store } : {}),
  });
  await runtime.wire(mockInput.context as never);
  return runtime;
}

/** Rule admissions routed through ctx.session.synthetic. */
export function syntheticAdmissions(
  mockInput: ReturnType<typeof createMockPluginInput>
): SyntheticCall[] {
  return mockInput.syntheticCalls.filter(
    call => call.metadata?.ruleAdmission === true
  );
}

/** Joined text of every rule admission captured by a mock context. */
export function admissionText(
  mockInput: ReturnType<typeof createMockPluginInput>
): string {
  return syntheticAdmissions(mockInput)
    .map(call => call.text)
    .join('\n');
}

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
