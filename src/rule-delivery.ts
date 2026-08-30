import {
  buildDurableDeliveryPart,
  buildRuleAdmissionPart,
  buildTransientDeliveryMessage,
  decodeRawHistory,
  decodeTransientPresence,
  type DeliveryLedgerFacts,
  type DeliveryPart,
  isTransientMessageId,
  ruleKeyFor,
} from './rule-delivery-codec.js';
import {
  type RawHistoryAdapter,
  type RawHistoryResult,
} from './rule-delivery-history.js';
import { createDebugLog, formatError, type DebugLog } from './debug.js';
import type { RuleLifetime } from './rule-filter.js';
import { BoundedSessionMap } from './bounded-session-map.js';

export interface RuleDelivery {
  deliverDurableTurn(input: DurableTurnInput): Promise<DurableTurnResult>;
  deliverTransientDispatch(input: TransientDispatchInput): void;
  retryPendingAdmissions(sessionID: string): Promise<void>;
  admitDurableMatches(
    input: DurableAdmissionInput
  ): Promise<DurableAdmissionResult>;
  markCompacted(sessionID: string): void;
  markHistoryChanged(sessionID: string): void;
  queueMatchedHooks(input: MatchedHooksInput): void;
}

export type DurableTurnResult = 'accepted' | 'deferred';
export type DurableAdmissionResult = 'accepted' | 'pending' | 'duplicate';

export interface MatchedRuleContent {
  identity?: string;
  relativePath: string;
  name?: string;
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

export interface DurableAdmissionInput {
  sessionID: string;
  rules: readonly MatchedRuleContent[];
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
  persistAdmission?: (sessionID: string, part: DeliveryPart) => Promise<void>;
  debugLog?: DebugLog;
  maxSessions?: number;
};

interface DeliveryState {
  ruleKeys: Set<string>;
  hookKeys: Set<string>;
  ledgerRevision: number;
  seededFromHistory: boolean;
  needsRescan: boolean;
  pendingHookQueue: MatchedHookContent[];
  pendingRuleQueue: MatchedRuleContent[];
  durableHookQueue: MatchedHookContent[];
  transientHookQueue: MatchedHookContent[];
  transientTurn:
    | {
        id: string;
        ruleKeys: Set<string>;
        hookKeys: Set<string>;
      }
    | undefined;
}

function deliveryKey(rule: MatchedRuleContent): string {
  return ruleKeyFor(rule.identity ?? rule.relativePath);
}

function hasDeliveryKey(
  keys: ReadonlySet<string>,
  rule: MatchedRuleContent
): boolean {
  return (
    keys.has(deliveryKey(rule)) ||
    (rule.identity !== undefined && keys.has(ruleKeyFor(rule.relativePath)))
  );
}

class DefaultRuleDelivery implements RuleDelivery {
  private readonly rawHistory: RawHistoryAdapter;
  private readonly debugLog: DebugLog;
  private readonly persistAdmission:
    ((sessionID: string, part: DeliveryPart) => Promise<void>) | undefined;
  private readonly states: BoundedSessionMap<DeliveryState>;
  private readonly operationTails = new Map<string, Promise<void>>();

  constructor(options: RuleDeliveryOptions) {
    this.rawHistory = options.rawHistory;
    this.debugLog = options.debugLog ?? createDebugLog();
    this.persistAdmission = options.persistAdmission;
    this.states = new BoundedSessionMap<DeliveryState>({
      // The bound never drains this store to empty.
      minBound: 1,
      max: options.maxSessions ?? 100,
      // Sessions with an in-flight operation are protected from eviction.
      isEvictable: sessionID => !this.operationTails.has(sessionID),
    });
  }

