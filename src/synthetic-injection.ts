/**
 * Compatibility facade for the delivery codec during the runtime migration.
 * The runtime still imports this path until the host-hook migration is complete.
 */
export {
  buildHookInjectionPart,
  buildRulePart,
  buildTransientHookMessage,
  buildTransientRuleMessage,
  decodeRawHistory,
  hashContent,
  isTransientMessageId,
  ruleKeyFor,
} from './rule-delivery-codec.js';
export type {
  DeliveryLedgerFacts as InjectedPartsScan,
  DeliveryPart,
  SyntheticPart,
  TransientMessage as TransientHookMessage,
} from './rule-delivery-codec.js';
export { decodeRawHistory as scanInjectedParts } from './rule-delivery-codec.js';
