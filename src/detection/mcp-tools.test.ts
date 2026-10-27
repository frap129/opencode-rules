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
    const servers = [
      { name: 'context7', status: { status: 'connected' } },
      { name: 'my server', status: { status: 'connected' } },
      { name: 'disabled', status: { status: 'disabled' } },
      { name: 'disconnected', status: { status: 'disconnected' } },
    ];

    expect(extractConnectedMcpCapabilityIDs(servers)).toEqual([
      'mcp_context7',
      'mcp_my_server',
    ]);
  });

  it('returns [] for null/undefined/non-array', () => {
    expect(extractConnectedMcpCapabilityIDs(null)).toEqual([]);
    expect(extractConnectedMcpCapabilityIDs(undefined)).toEqual([]);
    expect(extractConnectedMcpCapabilityIDs('nope')).toEqual([]);
  });

  it('ignores entries without a connected status tag', () => {
    const servers = [
      { name: 'failed', status: { status: 'failed' } },
      { name: 'plain', status: 'connected' },
    ];
    expect(extractConnectedMcpCapabilityIDs(servers)).toEqual([]);
  });
});
