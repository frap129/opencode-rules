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

    const textParts: string[] = [];
    for (const part of parts) {
      if (part.synthetic) continue;

      if (part.type === 'text' && part.text) {
        textParts.push(part.text);
      } else if (typeof part.text === 'string' && !part.type) {
        textParts.push(part.text);
      }
    }

    if (textParts.length > 0) {
      const userPrompt = textParts
        .map(t => t.trim())
        .filter(Boolean)
        .join(' ')
        .trim();
      return userPrompt || undefined;
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
