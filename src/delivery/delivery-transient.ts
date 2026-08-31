import {
  buildTransientDeliveryMessage,
  decodeTransientPresence,
  isTransientMessageId,
} from './rule-delivery-codec.js';
import type {
  MatchedHookContent,
  MatchedRuleContent,
  TransientDispatchInput,
  TransientDispatchMessage,
} from './rule-delivery.js';
import {
  deliveryKey,
  hasDeliveryKey,
  type DeliveryState,
} from './delivery-state.js';

export class TransientDispatcher {
  append(input: TransientDispatchInput, state: DeliveryState): void {
    const {
      ids: presentIDs,
      ruleKeys: presentRuleKeys,
      hookKeys: presentHookKeys,
    } = decodeTransientPresence(input.messages);
    const realUserInfo = latestRealUserInfo(input.messages);
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
  }
}

function latestRealUserInfo(
  messages: readonly TransientDispatchMessage[]
): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const info: unknown = messages[index]?.info;
    if (
      !info ||
      (info as { role?: unknown }).role !== 'user' ||
      isTransientMessageId((info as { id?: unknown }).id)
    ) {
      continue;
    }
    return info as Record<string, unknown>;
  }
  return undefined;
}
