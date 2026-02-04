export interface McpStatusMap {
  [clientName: string]: { status?: string } | undefined;
}

export function sanitizeMcpClientName(name: string): string {
  throw new Error('Not implemented');
}

export function extractConnectedMcpCapabilityIDs(
  _status: McpStatusMap | null | undefined
): string[] {
  throw new Error('Not implemented');
}
