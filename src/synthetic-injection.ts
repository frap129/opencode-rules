/**
 * Builders and scanners for synthetic parts persisted in opencode session
 * history. Synthetic parts are hidden in the TUI but included in model
 * requests, so they carry rules without touching the system prompt.
 */
import { createHash } from 'node:crypto';
import type { MessageWithInfo } from './message-context.js';

export interface SyntheticPart {
  id: string;
  type: 'text';
  text: string;
  synthetic: true;
  sessionID?: string;
  messageID?: string;
}

export interface TransientHookMessage {
  info: { id: string; role: string } & Record<string, unknown>;
  parts: SyntheticPart[];
}

export interface InjectedPartsScan {
  ruleKeys: Set<string>;
  hookHashes: Set<string>;
  ruleRelativePaths: Set<string>;
}

const RULE_PART_PREFIX = 'prt_rules_';
const HOOK_PART_PREFIX = 'prt_hook_';
const TRANSIENT_HOOK_PART_PREFIX = 'prt_hook_transient_';
const RULE_HEADER_PATTERN = /^## (.+)\n\n([\s\S]*)$/;

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function hashContent(content: string): string {
  return shortHash(content);
}

export function ruleKeyFor(relativePath: string, content: string): string {
  return `${relativePath}:${shortHash(content)}`;
}

export function buildRulePart(
  relativePath: string,
  content: string
): SyntheticPart {
  return {
    id: `${RULE_PART_PREFIX}${shortHash(ruleKeyFor(relativePath, content))}`,
    type: 'text',
    text: `## ${relativePath}\n\n${content}`,
    synthetic: true,
  };
}

export function buildHookInjectionPart(content: string): SyntheticPart {
  return {
    id: `${HOOK_PART_PREFIX}${shortHash(content)}`,
    type: 'text',
    text: content,
    synthetic: true,
  };
}

export function buildTransientHookMessage(
  content: string,
  baseInfo: Record<string, unknown>
): TransientHookMessage {
  return {
    info: {
      ...baseInfo,
      id: `msg_rules_hook_${shortHash(content)}`,
      role: 'user',
    },
    parts: [
      {
        id: `${TRANSIENT_HOOK_PART_PREFIX}${shortHash(content)}`,
        type: 'text',
        text: content,
        synthetic: true,
      },
    ],
  };
}

export function scanInjectedParts(
  messages: MessageWithInfo[]
): InjectedPartsScan {
  const scan: InjectedPartsScan = {
    ruleKeys: new Set(),
    hookHashes: new Set(),
    ruleRelativePaths: new Set(),
  };

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const id = typeof part.id === 'string' ? part.id : undefined;

      if (id?.startsWith(RULE_PART_PREFIX)) {
        recordRuleText(scan, part.text);
        continue;
      }

      if (id?.startsWith(HOOK_PART_PREFIX)) {
        if (!id.startsWith(TRANSIENT_HOOK_PART_PREFIX)) {
          scan.hookHashes.add(id.slice(HOOK_PART_PREFIX.length));
        }
        continue;
      }

      // Marker fallback for rule parts whose id was not preserved: a
      // synthetic text part without an id whose text carries the per-rule
      // `## <path>` header.
      if (
        id === undefined &&
        part.synthetic === true &&
        part.type === 'text' &&
        typeof part.text === 'string'
      ) {
        recordRuleText(scan, part.text);
      }
    }
  }

  return scan;
}

function recordRuleText(scan: InjectedPartsScan, text: unknown): void {
  if (typeof text !== 'string') return;
  const match = RULE_HEADER_PATTERN.exec(text);
  if (!match) return;
  scan.ruleKeys.add(ruleKeyFor(match[1], match[2]));
  scan.ruleRelativePaths.add(match[1]);
}
