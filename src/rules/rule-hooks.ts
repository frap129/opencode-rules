import type { RuleHook } from './rule-metadata.js';

export interface HookEvaluationContext {
  toolName: string;
  serializedArgs: string;
  hookType: 'PreToolUse' | 'PostToolUse';
}

export function serializeToolArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args);
}

export function evaluateHooks(
  hooks: RuleHook[],
  context: HookEvaluationContext
): RuleHook[] {
  return hooks.filter(h => {
    if (h.type !== context.hookType) return false;
    if (h.tool !== '*' && h.tool !== context.toolName) return false;
    try {
      const regex = new RegExp(h.match);
      return regex.test(context.serializedArgs);
    } catch {
      return false;
    }
  });
}
