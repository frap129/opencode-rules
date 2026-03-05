import path from 'path';
import type { Message, MessagePart } from './utils.js';

export interface MessagePartWithSession {
  type?: string;
  text?: string;
  sessionID?: string;
  synthetic?: boolean;
}

export interface MessageWithInfo {
  role?: string;
  parts?: MessagePartWithSession[];
  info?: {
    sessionID?: string;
  };
}

/**
 * Extract and join text content from message parts.
 * Skips synthetic parts and parts without text content.
 * Returns an empty string if no text is extracted.
 */
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

/**
 * Normalize paths to repo-relative POSIX format.
 * If path is absolute and under baseDir, convert to relative POSIX path.
 * Otherwise return path as-is.
 */
export function normalizeContextPath(p: string, baseDir: string): string {
  if (!path.isAbsolute(p)) return p;
  const rel = path.relative(baseDir, p);
  return rel.split(path.sep).join('/');
}

/**
 * Sanitize a file path for safe inclusion in context strings.
 * Prevents prompt injection by removing control characters and limiting length.
 */
export function sanitizePathForContext(p: string): string {
  return p.replace(/[\r\n\t]/g, ' ').slice(0, 300);
}

/**
 * Extract sessionID from messages array.
 */
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

/**
 * Extract the latest user message text from messages array.
 */
export function extractLatestUserPrompt(
  messages: MessageWithInfo[]
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role && message.role !== 'user') continue;
    const parts = message.parts || [];

    const userPrompt = extractTextFromParts(parts);
    if (userPrompt) {
      return userPrompt;
    }
  }

  return undefined;
}

/**
 * Convert MessageWithInfo[] to Message[] by filtering out messages
 * that lack required fields (role, non-empty parts array).
 */
export function toExtractableMessages(messages: MessageWithInfo[]): Message[] {
  const result: Message[] = [];
  for (const msg of messages) {
    if (
      typeof msg.role === 'string' &&
      Array.isArray(msg.parts) &&
      msg.parts.length > 0
    ) {
      result.push({
        role: msg.role,
        parts: msg.parts as MessagePart[],
      });
    }
  }
  return result;
}

/**
 * Extract the leading slash command from a user prompt.
 * Returns the first whitespace-delimited token if it starts with '/'
 * and contains at least one non-slash character after the leading slash.
 */
export function extractSlashCommand(prompt?: string): string | undefined {
  if (!prompt) return undefined;
  const first = prompt.trim().split(/\s+/, 1)[0];
  // Must start with '/' and have at least one additional character
  if (first.length > 1 && first.startsWith('/')) {
    return first;
  }
  return undefined;
}
