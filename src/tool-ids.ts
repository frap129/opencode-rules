/**
 * Derive `mcp_<server>` capability-ID candidates from a V2 tool key.
 * V2 tools are keyed `<sanitized-server>_<tool>` with no server boundary marker,
 * so every proper underscore prefix is offered as a candidate. This preserves
 * V1 rule files that declare server-level conditions like `tools: [mcp_context7]`.
 */
export function deriveMcpServerCandidates(toolKey: string): string[] {
  const segments = toolKey.split('_');
  if (segments.length < 2 || segments[0] === '') return [];
  const candidates: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    candidates.push(`mcp_${segments.slice(0, i).join('_')}`);
  }
  return candidates;
}

/** Expand a set of tool keys into filter-context tool IDs (raw keys + mcp candidates). */
export function expandToolKeys(keys: string[]): string[] {
  const ids = new Set<string>();
  for (const key of keys) {
    ids.add(key);
    for (const candidate of deriveMcpServerCandidates(key)) {
      ids.add(candidate);
    }
  }
  return Array.from(ids);
}
