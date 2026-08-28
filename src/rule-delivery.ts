import {
  buildDurableHookPart,
  buildRulePart,
  buildTransientHookMessage,
  buildTransientRuleMessage,
  decodeRawHistory,
  type DeliveryLedgerFacts,
  type DeliveryPart,
  hashContent,
  hookPartId,
  isTransientMessageId,
  ruleKeyFor,
} from './rule-delivery-codec.js';
import {
  type RawHistoryAdapter,
  type RawHistoryResult,
} from './rule-delivery-history.js';
import { createDebugLog, formatError, type DebugLog } from './debug.js';
import type { RuleLifetime } from './rule-filter.js';

export interface RuleDelivery {
  deliverDurableTurn(input: DurableTurnInput): Promise<DurableTurnResult>;
  deliverTransientDispatch(input: TransientDispatchInput): void;
  markCompacted(sessionID: string): void;
  queueMatchedHooks(input: MatchedHooksInput): void;
}

export type DurableTurnResult = 'accepted' | 'deferred';

export interface MatchedRuleContent {
  relativePath: string;
  content: string;
}

export interface DurableTurnOutput {
  parts?: DeliveryPart[];
}

export interface DurableTurnInput {
  sessionID: string;
  messageID?: string;
  matchedRules: readonly MatchedRuleContent[];
  output: DurableTurnOutput;
}

export interface MatchedHookContent extends MatchedRuleContent {
  lifetime: RuleLifetime;
}

export interface MatchedHooksInput {
  sessionID: string;
  hooks: readonly MatchedHookContent[];
}

export interface TransientDispatchMessage {
  info?: Record<string, unknown>;
  parts?: unknown[];
}

export interface TransientDispatchInput {
  sessionID: string;
  matchedRules: readonly MatchedRuleContent[];
  messages: TransientDispatchMessage[];
}

type RuleDeliveryOptions = {
  rawHistory: RawHistoryAdapter;
  debugLog?: DebugLog;
  maxSessions?: number;
};

interface DeliveryState {
  ruleKeys: Set<string>;
  hookHashes: Set<string>;
  ledgerRevision: number;
  seededFromHistory: boolean;
  needsRescan: boolean;
  pendingHookQueue: MatchedHookContent[];
  durableHookQueue: string[];
  transientHookQueue: string[];
  lastUpdated: number;
}

class DefaultRuleDelivery implements RuleDelivery {
  private readonly rawHistory: RawHistoryAdapter;
  private readonly debugLog: DebugLog;
  private readonly maxSessions: number;
  private readonly states = new Map<string, DeliveryState>();
  private readonly operationTails = new Map<string, Promise<void>>();
  private tick = 0;

  constructor(options: RuleDeliveryOptions) {
    this.rawHistory = options.rawHistory;
    this.debugLog = options.debugLog ?? createDebugLog();
    this.maxSessions = Math.max(1, options.maxSessions ?? 100);
  }

  private async decodeHistory(
    sessionID: string
  ): Promise<DeliveryLedgerFacts | undefined> {
    let result: RawHistoryResult;
    try {
      result = await this.rawHistory.readHistory(sessionID);
    } catch (error) {
      this.debugLog(
        `History read failed for ${sessionID}: ${formatError(error)}`
      );
      return undefined;
    }

    if (!result.ok) return undefined;
    return decodeRawHistory(result.messages);
  }

  async deliverDurableTurn(
    input: DurableTurnInput
  ): Promise<DurableTurnResult> {
    return this.serialize(input.sessionID, async () => {
      try {
        return await this.deliverDurable(input);
      } catch (error) {
        this.debugLog(
          `Durable delivery failed for ${input.sessionID}: ${formatError(error)}`
        );
        return 'deferred';
      }
    });
  }

