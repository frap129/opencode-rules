export interface McpStatusMap {
  [clientName: string]: { status?: string } | undefined;
}

export function sanitizeMcpClientName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function extractConnectedMcpCapabilityIDs(
  status: McpStatusMap | null | undefined
): string[] {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return [];

  const out: string[] = [];
  for (const [clientName, clientStatus] of Object.entries(status)) {
    if (clientStatus?.status === 'connected') {
      const sanitized = sanitizeMcpClientName(clientName);
      if (sanitized) {
        out.push(`mcp_${sanitized}`);
      }
    }
  }
  return out;
}
