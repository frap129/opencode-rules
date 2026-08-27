import {
  decodeRawHistory,
  type DeliveryLedgerFacts,
} from './rule-delivery-codec.js';
import {
  type RawHistoryAdapter,
  type RawHistoryResult,
} from './rule-delivery-history.js';
import { createDebugLog, formatError, type DebugLog } from './debug.js';

export interface RuleDelivery {
  decodeHistory(sessionID: string): Promise<DeliveryLedgerFacts | undefined>;
}

type RuleDeliveryOptions = {
  rawHistory: RawHistoryAdapter;
  debugLog?: DebugLog;
};

class DefaultRuleDelivery implements RuleDelivery {
  private readonly rawHistory: RawHistoryAdapter;
  private readonly debugLog: DebugLog;

  constructor(options: RuleDeliveryOptions) {
    this.rawHistory = options.rawHistory;
    this.debugLog = options.debugLog ?? createDebugLog();
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
}

export function createRuleDelivery(options: RuleDeliveryOptions): RuleDelivery {
  return new DefaultRuleDelivery(options);
}
