// Adapters from opencode v2 message shapes into the plugin's internal
// { info, parts } message form. The delivery codec, ledger, and working
// context all consume the internal form, so normalization happens once at
// the boundary: the session `context` hook, the client history read, and
// the session `prompt` hook.

import type {
  MessagePartWithSession,
  MessageWithInfo,
} from './message-extraction.js';

export interface V2ContentPart {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: unknown;
  result?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function textFromToolResult(result: unknown): string | undefined {
  const record = asRecord(result);
  if (!record) return undefined;
  if (record.type === 'text') return asString(record.value);
  if (record.type === 'json') {
    const value = record.value;
    if (typeof value === 'string') return value;
    if (value !== null && typeof value === 'object') {
      return JSON.stringify(value);
    }
    return undefined;
  }
  if (record.type === 'error') return undefined;
  if (record.type === 'content' && Array.isArray(record.value)) {
    const texts: string[] = [];
    for (const item of record.value) {
      const itemRecord = asRecord(item);
      const text = asString(itemRecord?.text);
      if (itemRecord?.type === 'text' && text !== undefined) {
        texts.push(text);
      }
    }
    return texts.length > 0 ? texts.join('\n') : undefined;
  }
  return undefined;
}

function messageInfo(
  id: string | undefined,
  role: string
): NonNullable<MessageWithInfo['info']> {
  return { ...(id !== undefined ? { id } : {}), role };
}

/** AI SDK Message (session context hook): { id?, role, content: ContentPart[] }. */
export function fromContextMessages(
  messages: readonly unknown[]
): MessageWithInfo[] {
  const result: MessageWithInfo[] = [];
  for (const message of messages) {
    const record = asRecord(message);
    if (!record) continue;
    const role = asString(record.role);
    if (!role) continue;
    const parts = contentToParts(record.content);
    result.push({ info: messageInfo(asString(record.id), role), parts });
  }
  return result;
}

function contentToParts(content: unknown): MessagePartWithSession[] {
  const parts: MessagePartWithSession[] = [];
  if (!Array.isArray(content)) return parts;
  for (const value of content) {
    const part = asRecord(value) as V2ContentPart | undefined;
    if (!part) continue;
    if (part.type === 'text') {
      const text = asString(part.text);
      if (text !== undefined) {
        parts.push({ type: 'text', text });
      }
      continue;
    }
    if (part.type === 'tool-call') {
      const tool = asString(part.name);
      if (tool !== undefined) {
        parts.push({
          type: 'tool',
          tool,
          // Normalized context parts are complete by construction; the
          // observation extractor requires state.status === 'completed'.
          state: { status: 'completed', input: part.input },
        });
      }
      continue;
    }
    if (part.type === 'tool-result') {
      const tool = asString(part.name);
      if (tool === undefined) continue;
      const output = textFromToolResult(part.result);
      const toolPart: MessagePartWithSession = { type: 'tool', tool };
      if (output !== undefined) {
        toolPart.output = output;
      }
      parts.push(toolPart);
      continue;
    }
    // media, reasoning, and compaction parts carry no file observations.
  }
  return parts;
}

export interface V2SessionMessage {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  metadata?: unknown;
  content?: unknown;
  state?: unknown;
}

function completedOutput(state: unknown): string | undefined {
  const record = asRecord(state);
  if (record?.status !== 'completed' || !Array.isArray(record.content)) {
    return undefined;
  }
  const texts: string[] = [];
  for (const value of record.content) {
    const part = asRecord(value);
    const text = asString(part?.text);
    if (part?.type === 'text' && text !== undefined) {
      texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join('\n') : undefined;
}

function assistantToolPart(
  tool: string,
  state: unknown
): MessagePartWithSession {
  const record = asRecord(state);
  const input = record?.input;
  const output = completedOutput(state);
  const stateInput =
    input !== null && typeof input === 'object'
      ? // Completed by construction: history tool state with an input
        // record represents a finished call.
        { status: 'completed', input }
      : undefined;
  return {
    type: 'tool',
    tool,
    ...(stateInput !== undefined ? { state: stateInput } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

/** Session message list (client history): SessionMessageInfo union. */
export function fromSessionMessages(
  messages: readonly unknown[]
): MessageWithInfo[] {
  const result: MessageWithInfo[] = [];
  for (const message of messages) {
    const record = asRecord(message) as V2SessionMessage | undefined;
    if (!record) continue;
    const id = asString(record.id);
    const type = asString(record.type);
    const metadata = asRecord(record.metadata);

    if (type === 'user') {
      const text = asString(record.text);
      // Message-level delivery keys survive for legacy prompt-path
      // admissions, which were persisted as user-typed messages.
      const keys = deliveryKeyMetadata(metadata);
      result.push({
        info: messageInfo(id, 'user'),
        ...(text !== undefined
          ? { parts: [{ type: 'text', text, ...keys }] }
          : {}),
      });
      continue;
    }

    if (type === 'synthetic') {
      const text = asString(record.text);
      const parts: MessagePartWithSession[] = [];
      if (text !== undefined) {
        parts.push(syntheticTextPart(text, metadata));
      }
      result.push({
        info: messageInfo(id, 'user'),
        ...(parts.length > 0 ? { parts } : {}),
      });
      continue;
    }

    if (type === 'assistant') {
      const parts: MessagePartWithSession[] = [];
      if (Array.isArray(record.content)) {
        for (const value of record.content) {
          const part = asRecord(value);
          if (!part) continue;
          if (part.type === 'text') {
            const text = asString(part.text);
            if (text !== undefined) parts.push({ type: 'text', text });
          } else if (part.type === 'tool') {
            const tool = asString(part.name);
            if (tool !== undefined) {
              parts.push(assistantToolPart(tool, part.state));
            }
          }
        }
      }
      result.push({
        info: messageInfo(id, 'assistant'),
        ...(parts.length > 0 ? { parts } : {}),
      });
      continue;
    }

    // system/skill/shell/compaction and selection markers carry no
    // working-context signal for this plugin.
  }
  return result;
}

function deliveryKeyMetadata(metadata: Record<string, unknown> | undefined): {
  metadata?: Record<string, unknown>;
} {
  const ruleKeys = metadata?.ruleKeys;
  const hookKeys = metadata?.hookKeys;
  if (!Array.isArray(ruleKeys) && !Array.isArray(hookKeys)) return {};
  return {
    metadata: {
      ...(Array.isArray(ruleKeys) ? { ruleKeys } : {}),
      ...(Array.isArray(hookKeys) ? { hookKeys } : {}),
    },
  };
}

function syntheticTextPart(
  text: string,
  metadata: Record<string, unknown> | undefined
): MessagePartWithSession {
  return {
    type: 'text',
    text,
    synthetic: true,
    ...deliveryKeyMetadata(metadata),
  };
}
