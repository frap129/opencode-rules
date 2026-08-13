import { describe, it, expect } from 'vitest';
import { deriveMcpServerCandidates, expandToolKeys } from './tool-ids.js';

describe('deriveMcpServerCandidates', () => {
  it('derives server candidate for a simple MCP tool key', () => {
    expect(deriveMcpServerCandidates('context7_search')).toEqual([
      'mcp_context7',
    ]);
  });

  it('derives all prefix candidates for multi-segment keys', () => {
    expect(deriveMcpServerCandidates('my_server_search')).toEqual([
      'mcp_my',
      'mcp_my_server',
    ]);
  });

  it('returns empty for keys without underscore', () => {
    expect(deriveMcpServerCandidates('read')).toEqual([]);
  });

  it('returns empty for empty key', () => {
    expect(deriveMcpServerCandidates('')).toEqual([]);
  });
});

describe('expandToolKeys', () => {
  it('keeps raw keys and adds mcp candidates', () => {
    expect(expandToolKeys(['read', 'context7_search'])).toEqual([
      'read',
      'context7_search',
      'mcp_context7',
    ]);
  });

  it('deduplicates', () => {
    expect(expandToolKeys(['context7_search', 'context7_search'])).toEqual([
      'context7_search',
      'mcp_context7',
    ]);
  });

  it('returns empty for empty input', () => {
    expect(expandToolKeys([])).toEqual([]);
  });
});
