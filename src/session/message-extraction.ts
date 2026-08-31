import path from 'node:path';

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

export interface MessagePartWithSession {
  type?: string;
  text?: string;
  sessionID?: string;
  synthetic?: boolean;
  id?: string;
  callID?: string;
  tool?: string;
  state?: {
    input?: unknown;
  };
}

export interface MessageWithInfo {
  info?: {
    id?: string;
    role?: string;
    sessionID?: string;
  };
  parts?: MessagePartWithSession[];
}

export function extractTextFromParts(
  parts: Array<{ type?: string; text?: string; synthetic?: boolean }>
): string {
  const textParts: string[] = [];
  for (const part of parts) {
    if (part.synthetic) continue;

    if (part.type === 'text' && part.text) {
      textParts.push(part.text);
    } else if (typeof part.text === 'string' && !part.type) {
      textParts.push(part.text);
    }
  }

  return textParts
    .map(t => t.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function normalizeContextPath(
  filePath: string,
  baseDir: string
): string {
  if (!path.isAbsolute(filePath)) return filePath;
  const rel = path.relative(baseDir, filePath);
  return rel.split(path.sep).join('/');
}

export function sanitizePathForContext(filePath: string): string {
  return filePath.replace(/[\r\n\t]/g, ' ').slice(0, 300);
}

export function extractSessionID(
  messages: MessageWithInfo[]
): string | undefined {
  for (const message of messages) {
    if (message.info?.sessionID) {
      return message.info.sessionID;
    }
    if (message.parts) {
      for (const part of message.parts) {
        if (part.sessionID) {
          return part.sessionID;
        }
      }
    }
  }
  return undefined;
}

export function extractLatestUserPrompt(
  messages: MessageWithInfo[]
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.info?.role !== 'user') continue;
    const parts = message.parts || [];

    const userPrompt = extractTextFromParts(parts);
    if (userPrompt) {
      return userPrompt;
    }
  }

  return undefined;
}

export function filterValidMessages(messages: MessageWithInfo[]): Message[] {
  const result: Message[] = [];
  for (const msg of messages) {
    const role = msg.info?.role;
    if (
      typeof role === 'string' &&
      Array.isArray(msg.parts) &&
      msg.parts.length > 0
    ) {
      result.push({
        role,
        parts: msg.parts as MessagePart[],
      });
    }
  }
  return result;
}

export function extractSlashCommand(prompt?: string): string | undefined {
  if (!prompt) return undefined;
  const first = prompt.trim().split(/\s+/, 1)[0];
  if (first.length > 1 && first.startsWith('/')) {
    return first;
  }
  return undefined;
}
