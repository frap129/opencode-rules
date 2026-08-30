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

export function extractFilePathsFromMessages(messages: Message[]): string[] {
  const paths = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      if ((part as { synthetic?: boolean }).synthetic) continue;

      if (part.type === 'tool-invocation') {
        const toolPart = part as ToolInvocationPart;
        for (const path of extractToolCallPaths(
          toolPart.toolInvocation.toolName,
          toolPart.toolInvocation.args
        )) {
          paths.add(path);
        }
      }

      if (part.type === 'tool') {
        const toolPart = part as OpenCodeToolPart;
        for (const path of extractToolCallPaths(
          toolPart.tool,
          toolPart.state?.input
        )) {
          paths.add(path);
        }
      }

      if (part.type === 'text') {
        const textPart = part as TextPart;
        extractPathsFromText(textPart.text, paths);
      }
    }
  }

  return Array.from(paths);
}

// Tool-name to context-path argument mapping, shared by live tool execution
// and history extraction so identical calls contribute identical paths
// either way.
const PATH_ARG_TOOLS: ReadonlyMap<string, readonly string[]> = new Map([
  ['read', ['filePath']],
  ['edit', ['filePath']],
  ['write', ['filePath']],
  ['glob', ['pattern', 'path']],
  ['grep', ['path']],
  ['bash', ['workdir']],
]);

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
      // The pattern's non-glob prefix is a directory.
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

// A no-slash prefix like `src*.ts` is a file prefix, not a directory.
function extractDirFromGlob(pattern: string): string | null {
  const globChars = ['*', '?', '[', '{'];
  let firstGlobIndex = pattern.length;

  for (const char of globChars) {
    const idx = pattern.indexOf(char);
    if (idx !== -1 && idx < firstGlobIndex) {
      firstGlobIndex = idx;
    }
  }

  if (firstGlobIndex === 0) return null;

  const beforeGlob = pattern.substring(0, firstGlobIndex);
  const lastSlash = beforeGlob.lastIndexOf('/');

  if (lastSlash === -1) {
    if (firstGlobIndex < pattern.length) return null;
    return beforeGlob;
  }
  return beforeGlob.substring(0, lastSlash);
}

function extractPathsFromText(text: string, paths: Set<string>): void {
  const pathRegex =
    /(?:^|[\s"'`(])((\.{0,2}\/)?[\w./-]+\/[\w./-]+(?:\.\w+)?)/gm;

  let match;
  while ((match = pathRegex.exec(text)) !== null) {
    let potentialPath = match[1];

    potentialPath = potentialPath.replace(/[.,!?:;]+$/, '');

    if (
      potentialPath.includes('://') ||
      potentialPath.startsWith('http') ||
      potentialPath.includes('@')
    ) {
      continue;
    }

    if (potentialPath.replace(/[/.]/g, '').length > 0) {
      paths.add(potentialPath);
    }
  }
}