  async admitDurableMatches(
    input: DurableAdmissionInput
  ): Promise<DurableAdmissionResult> {
    return this.serialize(input.sessionID, async () => {
      const state = this.getState(input.sessionID);
      if (!state.seededFromHistory || state.needsRescan) {
        const facts = await this.decodeHistory(input.sessionID);
        if (!facts) {
          this.queuePendingRules(state, input.rules);
          return 'pending';
        }
        this.replaceLedger(state, facts);
        state.seededFromHistory = true;
        state.needsRescan = false;
      }

      const added = this.queuePendingRules(state, input.rules);
      if (!added && state.pendingRuleQueue.length === 0) return 'duplicate';
      return (await this.persistPendingRules(input.sessionID, state))
        ? 'accepted'
        : 'pending';
    });
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
    const newHookKeys = new Set<string>();
    const newRules: MatchedRuleContent[] = [];
    const newHooks: MatchedHookContent[] = [];
    for (const rule of input.matchedRules) {
      const key = deliveryKey(rule);
      if (hasDeliveryKey(state.ruleKeys, rule) || newRuleKeys.has(key))
        continue;
      newRuleKeys.add(key);
      newRules.push(rule);
    }

    for (const hook of state.durableHookQueue) {
      const key = deliveryKey(hook);
      if (hasDeliveryKey(state.hookKeys, hook) || newHookKeys.has(key))
        continue;
      newHookKeys.add(key);
      newHooks.push(hook);
    }

    if (newRules.length > 0 || newHooks.length > 0) {
      input.output.parts ??= [];
      input.output.parts.push(
        buildDurableDeliveryPart(newRules, newHooks, {
          sessionID: input.sessionID,
          messageID: input.messageID,
        })
      );
    }
    for (const key of newRuleKeys) state.ruleKeys.add(key);
    for (const key of newHookKeys) state.hookKeys.add(key);
    state.durableHookQueue = [];
    return 'accepted';
  }

