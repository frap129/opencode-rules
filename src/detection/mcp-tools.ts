interface McpStatusMap {
  [clientName: string]: { status?: string } | undefined;
}

// v2 mcp.list() shape: McpServer[] tagged by a `status` field.
interface McpServerStatusList {
  name?: unknown;
  status?: unknown;
}

function sanitizeMcpClientName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function serverStatusTag(server: unknown): unknown {
  if (server === null || typeof server !== 'object') return undefined;
  return (server as { status?: unknown }).status;
}

function fromStatusList(servers: readonly unknown[]): string[] {
  const capabilityIDs: string[] = [];
  for (const server of servers) {
    const status = serverStatusTag(server);
    // v2 tags McpServer.status as an object ({ status: 'connected' }); the
    // plain-string form is accepted defensively.
    const statusValue =
      status !== null && typeof status === 'object'
        ? (status as { status?: unknown }).status
        : status;
    if (statusValue !== 'connected') continue;
    const name = (server as McpServerStatusList).name;
    if (typeof name !== 'string' || name.length === 0) continue;
    const sanitized = sanitizeMcpClientName(name);
    if (sanitized) {
      capabilityIDs.push(`mcp_${sanitized}`);
    }
  }
  return capabilityIDs;
}

// Accepts both the v1 map form and the v2 McpServer[] form so the legacy
// map path keeps working where it is still supplied.
export function extractConnectedMcpCapabilityIDs(status: unknown): string[] {
  if (!status || typeof status !== 'object') return [];
  if (Array.isArray(status)) return fromStatusList(status);
  if (Array.isArray((status as { data?: unknown }).data)) {
    return fromStatusList((status as { data: readonly unknown[] }).data);
  }
  const statusMap = status as McpStatusMap;

  const capabilityIDs: string[] = [];
  for (const [clientName, clientStatus] of Object.entries(statusMap)) {
    if (clientStatus?.status === 'connected') {
      const sanitized = sanitizeMcpClientName(clientName);
      if (sanitized) {
        capabilityIDs.push(`mcp_${sanitized}`);
      }
    }
  }
  return capabilityIDs;
}
