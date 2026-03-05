/**
 * Type-level API surface contract tests.
 *
 * This file uses @ts-expect-error to assert that certain types are NOT exported.
 * If a forbidden type is accidentally re-exported, the @ts-expect-error will
 * become invalid and TypeScript compilation will fail.
 *
 * This file is checked by `npm run build` / `tsc` but produces no runtime output.
 */

// --- mcp-tools.ts: McpStatusMap should NOT be exported ---
// @ts-expect-error McpStatusMap is internal and should not be exported
import type { McpStatusMap } from './mcp-tools.js';

// --- runtime.ts: OpenCodeRulesRuntimeOptions should NOT be exported ---
// @ts-expect-error OpenCodeRulesRuntimeOptions is internal and should not be exported
import type { OpenCodeRulesRuntimeOptions } from './runtime.js';

// --- session-store.ts: SessionStoreOptions should NOT be exported ---
// @ts-expect-error SessionStoreOptions is internal and should not be exported
import type { SessionStoreOptions } from './session-store.js';

// --- utils.ts: RuleMetadata should NOT be exported ---
// @ts-expect-error RuleMetadata is internal and should not be exported
import type { RuleMetadata } from './utils.js';

// Suppress unused variable warnings for the type imports above
void (0 as unknown as McpStatusMap);
void (0 as unknown as OpenCodeRulesRuntimeOptions);
void (0 as unknown as SessionStoreOptions);
void (0 as unknown as RuleMetadata);
