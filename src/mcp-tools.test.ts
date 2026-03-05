import { describe, it, expect } from 'vitest';
import { extractConnectedMcpCapabilityIDs } from './mcp-tools.js';
import * as mcpTools from './mcp-tools.js';

describe('mcp-tools runtime exports', () => {
  it('exports only extractConnectedMcpCapabilityIDs at runtime', () => {
    const exportedKeys = Object.keys(mcpTools).sort();
    expect(exportedKeys).toEqual(['extractConnectedMcpCapabilityIDs']);
  });
});

describe('extractConnectedMcpCapabilityIDs', () => {
  it('returns mcp_<sanitizedName> for connected servers', () => {
    const status = {
      context7: { status: 'connected' },
      'my server': { status: 'connected' },
      disabled: { status: 'disabled' },
      disconnected: { status: 'disconnected' },
    };

    expect(extractConnectedMcpCapabilityIDs(status)).toEqual([
      'mcp_context7',
      'mcp_my_server',
    ]);
  });

  it('returns [] for null/undefined/non-object', () => {
    expect(extractConnectedMcpCapabilityIDs(null)).toEqual([]);
    expect(extractConnectedMcpCapabilityIDs(undefined)).toEqual([]);
    expect(extractConnectedMcpCapabilityIDs('nope' as any)).toEqual([]);
  });

  it('ignores entries without status.connected', () => {
    const status = { context7: { status: 'failed' } };
    expect(extractConnectedMcpCapabilityIDs(status)).toEqual([]);
  });
});
