### Task 1.2: Refactor `index.ts` to Use New Hook Architecture

**Files:**

- Modify: `src/index.ts` (complete rewrite)

**Context:**

Replace the current `event` hook approach with:

1. `experimental.chat.messages.transform` - extracts file paths from messages, stores in module variable
2. `experimental.chat.system.transform` - injects rules into system prompt using stored context

The hooks fire in order: messages.transform first, then system.transform.

**Dependencies:**

- Task 1.1 must be complete (extractFilePathsFromMessages utility)

---

**Step 1: Update imports**

Replace the imports at top of `src/index.ts`:

```typescript
/**
 * OpenCode Rules Plugin
 *
 * This plugin discovers markdown rule files from standard directories
 * and injects them into the system prompt via transform hooks.
 */

import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import {
  discoverRuleFiles,
  readAndFormatRules,
  extractFilePathsFromMessages,
} from './utils.js';
```

**Step 2: Add module-level context storage**

Add after imports:

```typescript
/**
 * Module-level storage for file context between hook calls.
 * The messages.transform hook populates this, system.transform reads it.
 */
let currentContextPaths: string[] = [];
```

**Step 3: Rewrite the plugin function**

Replace the entire `openCodeRulesPlugin` function:

```typescript
/**
 * OpenCode Rules Plugin
 * Discovers markdown rule files and injects them into the system prompt
 * using experimental transform hooks.
 */
const openCodeRulesPlugin: Plugin = async (input: PluginInput) => {
  // Discover rule files from global and project directories
  const ruleFiles = await discoverRuleFiles(input.directory);

  if (ruleFiles.length === 0) {
    console.debug('[opencode-rules] No rule files discovered');
    return {};
  }

  console.debug(`[opencode-rules] Discovered ${ruleFiles.length} rule file(s)`);

  return {
    /**
     * Extract file paths from messages for conditional rule filtering.
     * This hook fires before system.transform.
     */
    'experimental.chat.messages.transform': async ({ output }) => {
      // Extract paths from all messages
      currentContextPaths = extractFilePathsFromMessages(output.messages);

      console.debug(
        `[opencode-rules] Extracted ${currentContextPaths.length} context path(s) from messages`
      );

      // Don't modify messages - just extract context
      return output;
    },

    /**
     * Inject rules into the system prompt.
     * Uses context paths from the messages.transform hook.
     */
    'experimental.chat.system.transform': async ({ output }) => {
      // Format rules, filtering by context paths
      const formattedRules = await readAndFormatRules(
        ruleFiles,
        currentContextPaths
      );

      if (!formattedRules) {
        console.debug(
          '[opencode-rules] No applicable rules for current context'
        );
        return output;
      }

      console.debug('[opencode-rules] Injecting rules into system prompt');

      // Append rules to system prompt
      return {
        ...output,
        system: output.system
          ? `${output.system}\n\n${formattedRules}`
          : formattedRules,
      };
    },
  };
};

export default openCodeRulesPlugin;
```

**Step 4: Remove old code**

Ensure these are removed (should be gone after Step 3):

- `sessionsWithRules` Set
- `sendRulesMessage` function
- `event` hook handler

**Step 5: Run type check**

Run: `npm run build`
Expected: May have TypeScript errors about `readAndFormatRules` signature - that's expected, will be fixed in Task 1.3

**Step 6: Commit (even with errors - we'll fix in next task)**

```bash
git add src/index.ts
git commit -m "refactor: replace event hooks with experimental transform hooks

BREAKING CHANGE: Rules now injected via system prompt instead of silent messages"
```
