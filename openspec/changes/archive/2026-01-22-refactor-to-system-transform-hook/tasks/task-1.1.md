### Task 1.1: Add `extractFilePathsFromMessages()` Utility

**Files:**

- Modify: `src/utils.ts` (add new function at end of file)

**Context:**

This utility extracts file paths from conversation messages to enable conditional rule filtering. It parses:

1. Tool call arguments (read, edit, glob, grep tools)
2. Message content via regex for path-like strings

The OpenCode message format uses `MessagePart` objects with `type` field. Tool calls have `type: 'tool-invocation'` with `toolInvocation.args` containing the arguments.

---

**Step 1: Add the function signature and types**

Add to end of `src/utils.ts`:

```typescript
/**
 * Message part types from OpenCode plugin API
 */
interface ToolInvocationPart {
  type: 'tool-invocation';
  toolInvocation: {
    toolName: string;
    args: Record<string, unknown>;
  };
}

interface TextPart {
  type: 'text';
  text: string;
}

type MessagePart = ToolInvocationPart | TextPart | { type: string };

interface Message {
  role: string;
  parts: MessagePart[];
}

/**
 * Extract file paths from conversation messages for conditional rule filtering.
 * Parses tool call arguments and scans message content for path-like strings.
 *
 * @param messages - Array of conversation messages
 * @returns Deduplicated array of file paths found in messages
 */
export function extractFilePathsFromMessages(messages: Message[]): string[] {
  const paths = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      // Extract from tool invocations
      if (part.type === 'tool-invocation') {
        const toolPart = part as ToolInvocationPart;
        extractPathsFromToolCall(toolPart, paths);
      }

      // Extract from text content
      if (part.type === 'text') {
        const textPart = part as TextPart;
        extractPathsFromText(textPart.text, paths);
      }
    }
  }

  return Array.from(paths);
}
```

**Step 2: Add the tool call extraction helper**

Add below the main function:

```typescript
/**
 * Extract file paths from tool call arguments
 */
function extractPathsFromToolCall(
  part: ToolInvocationPart,
  paths: Set<string>
): void {
  const { toolName, args } = part.toolInvocation;

  // Tools that have a direct file path argument
  const pathArgTools: Record<string, string[]> = {
    read: ['filePath'],
    edit: ['filePath'],
    write: ['filePath'],
    glob: ['pattern', 'path'],
    grep: ['path', 'include'],
  };

  const argNames = pathArgTools[toolName];
  if (argNames) {
    for (const argName of argNames) {
      const value = args[argName];
      if (typeof value === 'string' && value.length > 0) {
        // For glob patterns, extract the directory part
        if (argName === 'pattern') {
          const dirPart = extractDirFromGlob(value);
          if (dirPart) paths.add(dirPart);
        } else {
          paths.add(value);
        }
      }
    }
  }
}

/**
 * Extract directory path from a glob pattern
 * e.g., "src/components/**/*.ts" -> "src/components"
 */
function extractDirFromGlob(pattern: string): string | null {
  // Find the first glob character
  const globChars = ['*', '?', '[', '{'];
  let firstGlobIndex = pattern.length;

  for (const char of globChars) {
    const idx = pattern.indexOf(char);
    if (idx !== -1 && idx < firstGlobIndex) {
      firstGlobIndex = idx;
    }
  }

  if (firstGlobIndex === 0) return null;

  // Get the directory part before the glob
  const beforeGlob = pattern.substring(0, firstGlobIndex);
  const lastSlash = beforeGlob.lastIndexOf('/');

  if (lastSlash === -1) return beforeGlob;
  return beforeGlob.substring(0, lastSlash);
}
```

**Step 3: Add the text content extraction helper**

Add below the tool call helper:

```typescript
/**
 * Extract file paths from text content using regex
 */
function extractPathsFromText(text: string, paths: Set<string>): void {
  // Match paths that look like file paths:
  // - Start with ./, ../, /, or a word character
  // - Contain at least one /
  // - End with a file extension or directory
  const pathRegex =
    /(?:^|[\s"'`(])((\.{0,2}\/)?[\w./-]+\/[\w./-]+(?:\.\w+)?)/gm;

  let match;
  while ((match = pathRegex.exec(text)) !== null) {
    const potentialPath = match[1];

    // Filter out URLs and other non-paths
    if (
      potentialPath.includes('://') ||
      potentialPath.startsWith('http') ||
      potentialPath.includes('@')
    ) {
      continue;
    }

    // Must have a reasonable structure (not just slashes)
    if (potentialPath.replace(/[/.]/g, '').length > 0) {
      paths.add(potentialPath);
    }
  }
}
```

**Step 4: Run type check to verify compilation**

Run: `npm run build`
Expected: No TypeScript errors

**Step 5: Commit**

```bash
git add src/utils.ts
git commit -m "feat: add extractFilePathsFromMessages utility for context gathering"
```
