export type DebugLog = (message: string) => void;

export function createDebugLog(prefix = '[opencode-rules]'): DebugLog {
  return (message: string): void => {
    if (process.env.OPENCODE_RULES_DEBUG) {
      console.debug(`${prefix} ${message}`);
    }
  };
}

/** Format an unknown error value into a human-readable message. */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Log a warning with the standard opencode-rules prefix. */
export function logWarning(context: string, error: unknown): void {
  console.warn(`[opencode-rules] Warning: ${context}: ${formatError(error)}`);
}