  private async deliverDurable(
    input: DurableTurnInput
  ): Promise<DurableTurnResult> {
    const state = this.getState(input.sessionID);
    if (state.needsRescan) return 'deferred';

    if (!state.seededFromHistory) {
      const ledgerRevision = state.ledgerRevision;
      const facts = await this.decodeHistory(input.sessionID);
      if (!facts) {
        state.needsRescan = true;
        return 'deferred';
      }
      if (state.ledgerRevision !== ledgerRevision) return 'deferred';
      this.replaceLedger(state, facts);
      state.seededFromHistory = true;
    }
    this.routePendingHooks(state);

    if (!input.messageID) return 'deferred';

    const newRuleKeys = new Set<string>();
    const newHookHashes = new Set<string>();
    const newParts: DeliveryPart[] = [];
    for (const rule of input.matchedRules) {
      const key = ruleKeyFor(rule.relativePath, rule.content);
      if (state.ruleKeys.has(key) || newRuleKeys.has(key)) continue;
      newRuleKeys.add(key);
      newParts.push({
        ...buildRulePart(rule.relativePath, rule.content),
        sessionID: input.sessionID,
        messageID: input.messageID,
      });
    }

    for (const content of state.durableHookQueue) {
      const hash = hashContent(content);
      if (state.hookHashes.has(hash) || newHookHashes.has(hash)) continue;
      newHookHashes.add(hash);
      newParts.push({
        ...buildDurableHookPart(content),
        sessionID: input.sessionID,
        messageID: input.messageID,
      });
    }

    if (newParts.length > 0) {
      input.output.parts ??= [];
      input.output.parts.push(...newParts);
    }
    for (const key of newRuleKeys) state.ruleKeys.add(key);
    for (const hash of newHookHashes) state.hookHashes.add(hash);
    state.durableHookQueue = [];
    return 'accepted';
  }

  queueMatchedHooks(input: MatchedHooksInput): void {
    const state = this.getState(input.sessionID);
    for (const hook of input.hooks) {
      if (
        state.pendingHookQueue.some(
          pending => pending.content === hook.content
        ) ||
        state.durableHookQueue.includes(hook.content) ||
        state.transientHookQueue.includes(hook.content)
      ) {
        continue;
      }
      state.pendingHookQueue.push(hook);
    }
    if (state.seededFromHistory && !state.needsRescan) {
      this.routePendingHooks(state);
    }
  }

  deliverTransientDispatch(input: TransientDispatchInput): void {
    try {
      const state = this.getState(input.sessionID);
      if (!state.seededFromHistory || state.needsRescan) {
        const facts = decodeRawHistory(input.messages);
        this.replaceLedger(state, facts);
        state.seededFromHistory = true;
        state.needsRescan = false;
      }
      this.routePendingHooks(state);

      const target = input.messages[input.messages.length - 1];
      if (!target || !Array.isArray(target.parts)) return;

      const presentIDs = new Set<string>();
      for (const message of input.messages) {
        if (typeof message.info?.id === 'string') {
          presentIDs.add(message.info.id);
        }
        if (!Array.isArray(message.parts)) continue;
        for (const part of message.parts) {
          if (
            typeof part === 'object' &&
            part !== null &&
            'id' in part &&
            typeof part.id === 'string'
          ) {
            presentIDs.add(part.id);
          }
        }
      }

      const baseInfo = this.transientBaseInfo(input.messages);
      const pushTransient = (transientMessage: {
        info: Record<string, unknown>;
        parts: DeliveryPart[];
      }): void => {
        const part = transientMessage.parts[0];
        if (!part) return;
        input.messages.push({
          info: transientMessage.info,
          parts: [
            {
              ...part,
              sessionID: input.sessionID,
              messageID: transientMessage.info.id,
            },
          ],
        });
        presentIDs.add(transientMessage.info.id as string);
        presentIDs.add(part.id as string);
      };

      for (const rule of input.matchedRules) {
        const key = ruleKeyFor(rule.relativePath, rule.content);
        const transientMessage = buildTransientRuleMessage(
          rule.relativePath,
          rule.content,
          baseInfo
        );
        const part = transientMessage.parts[0];
        if (
          !part ||
          state.ruleKeys.has(key) ||
          presentIDs.has(transientMessage.info.id) ||
          presentIDs.has(part.id)
        ) {
          continue;
        }
        pushTransient(transientMessage);
      }

      for (const content of [
        ...state.durableHookQueue,
        ...state.transientHookQueue,
      ]) {
        const hash = hashContent(content);
        const transientMessage = buildTransientHookMessage(content, baseInfo);
        const part = transientMessage.parts[0];
        if (
          !part ||
          presentIDs.has(transientMessage.info.id) ||
          presentIDs.has(part.id) ||
          presentIDs.has(hookPartId(hash))
        ) {
          continue;
        }
        pushTransient(transientMessage);
      }
      state.transientHookQueue = [];
    } catch (error) {
      this.debugLog(
        `Transient delivery failed for ${input.sessionID}: ${formatError(error)}`
      );
    }
  }

