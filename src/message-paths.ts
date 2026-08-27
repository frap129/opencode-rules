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
        extractPathsFromToolCall(
          toolPart.toolInvocation.toolName,
          toolPart.toolInvocation.args,
          paths
        );
      }

      // Extract from persisted OpenCode tool parts
      if (part.type === 'tool') {
        const toolPart = part as OpenCodeToolPart;
        extractPathsFromToolCall(toolPart.tool, toolPart.state?.input, paths);
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
 * Extract file paths from tool call arguments
 */
function extractPathsFromToolCall(
  toolName: string,
  args: unknown,
  paths: Set<string>
): void {
  if (!args || typeof args !== 'object') return;

  // Tools that have a direct file path argument
  const pathArgTools: Record<string, string[]> = {
    read: ['filePath'],
    edit: ['filePath'],
    write: ['filePath'],
    glob: ['pattern', 'path'],
    grep: ['path'],
  };

  const argNames = pathArgTools[toolName];
  if (argNames) {
    for (const argName of argNames) {
      const value = (args as Record<string, unknown>)[argName];
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
