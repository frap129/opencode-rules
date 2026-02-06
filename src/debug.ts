export type DebugLog = (message: string) => void;

export function createDebugLog(prefix = '[opencode-rules]'): DebugLog {
  return (message: string): void => {
    if (process.env.OPENCODE_RULES_DEBUG) {
      console.debug(`${prefix} ${message}`);
    }
  };
}
