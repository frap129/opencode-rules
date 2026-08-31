import {
  buildRuleAdmissionPart,
  decodeRawHistory,
  type DeliveryLedgerFacts,
  type DeliveryPart,
} from './rule-delivery-codec.js';
import {
  type RawHistoryAdapter,
  type RawHistoryResult,
} from './rule-delivery-history.js';
import { createDebugLog, formatError, type DebugLog } from '../shared/debug.js';
import type { MatchedRuleContent } from './rule-delivery.js';
import {
  deliveryKey,
  hasDeliveryKey,
  type DeliveryState,
} from './delivery-state.js';

type PersistAdmission = (
  sessionID: string,
  part: DeliveryPart
) => Promise<void>;

export class DeliveryLedger {
  private readonly rawHistory: RawHistoryAdapter;
  private readonly debugLog: DebugLog;
  private readonly persistAdmission: PersistAdmission | undefined;

  constructor(options: {
    rawHistory: RawHistoryAdapter;
    persistAdmission?: PersistAdmission | undefined;
    debugLog?: DebugLog | undefined;
  }) {
    this.rawHistory = options.rawHistory;
    this.debugLog = options.debugLog ?? createDebugLog();
    this.persistAdmission = options.persistAdmission;
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

  replaceLedger(state: DeliveryState, facts: DeliveryLedgerFacts): void {
    state.ruleKeys = new Set(facts.ruleKeys);
    state.hookKeys = new Set(facts.hookKeys);
    state.ledgerRevision++;
  }

  queuePendingRules(
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

  async persistPendingRules(
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
}
