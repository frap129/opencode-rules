const DEBUG_ENABLED = Boolean(process.env.OPENCODE_RULES_DEBUG);

export type DebugLog = (message: string) => void;

export function createDebugLog(prefix = '[opencode-rules]'): DebugLog {
  return (message: string): void => {
    if (DEBUG_ENABLED) {
      console.debug(`${prefix} ${message}`);
    }
  };
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logWarning(context: string, error: unknown): void {
  if (!DEBUG_ENABLED) return;
  console.warn(`[opencode-rules] Warning: ${context}: ${formatError(error)}`);
}

export function logError(context: string, error: unknown): void {
  if (!DEBUG_ENABLED) return;
  console.error(`[opencode-rules] ${context}:`, error);
}
