import { createHash } from 'node:crypto';

const RULE_PART_PREFIX = 'prt_rules_';
const TRANSIENT_RULE_PART_PREFIX = 'prt_rule_ephemeral_';
const TRANSIENT_RULE_MESSAGE_PREFIX = 'msg_rule_ephemeral_';
const TRANSIENT_HOOK_MESSAGE_PREFIX = 'msg_rules_hook_';
const RULE_ADMISSION_MESSAGE_PREFIX = 'msg_rule_admission_';
const LEGACY_RULE_HEADER_PATTERN = /^## (.+)\n\n[\s\S]*$/;
const DELIVERY_PREAMBLE =
  'The following rules were injected by a plugin. Follow them silently; do not acknowledge them to the user.';

export interface DeliveryPart {
  id?: string;
  type?: string;
  text?: string;
  synthetic?: boolean;
  sessionID?: string;
  messageID?: string;
  metadata?: {
    ruleKeys?: string[];
    hookKeys?: string[];
    [key: string]: unknown;
  };
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

export interface DeliveryRule {
  identity?: string;
  relativePath: string;
  name?: string;
  content: string;
}

export interface TransientMessage {
  info: { id: string; role: 'user' } & Record<string, unknown>;
  parts: SyntheticPart[];
}

export interface DeliveryLedgerFacts {
  ruleKeys: Set<string>;
  hookKeys: Set<string>;
}

export interface TransientPresenceFacts {
  /** Every message and part identifier in the dispatch, not delivery IDs only. */
  ids: Set<string>;
  ruleKeys: Set<string>;
  hookKeys: Set<string>;
}

export interface TransientPresenceMessage {
  info?: Record<string, unknown>;
  parts?: readonly unknown[];
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function ruleKeyFor(relativePath: string): string {
  return shortHash(relativePath.replaceAll('\\', '/'));
}

function ruleKey(rule: DeliveryRule): string {
  return ruleKeyFor(rule.identity ?? rule.relativePath);
}

function shortName(rule: DeliveryRule): string {
  return (
    rule.name ??
    rule.relativePath
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.(?:md|mdc)$/i, '') ??
    rule.relativePath
  );
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderSystemMessage(rules: readonly DeliveryRule[]): string {
  const renderedRules = rules
    .map(
      rule =>
        `<rule name="${escapeAttribute(shortName(rule))}">\n${rule.content}\n</rule>`
    )
    .join('\n\n');
  return `<system-message>\n${DELIVERY_PREAMBLE}\n\n${renderedRules}\n</system-message>`;
}

function deliveryIdentity(
  ruleKeys: readonly string[],
  hookKeys: readonly string[]
): string {
  return shortHash(
    [
      ...ruleKeys.map(key => `rule:${key}`),
      ...hookKeys.map(key => `hook:${key}`),
    ].join('|')
  );
}

export function buildDurableDeliveryPart(
  rules: readonly DeliveryRule[],
  hooks: readonly DeliveryRule[],
  owner: DurablePartOwner
): SyntheticPart {
  const ruleKeys = rules.map(ruleKey);
  const hookKeys = hooks.map(ruleKey);
  return {
    id: `${RULE_PART_PREFIX}${deliveryIdentity(ruleKeys, hookKeys)}_${owner.messageID}`,
    type: 'text',
    text: renderSystemMessage([...rules, ...hooks]),
    synthetic: true,
    metadata: {
      ...(ruleKeys.length > 0 ? { ruleKeys } : {}),
      ...(hookKeys.length > 0 ? { hookKeys } : {}),
    },
    ...owner,
  };
}

export function buildRuleAdmissionPart(
  rules: readonly DeliveryRule[],
  sessionID: string
): SyntheticPart {
  const ruleKeys = rules.map(ruleKey);
  const identity = deliveryIdentity(ruleKeys, []);
  const messageID = `${RULE_ADMISSION_MESSAGE_PREFIX}${identity}`;
  return {
    id: `${RULE_PART_PREFIX}${identity}_${messageID}`,
    type: 'text',
    text: renderSystemMessage(rules),
    synthetic: true,
    metadata: { ruleKeys, ruleAdmission: true },
    sessionID,
    messageID,
  };
}

export function isRuleAdmissionPart(value: unknown): boolean {
  const part = asRecord(value);
  const metadata = asRecord(part?.metadata);
  return part?.synthetic === true && metadata?.ruleAdmission === true;
}

function withModelObject<T extends Record<string, unknown>>(info: T): T {
  const model = info.model;
  if (model !== null && typeof model === 'object') return info;

  const providerID =
    typeof info.providerID === 'string' ? info.providerID : undefined;
  const modelID = typeof info.modelID === 'string' ? info.modelID : undefined;
  return { ...info, model: { providerID, modelID } };
}

export function buildTransientDeliveryMessage(
  rules: readonly DeliveryRule[],
  hooks: readonly DeliveryRule[],
  baseInfo: Record<string, unknown>
): TransientMessage {
  const ruleKeys = rules.map(ruleKey);
  const hookKeys = hooks.map(ruleKey);
  const identity = deliveryIdentity(ruleKeys, hookKeys);
  const messageID = `${TRANSIENT_RULE_MESSAGE_PREFIX}${identity}`;
  return {
    info: withModelObject({ ...baseInfo, id: messageID, role: 'user' }),
    parts: [
      {
        id: `${TRANSIENT_RULE_PART_PREFIX}${identity}`,
        type: 'text',
        text: renderSystemMessage([...rules, ...hooks]),
        synthetic: true,
        metadata: {
          ...(ruleKeys.length > 0 ? { ruleKeys } : {}),
          ...(hookKeys.length > 0 ? { hookKeys } : {}),
        },
      },
    ],
  };
}

export function isTransientMessageId(id: unknown): boolean {
  return (
    typeof id === 'string' &&
    (id.startsWith(TRANSIENT_RULE_MESSAGE_PREFIX) ||
      id.startsWith(TRANSIENT_HOOK_MESSAGE_PREFIX))
  );
}

export function decodeRawHistory(
  messages: readonly unknown[]
): DeliveryLedgerFacts {
  const facts: DeliveryLedgerFacts = {
    ruleKeys: new Set(),
    hookKeys: new Set(),
  };

  for (const message of messages) {
    const messageRecord = asRecord(message);
    if (!messageRecord || !Array.isArray(messageRecord.parts)) continue;

    for (const value of messageRecord.parts) {
      const part = asRecord(value);
      if (!part) continue;

      const id = typeof part.id === 'string' ? part.id : undefined;
      if (id?.startsWith(TRANSIENT_RULE_PART_PREFIX)) continue;
      const metadata = asRecord(part.metadata);
      recordKeys(facts.ruleKeys, metadata?.ruleKeys);
      recordKeys(facts.hookKeys, metadata?.hookKeys);
      // Read pre-release top-level keys for histories produced by development builds.
      recordKeys(facts.ruleKeys, part.ruleKeys);
      recordKeys(facts.hookKeys, part.hookKeys);

      if (
        metadata?.ruleKeys === undefined &&
        part.ruleKeys === undefined &&
        (id?.startsWith(RULE_PART_PREFIX) ||
          (id === undefined && part.type === 'text' && part.synthetic === true))
      ) {
        recordLegacyRuleText(facts, part.text);
      }
    }
  }

  return facts;
}

/**
 * Reads Transient delivery presence facts: identifiers and canonical metadata
 * keys already present in a dispatch's message array. Deliberately separate
 * from decodeRawHistory: presence counts Transient delivery parts, which the
 * durable ledger must exclude, and ignores the legacy persisted forms the
 * ledger must accept. Neither function calls the other.
 *
 * Malformed messages abort with the offending property-access TypeError,
 * matching the inline scan this replaced; hardening is deferred.
 */
export function decodeTransientPresence(
  messages: readonly TransientPresenceMessage[]
): TransientPresenceFacts {
  const facts: TransientPresenceFacts = {
    ids: new Set(),
    ruleKeys: new Set(),
    hookKeys: new Set(),
  };

  for (const message of messages) {
    const info = asRecord(message.info);
    if (typeof info?.id === 'string') facts.ids.add(info.id);

    if (!Array.isArray(message.parts)) continue;
    for (const value of message.parts) {
      const part = asRecord(value);
      if (!part) continue;

      if (typeof part.id === 'string') facts.ids.add(part.id);
      const metadata = asRecord(part.metadata);
      recordKeys(facts.ruleKeys, metadata?.ruleKeys);
      recordKeys(facts.hookKeys, metadata?.hookKeys);
      // Legacy top-level key arrays and legacy `## path` header text are
      // persisted durable forms only; Transient presence is canonical-shape
      // only, so they are deliberately not read here.
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

function recordKeys(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const key of value) {
    if (typeof key === 'string') target.add(key);
  }
}

function recordLegacyRuleText(facts: DeliveryLedgerFacts, text: unknown): void {
  if (typeof text !== 'string') return;
  const match = LEGACY_RULE_HEADER_PATTERN.exec(text);
  if (match?.[1]) facts.ruleKeys.add(ruleKeyFor(match[1]));
}
