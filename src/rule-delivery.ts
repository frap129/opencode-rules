import {
  buildHookInjectionPart,
  buildRulePart,
  decodeRawHistory,
  type DeliveryLedgerFacts,
  type DeliveryPart,
  hashContent,
  ruleKeyFor,
} from './rule-delivery-codec.js';
import {
  type RawHistoryAdapter,
  type RawHistoryResult,
} from './rule-delivery-history.js';
import { createDebugLog, formatError, type DebugLog } from './debug.js';

export interface RuleDelivery {
  decodeHistory(sessionID: string): Promise<DeliveryLedgerFacts | undefined>;
  deliverDurableTurn(input: DurableTurnInput): Promise<DurableTurnResult>;
  queueMatchedHooks(input: MatchedHooksInput): void;
}

export type DurableTurnResult = 'accepted' | 'deferred';

export interface DurableMatchedRule {
  relativePath: string;
  content: string;
}

export interface DurableTurnOutput {
  parts?: DeliveryPart[];
}

export interface DurableTurnInput {
  sessionID: string;
  messageID?: string;
  matchedRules: readonly DurableMatchedRule[];
  output: DurableTurnOutput;
}

export interface MatchedHookContent {
  content: string;
  lifetime: 'durable' | 'ephemeral';
}

export interface MatchedHooksInput {
  sessionID: string;
  hooks: readonly MatchedHookContent[];
}

type RuleDeliveryOptions = {
  rawHistory: RawHistoryAdapter;
  debugLog?: DebugLog;
  maxSessions?: number;
};

interface DeliveryState {
  ruleKeys: Set<string>;
  hookHashes: Set<string>;
  seededFromHistory: boolean;
  needsRescan: boolean;
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

  async decodeHistory(
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
      const facts = await this.decodeHistory(input.sessionID);
      if (!facts) {
        state.needsRescan = true;
        return 'deferred';
      }
      state.ruleKeys = new Set(facts.ruleKeys);
      state.hookHashes = new Set(facts.hookHashes);
      state.seededFromHistory = true;
    }

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
        ...buildHookInjectionPart(content),
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
      const queue =
        hook.lifetime === 'durable'
          ? state.durableHookQueue
          : state.transientHookQueue;
      if (!queue.includes(hook.content)) queue.push(hook.content);
    }
  }

  private getState(sessionID: string): DeliveryState {
    let state = this.states.get(sessionID);
    if (!state) {
      state = {
        ruleKeys: new Set(),
        hookHashes: new Set(),
        seededFromHistory: false,
        needsRescan: false,
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
