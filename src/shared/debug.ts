const DEBUG_ENABLED = Boolean(process.env.OPENCODE_RULES_DEBUG);

export type DebugLog = (message: string) => void;

export function createDebugLog(prefix = '[opencode-rules]'): DebugLog {
  return (message: string): void => {
    if (DEBUG_ENABLED) {
      console.debug(`${prefix} ${message}`);
    }
  };
}

// Never returns an empty string: blank messages, silent non-Error values, and
// unserializable shapes fall back to name, serialization, or a placeholder so
// failure logs always carry actionable information. Depth-capped against
// circular cause chains.
export function formatError(error: unknown): string {
  return formatNested(error, 0);
}

function formatNested(error: unknown, depth: number): string {
  if (!(error instanceof Error)) return stringifyUnknown(error);
  const message = error.message.trim();
  const named = error.name && error.name !== 'Error' ? error.name : '';
  const base = message
    ? named
      ? `${named}: ${message}`
      : message
    : `${named || 'Error'} with no message`;
  if (depth < 4 && error.cause !== undefined && error.cause !== null) {
    return `${base} (caused by ${formatNested(error.cause, depth + 1)})`;
  }
  return base;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value === '' ? '""' : value;
  if (typeof value !== 'object' || value === null) return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (caught) {
    return `unserializable object (${formatNested(caught, 0)})`;
  }
}

export function logWarning(context: string, error: unknown): void {
  if (!DEBUG_ENABLED) return;
  console.warn(`[opencode-rules] Warning: ${context}: ${formatError(error)}`);
}

export function logError(context: string, error: unknown): void {
  if (!DEBUG_ENABLED) return;
  console.error(`[opencode-rules] ${context}:`, error);
}