  markCompacted(sessionID: string): void {
    const state = this.getState(sessionID);
    state.ledgerRevision++;
    state.needsRescan = true;
  }

  private replaceLedger(
    state: DeliveryState,
    facts: DeliveryLedgerFacts
  ): void {
    state.ruleKeys = new Set(facts.ruleKeys);
    state.hookHashes = new Set(facts.hookHashes);
    state.ledgerRevision++;
  }

  private routePendingHooks(state: DeliveryState): void {
    for (const hook of state.pendingHookQueue) {
      const ownerIsDurable = state.ruleKeys.has(
        ruleKeyFor(hook.relativePath, hook.content)
      );
      const queue =
        ownerIsDurable || hook.lifetime === 'durable'
          ? state.durableHookQueue
          : state.transientHookQueue;
      queue.push(hook.content);
    }
    state.pendingHookQueue = [];
  }

  private transientBaseInfo(
    messages: readonly TransientDispatchMessage[]
  ): Record<string, unknown> {
    for (let index = messages.length - 1; index >= 0; index--) {
      const info = messages[index]?.info;
      if (!info || info.role !== 'user' || isTransientMessageId(info.id)) {
        continue;
      }
      return info;
    }
    return messages[messages.length - 1]?.info ?? {};
  }

  private getState(sessionID: string): DeliveryState {
    let state = this.states.get(sessionID);
    if (!state) {
      state = {
        ruleKeys: new Set(),
        hookHashes: new Set(),
        ledgerRevision: 0,
        seededFromHistory: false,
        needsRescan: false,
        pendingHookQueue: [],
        durableHookQueue: [],
        transientHookQueue: [],
        lastUpdated: 0,
      };
      this.states.set(sessionID, state);
    }
    state.lastUpdated = ++this.tick;
    this.evictOldestSessions();
    return state;
  }

  private evictOldestSessions(): void {
    while (this.states.size > this.maxSessions) {
      let oldestID: string | undefined;
      let oldestUpdate = Infinity;
      for (const [sessionID, state] of this.states) {
        if (this.operationTails.has(sessionID)) continue;
        if (state.lastUpdated < oldestUpdate) {
          oldestID = sessionID;
          oldestUpdate = state.lastUpdated;
        }
      }
      if (!oldestID) return;
      this.states.delete(oldestID);
    }
  }

  private async serialize<T>(
    sessionID: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.operationTails.get(sessionID) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.operationTails.set(sessionID, tail);

    try {
      return await result;
    } finally {
      if (this.operationTails.get(sessionID) === tail) {
        this.operationTails.delete(sessionID);
      }
      this.evictOldestSessions();
    }
  }
}

export function createRuleDelivery(options: RuleDeliveryOptions): RuleDelivery {
  return new DefaultRuleDelivery(options);
}
