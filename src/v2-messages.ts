// src/v2-messages.ts
import type {
  MessageWithInfo,
  MessagePartWithSession,
} from './message-context.js';
import type { V2Message } from './v2-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Adapt V2 messages ({role, content}) to the V1-like shape
 * ({role, parts}) consumed by message-paths/message-context.
 * tool-result, media, and reasoning parts carry no extraction value and are dropped.
 */
export function toV1Messages(messages: V2Message[]): MessageWithInfo[] {
  return messages.map(message => {
    const parts: MessageWithInfo['parts'] = [];
    for (const part of message.content ?? []) {
      if (part.type === 'text') {
        parts.push({ type: 'text', text: part.text });
      } else if (part.type === 'tool-call') {
        parts.push({
          type: 'tool-invocation',
          toolInvocation: {
            toolName: part.name,
            args: isRecord(part.input) ? part.input : {},
          },
        } as MessagePartWithSession);
      }
    }
    return { role: message.role, parts };
  });
}