  queueMatchedHooks(input: MatchedHooksInput): void {
    const state = this.getState(input.sessionID);
    for (const hook of input.hooks) {
      if (
        state.pendingHookQueue.some(
          pending =>
            (pending.identity ?? pending.relativePath) ===
            (hook.identity ?? hook.relativePath)
        ) ||
        state.durableHookQueue.some(
          pending =>
            (pending.identity ?? pending.relativePath) ===
            (hook.identity ?? hook.relativePath)
        ) ||
        state.transientHookQueue.some(
          pending =>
            (pending.identity ?? pending.relativePath) ===
            (hook.identity ?? hook.relativePath)
        )
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

      const {
        ids: presentIDs,
        ruleKeys: presentRuleKeys,
        hookKeys: presentHookKeys,
      } = decodeTransientPresence(input.messages);
      const realUserInfo = this.latestRealUserInfo(input.messages);
      const turnID =
        typeof realUserInfo?.id === 'string' ? realUserInfo.id : undefined;
      if (turnID && state.transientTurn?.id !== turnID) {
        state.transientTurn = {
          id: turnID,
          ruleKeys: new Set(),
          hookKeys: new Set(),
        };
      }
      const transientTurn = turnID ? state.transientTurn : undefined;
      if (transientTurn) {
        for (const key of presentRuleKeys) transientTurn.ruleKeys.add(key);
        for (const key of presentHookKeys) transientTurn.hookKeys.add(key);
      }

      const baseInfo =
        realUserInfo ?? input.messages[input.messages.length - 1]?.info ?? {};
      const transientRules: MatchedRuleContent[] = [];
      for (const rule of [...input.matchedRules, ...state.pendingRuleQueue]) {
        const key = deliveryKey(rule);
        if (
          hasDeliveryKey(state.ruleKeys, rule) ||
          hasDeliveryKey(presentRuleKeys, rule) ||
          (transientTurn !== undefined &&
            hasDeliveryKey(transientTurn.ruleKeys, rule))
        ) {
          continue;
        }
        presentRuleKeys.add(key);
        transientRules.push(rule);
      }

      const transientHooks: MatchedHookContent[] = [];
      for (const hook of [
        ...state.durableHookQueue,
        ...state.transientHookQueue,
      ]) {
        const key = deliveryKey(hook);
        if (
          hasDeliveryKey(presentHookKeys, hook) ||
          (transientTurn !== undefined &&
            hasDeliveryKey(transientTurn.hookKeys, hook))
        ) {
          continue;
        }
        presentHookKeys.add(key);
        transientHooks.push(hook);
      }

      if (transientRules.length > 0 || transientHooks.length > 0) {
        const transientMessage = buildTransientDeliveryMessage(
          transientRules,
          transientHooks,
          baseInfo
        );
        const part = transientMessage.parts[0];
        if (
          part &&
          !presentIDs.has(transientMessage.info.id) &&
          !presentIDs.has(part.id)
        ) {
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
          if (transientTurn) {
            for (const rule of transientRules) {
              transientTurn.ruleKeys.add(deliveryKey(rule));
            }
            for (const hook of transientHooks) {
              transientTurn.hookKeys.add(deliveryKey(hook));
            }
          }
        }
      }
      state.transientHookQueue = [];
    } catch (error) {
      this.debugLog(
        `Transient delivery failed for ${input.sessionID}: ${formatError(error)}`
      );
    }
  }

  async retryPendingAdmissions(sessionID: string): Promise<void> {
    await this.serialize(sessionID, async () => {
      const state = this.getState(sessionID);
      await this.persistPendingRules(sessionID, state);
    });
  }

  private queuePendingRules(
    state: DeliveryState,
    rules: readonly MatchedRuleContent[]
  ): boolean {
    let added = false;
    for (const rule of rules) {
      if (
        hasDeliveryKey(state.ruleKeys, rule) ||
        state.pendingRuleQueue.some(
          pending => deliveryKey(pending) === deliveryKey(rule)
        )
      ) {
        continue;
      }
      state.pendingRuleQueue.push(rule);
      added = true;
    }
    return added;
  }

  private async persistPendingRules(
    sessionID: string,
    state: DeliveryState
  ): Promise<boolean> {
    if (!this.persistAdmission || state.pendingRuleQueue.length === 0) {
      return state.pendingRuleQueue.length === 0;
    }
    const pending = state.pendingRuleQueue.filter(
      rule => !hasDeliveryKey(state.ruleKeys, rule)
    );
    if (pending.length === 0) {
      state.pendingRuleQueue = [];
      return true;
    }
    try {
      await this.persistAdmission(
        sessionID,
        buildRuleAdmissionPart(pending, sessionID)
      );
    } catch (error) {
      this.debugLog(
        `Rule admission persistence failed for ${sessionID}: ${formatError(error)}`
      );
      return false;
    }
    for (const rule of pending) state.ruleKeys.add(deliveryKey(rule));
    const accepted = new Set(pending.map(deliveryKey));
    state.pendingRuleQueue = state.pendingRuleQueue.filter(
      rule => !accepted.has(deliveryKey(rule))
    );
    return true;
  }

  markCompacted(sessionID: string): void {
    const state = this.getState(sessionID);
    state.ledgerRevision++;
    state.needsRescan = true;
    this.resetTransientTurn(state);
  }

  markHistoryChanged(sessionID: string): void {
    const state = this.getState(sessionID);
    state.ledgerRevision++;
    state.seededFromHistory = false;
    state.needsRescan = false;
    this.resetTransientTurn(state);
  }

  private replaceLedger(
    state: DeliveryState,
    facts: DeliveryLedgerFacts
  ): void {
    state.ruleKeys = new Set(facts.ruleKeys);
    state.hookKeys = new Set(facts.hookKeys);
    state.ledgerRevision++;
  }

  private routePendingHooks(state: DeliveryState): void {
    for (const hook of state.pendingHookQueue) {
      const ownerIsDurable = hasDeliveryKey(state.ruleKeys, hook);
      const queue =
        ownerIsDurable || hook.lifetime === 'durable'
          ? state.durableHookQueue
          : state.transientHookQueue;
      queue.push(hook);
    }
    state.pendingHookQueue = [];
  }

  private latestRealUserInfo(
    messages: readonly TransientDispatchMessage[]
  ): Record<string, unknown> | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
      const info = messages[index]?.info;
      if (!info || info.role !== 'user' || isTransientMessageId(info.id)) {
        continue;
      }
      return info;
    }
    return undefined;
  }

  private resetTransientTurn(state: DeliveryState): void {
    state.transientTurn = undefined;
  }

  private getState(sessionID: string): DeliveryState {
    return this.states.ensure(sessionID, () => ({
      ruleKeys: new Set(),
      hookKeys: new Set(),
      ledgerRevision: 0,
      seededFromHistory: false,
      needsRescan: false,
      pendingHookQueue: [],
      pendingRuleQueue: [],
      durableHookQueue: [],
      transientHookQueue: [],
      transientTurn: undefined,
    }));
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
      // Remove the tail entry before the eviction scan so this session is
      // no longer protected while it settles.
      if (this.operationTails.get(sessionID) === tail) {
        this.operationTails.delete(sessionID);
      }
      this.states.evict();
    }
  }
}

export function createRuleDelivery(options: RuleDeliveryOptions): RuleDelivery {
  return new DefaultRuleDelivery(options);
}
