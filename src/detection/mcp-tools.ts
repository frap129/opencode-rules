function sanitizeMcpClientName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// v2 mcp.list() returns McpServer[]; each server's status is a tagged object.
function connectedServerName(server: unknown): string | undefined {
  if (server === null || typeof server !== 'object') return undefined;
  const record = server as { name?: unknown; status?: unknown };
  const status = record.status;
  if (status === null || typeof status !== 'object') return undefined;
  if ((status as { status?: unknown }).status !== 'connected') return undefined;
  if (typeof record.name !== 'string' || record.name.length === 0) {
    return undefined;
  }
  return record.name;
}

export function extractConnectedMcpCapabilityIDs(servers: unknown): string[] {
  if (!Array.isArray(servers)) return [];
  const capabilityIDs: string[] = [];
  for (const server of servers) {
    const name = connectedServerName(server);
    if (name === undefined) continue;
    const sanitized = sanitizeMcpClientName(name);
    if (sanitized) {
      capabilityIDs.push(`mcp_${sanitized}`);
    }
  }
  return capabilityIDs;
}
