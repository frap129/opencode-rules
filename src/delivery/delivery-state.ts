import { BoundedSessionMap } from '../shared/bounded-session-map.js';
import { ruleKeyFor } from './rule-delivery-codec.js';
import type {
  MatchedHookContent,
  MatchedRuleContent,
} from './rule-delivery.js';

export interface DeliveryState {
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

export function createDeliveryState(): DeliveryState {
  return {
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
  };
}

export function deliveryKey(rule: MatchedRuleContent): string {
  return ruleKeyFor(rule.identity ?? rule.relativePath);
}

export function hasDeliveryKey(
  keys: ReadonlySet<string>,
  rule: MatchedRuleContent
): boolean {
  return (
    keys.has(deliveryKey(rule)) ||
    (rule.identity !== undefined && keys.has(ruleKeyFor(rule.relativePath)))
  );
}

export class DeliveryStateStore {
  private readonly states: BoundedSessionMap<DeliveryState>;
  private readonly operationTails = new Map<string, Promise<void>>();

  constructor(maxSessions: number | undefined) {
    this.states = new BoundedSessionMap<DeliveryState>({
      minBound: 1,
      max: maxSessions ?? 100,
      isEvictable: sessionID => !this.operationTails.has(sessionID),
    });
  }

  getState(sessionID: string): DeliveryState {
    return this.states.ensure(sessionID, createDeliveryState);
  }

  async serialize<T>(
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
      // Deleting the tail before evicting unprotects this session in the
      // same settle path.
      if (this.operationTails.get(sessionID) === tail) {
        this.operationTails.delete(sessionID);
      }
      this.states.evict();
    }
  }
}
