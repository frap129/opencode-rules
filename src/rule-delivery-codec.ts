import { createHash } from 'node:crypto';

const RULE_PART_PREFIX = 'prt_rules_';
const HOOK_PART_PREFIX = 'prt_hook_';
const TRANSIENT_HOOK_PART_PREFIX = 'prt_hook_transient_';
const TRANSIENT_RULE_PART_PREFIX = 'prt_rule_ephemeral_';
const TRANSIENT_RULE_MESSAGE_PREFIX = 'msg_rule_ephemeral_';
const TRANSIENT_HOOK_MESSAGE_PREFIX = 'msg_rules_hook_';
const RULE_HEADER_PATTERN = /^## (.+)\n\n([\s\S]*)$/;

export interface DeliveryPart {
  id?: string;
  type?: string;
  text?: string;
  synthetic?: boolean;
  sessionID?: string;
  messageID?: string;
  [key: string]: unknown;
}

export interface SyntheticPart extends DeliveryPart {
  id: string;
  type: 'text';
  text: string;
  synthetic: true;
}

export interface DurablePartOwner {
  sessionID: string;
  messageID: string;
}

export interface TransientMessage {
  info: { id: string; role: 'user' } & Record<string, unknown>;
  parts: SyntheticPart[];
}

export interface DeliveryLedgerFacts {
  ruleKeys: Set<string>;
  hookHashes: Set<string>;
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function hashContent(content: string): string {
  return shortHash(content);
}

export function ruleKeyFor(relativePath: string, content: string): string {
  return `${relativePath}:${shortHash(content)}`;
}

export function isTransientMessageId(id: unknown): boolean {
  return (
    typeof id === 'string' &&
    (id.startsWith(TRANSIENT_RULE_MESSAGE_PREFIX) ||
      id.startsWith(TRANSIENT_HOOK_MESSAGE_PREFIX))
  );
}

export function buildRulePart(
  relativePath: string,
  content: string,
  owner: DurablePartOwner
): SyntheticPart {
  const keyHash = shortHash(ruleKeyFor(relativePath, content));
  return {
    id: `${RULE_PART_PREFIX}${keyHash}_${owner.messageID}`,
    type: 'text',
    text: `## ${relativePath}\n\n${content}`,
    synthetic: true,
    ...owner,
  };
}

export function hookPartId(hash: string): string {
  return `${HOOK_PART_PREFIX}${hash}`;
}

export function buildDurableHookPart(
  content: string,
  owner: DurablePartOwner
): SyntheticPart {
  return {
    id: `${hookPartId(shortHash(content))}_${owner.messageID}`,
    type: 'text',
    text: content,
    synthetic: true,
    ...owner,
  };
}

/** Keep transient user messages readable by host hooks that expect info.model. */
function withModelObject<T extends Record<string, unknown>>(info: T): T {
  const model = info.model;
  if (model !== null && typeof model === 'object') {
    return info;
  }

  const providerID =
    typeof info.providerID === 'string' ? info.providerID : undefined;
  const modelID = typeof info.modelID === 'string' ? info.modelID : undefined;
  return { ...info, model: { providerID, modelID } };
}

export function buildTransientHookMessage(
  content: string,
  baseInfo: Record<string, unknown>
): TransientMessage {
  const hash = shortHash(content);
  const messageID = `${TRANSIENT_HOOK_MESSAGE_PREFIX}${hash}`;
  return {
    info: withModelObject({
      ...baseInfo,
      id: messageID,
      role: 'user',
    }),
    parts: [
      {
        id: `${TRANSIENT_HOOK_PART_PREFIX}${hash}`,
        type: 'text',
        text: content,
        synthetic: true,
      },
    ],
  };
}

export function buildTransientRuleMessage(
  relativePath: string,
  content: string,
  baseInfo: Record<string, unknown>
): TransientMessage {
  const keyHash = shortHash(ruleKeyFor(relativePath, content));
  const messageID = `${TRANSIENT_RULE_MESSAGE_PREFIX}${keyHash}`;
  return {
    info: withModelObject({
      ...baseInfo,
      id: messageID,
      role: 'user',
    }),
    parts: [
      {
        id: `${TRANSIENT_RULE_PART_PREFIX}${keyHash}`,
        type: 'text',
        text: `# OpenCode transient rule: ${relativePath}\n\n${content}`,
        synthetic: true,
      },
    ],
  };
}

export function decodeRawHistory(
  messages: readonly unknown[]
): DeliveryLedgerFacts {
  const facts: DeliveryLedgerFacts = {
    ruleKeys: new Set(),
    hookHashes: new Set(),
  };

  for (const message of messages) {
    const messageRecord = asRecord(message);
    if (!messageRecord || !Array.isArray(messageRecord.parts)) continue;

    for (const value of messageRecord.parts) {
      const part = asRecord(value);
      if (!part) continue;

      const id = typeof part.id === 'string' ? part.id : undefined;
      if (typeof id === 'string') {
        if (id.startsWith(RULE_PART_PREFIX)) {
          recordRuleText(facts, part.text);
        } else if (id.startsWith(TRANSIENT_RULE_PART_PREFIX)) {
          continue;
        } else if (id.startsWith(HOOK_PART_PREFIX)) {
          if (id.startsWith(TRANSIENT_HOOK_PART_PREFIX)) continue;
          facts.hookHashes.add(
            id.slice(HOOK_PART_PREFIX.length, HOOK_PART_PREFIX.length + 16)
          );
        }
        continue;
      }

      if (id === undefined && part.type === 'text' && part.synthetic === true) {
        recordRuleText(facts, part.text);
      }
    }
  }

  return facts;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function recordRuleText(facts: DeliveryLedgerFacts, text: unknown): void {
  if (typeof text !== 'string') return;
  const match = RULE_HEADER_PATTERN.exec(text);
  if (!match) return;
  facts.ruleKeys.add(ruleKeyFor(match[1], match[2]));
}
