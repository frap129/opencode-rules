/**
 * Message path extraction utilities
 */

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

interface OpenCodeToolPart {
  type: 'tool';
  tool: string;
  state?: {
    input?: unknown;
  };
}

interface TextPart {
  type: 'text';
  text: string;
  synthetic?: boolean;
}

export type MessagePart =
  ToolInvocationPart | OpenCodeToolPart | TextPart | { type: string };

export interface Message {
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
      if ((part as { synthetic?: boolean }).synthetic) continue;

      // Extract from tool invocations
      if (part.type === 'tool-invocation') {
        const toolPart = part as ToolInvocationPart;
        for (const path of extractToolCallPaths(
          toolPart.toolInvocation.toolName,
          toolPart.toolInvocation.args
        )) {
          paths.add(path);
        }
      }

      // Extract from persisted OpenCode tool parts
      if (part.type === 'tool') {
        const toolPart = part as OpenCodeToolPart;
        for (const path of extractToolCallPaths(
          toolPart.tool,
          toolPart.state?.input
        )) {
          paths.add(path);
        }
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

/**
 * Tool-name to context-path argument mapping, shared by live tool execution
 * and history extraction so identical calls contribute identical paths either
 * way:
 *
 * - read / edit / write -> filePath
 * - grep -> path only (pattern/include are search terms, not paths)
 * - glob -> directory derived from pattern, plus explicit path
 * - bash -> workdir
 * - unknown tools -> nothing
 */
const PATH_ARG_TOOLS: ReadonlyMap<string, readonly string[]> = new Map([
  ['read', ['filePath']],
  ['edit', ['filePath']],
  ['write', ['filePath']],
  ['glob', ['pattern', 'path']],
  ['grep', ['path']],
  ['bash', ['workdir']],
]);

/**
 * Extract the context paths a single tool call contributes.
 */
export function extractToolCallPaths(
  toolName: string,
  args: unknown
): string[] {
  if (!args || typeof args !== 'object') return [];

  const argNames = PATH_ARG_TOOLS.get(toolName);
  if (!argNames) return [];

  const paths: string[] = [];
  for (const argName of argNames) {
    const value = (args as Record<string, unknown>)[argName];
    if (typeof value === 'string' && value.length > 0) {
      // For glob patterns, extract the directory part
      if (argName === 'pattern') {
        const dirPart = extractDirFromGlob(value);
        if (dirPart) paths.push(dirPart);
      } else {
        paths.push(value);
      }
    }
  }

  return paths;
}

/**
 * Extract directory path from a glob pattern
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

  if (lastSlash === -1) {
    // If no slash and pattern has glob characters, it's just a file prefix, not a directory
    if (firstGlobIndex < pattern.length) return null;
    return beforeGlob;
  }
  return beforeGlob.substring(0, lastSlash);
}

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
    let potentialPath = match[1];

    // Trim trailing punctuation that likely belongs to prose, not the path
    potentialPath = potentialPath.replace(/[.,!?:;]+$/, '');

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
