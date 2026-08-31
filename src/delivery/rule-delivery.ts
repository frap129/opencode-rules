import {
  buildDurableDeliveryPart,
  decodeRawHistory,
  type DeliveryPart,
} from './rule-delivery-codec.js';
import { type RawHistoryAdapter } from './rule-delivery-history.js';
import { createDebugLog, formatError, type DebugLog } from '../shared/debug.js';
import type { RuleLifetime } from '../rules/rule-filter.js';
import {
  deliveryKey,
  hasDeliveryKey,
  type DeliveryState,
  DeliveryStateStore,
} from './delivery-state.js';
import { DeliveryLedger } from './delivery-ledger.js';
import { TransientDispatcher } from './delivery-transient.js';

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

class DefaultRuleDelivery implements RuleDelivery {
  private readonly debugLog: DebugLog;
  private readonly states: DeliveryStateStore;
  private readonly ledger: DeliveryLedger;
  private readonly transientDispatcher: TransientDispatcher;

  constructor(options: RuleDeliveryOptions) {
    this.debugLog = options.debugLog ?? createDebugLog();
    this.states = new DeliveryStateStore(options.maxSessions);
    this.ledger = new DeliveryLedger({
      rawHistory: options.rawHistory,
      persistAdmission: options.persistAdmission,
      debugLog: this.debugLog,
    });
    this.transientDispatcher = new TransientDispatcher();
  }

  async admitDurableMatches(
    input: DurableAdmissionInput
  ): Promise<DurableAdmissionResult> {
    return this.states.serialize(input.sessionID, async () => {
      const state = this.states.getState(input.sessionID);
      if (
        state.needsRescan ||
        !(await this.seedFromHistory(input.sessionID, state))
      ) {
        this.ledger.queuePendingRules(state, input.rules);
        return 'pending';
      }

      const added = this.ledger.queuePendingRules(state, input.rules);
      if (!added && state.pendingRuleQueue.length === 0) return 'duplicate';
      return (await this.ledger.persistPendingRules(input.sessionID, state))
        ? 'accepted'
        : 'pending';
    });
  }

  /**
   * Seeds the ledger from live history when stale. Returns false when
   * history is unreadable, which callers treat as "still pending".
   * Compaction leaves needsRescan set: the caller defers, because a
   * mid-read revision bump cannot be retried from here.
   */
  private async seedFromHistory(
    sessionID: string,
    state: DeliveryState,
    source?: TransientDispatchMessage[]
  ): Promise<boolean> {
    if (state.seededFromHistory && !state.needsRescan) return true;
    const facts = source
      ? decodeRawHistory(source)
      : await this.ledger.decodeHistory(sessionID);
    if (!facts) {
      state.needsRescan = true;
      return false;
    }
    this.ledger.replaceLedger(state, facts);
    state.seededFromHistory = true;
    state.needsRescan = false;
    return true;
  }

  async deliverDurableTurn(
    input: DurableTurnInput
  ): Promise<DurableTurnResult> {
    return this.states.serialize(input.sessionID, async () => {
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
    const state = this.states.getState(input.sessionID);
    if (state.needsRescan) return 'deferred';

    if (!state.seededFromHistory) {
      // Compaction may bump the revision while history reads; a stale
      // decode must not clobber the newer ledger.
      const ledgerRevision = state.ledgerRevision;
      const facts = await this.ledger.decodeHistory(input.sessionID);
      if (!facts) {
        state.needsRescan = true;
        return 'deferred';
      }
      if (state.ledgerRevision !== ledgerRevision) return 'deferred';
      this.ledger.replaceLedger(state, facts);
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
    const state = this.states.getState(input.sessionID);
    const queueIdentity = (hook: MatchedRuleContent): string =>
      hook.identity ?? hook.relativePath;
    for (const hook of input.hooks) {
      const identity = queueIdentity(hook);
      if (
        [
          ...state.pendingHookQueue,
          ...state.durableHookQueue,
          ...state.transientHookQueue,
        ].some(pending => queueIdentity(pending) === identity)
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
      const state = this.states.getState(input.sessionID);
      this.seedFromHistory(input.sessionID, state, input.messages);
      this.routePendingHooks(state);

      const target = input.messages[input.messages.length - 1];
      if (!target || !Array.isArray(target.parts)) return;

      this.transientDispatcher.append(input, state);
    } catch (error) {
      this.debugLog(
        `Transient delivery failed for ${input.sessionID}: ${formatError(error)}`
      );
    }
  }

  async retryPendingAdmissions(sessionID: string): Promise<void> {
    await this.states.serialize(sessionID, async () => {
      const state = this.states.getState(sessionID);
      await this.ledger.persistPendingRules(sessionID, state);
    });
  }

  markCompacted(sessionID: string): void {
    const state = this.states.getState(sessionID);
    state.ledgerRevision++;
    state.needsRescan = true;
    state.transientTurn = undefined;
  }

  markHistoryChanged(sessionID: string): void {
    const state = this.states.getState(sessionID);
    state.ledgerRevision++;
    state.seededFromHistory = false;
    state.needsRescan = false;
    state.transientTurn = undefined;
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
}

export function createRuleDelivery(options: RuleDeliveryOptions): RuleDelivery {
  return new DefaultRuleDelivery(options);
}
