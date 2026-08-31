import { extractConnectedMcpCapabilityIDs } from '../detection/mcp-tools.js';
import { logWarning } from '../shared/debug.js';
import type { DebugLog } from '../shared/debug.js';
import type { RawHistoryResult } from '../delivery/rule-delivery-history.js';
import type { DeliveryPart } from '../delivery/rule-delivery-codec.js';

export interface OpenCodeClient {
  tool?: {
    ids?: (args: {
      query: { directory: string };
    }) => Promise<{ data: string[] }>;
  };
  mcp?: {
    status?: (args: {
      query: { directory: string };
    }) => Promise<{ connected?: Array<{ id: string }> }>;
  };
  session?: {
    messages?: (args: {
      path: { id: string };
      query?: { directory?: string };
    }) => Promise<{ data?: Array<{ info?: unknown; parts?: unknown[] }> }>;
    prompt?: (args: {
      path: { id: string };
      query?: { directory?: string };
      body: {
        messageID?: string;
        noReply: boolean;
        parts: Array<{
          id?: string;
          type: 'text';
          text: string;
          synthetic?: boolean;
          metadata?: Record<string, unknown>;
        }>;
      };
    }) => Promise<unknown>;
  };
}

export class OpenCodeClientAdapter {
  private readonly client: OpenCodeClient;
  private readonly directory: string;
  private readonly projectDirectory: string;
  private readonly debugLog: DebugLog;

  constructor(options: {
    client: OpenCodeClient;
    directory: string;
    projectDirectory: string;
    debugLog: DebugLog;
  }) {
    this.client = options.client;
    this.directory = options.directory;
    this.projectDirectory = options.projectDirectory;
    this.debugLog = options.debugLog;
  }

  async persistRuleAdmission(
    sessionID: string,
    part: DeliveryPart
  ): Promise<void> {
    const prompt = this.client.session?.prompt;
    if (!prompt || part.type !== 'text' || typeof part.text !== 'string') {
      throw new Error('OpenCode session.prompt is unavailable');
    }
    await prompt({
      path: { id: sessionID },
      query: { directory: this.projectDirectory },
      body: {
        ...(typeof part.messageID === 'string'
          ? { messageID: part.messageID }
          : {}),
        noReply: true,
        parts: [
          {
            ...(typeof part.id === 'string' ? { id: part.id } : {}),
            type: 'text',
            text: part.text,
            synthetic: true,
            ...(part.metadata ? { metadata: part.metadata } : {}),
          },
        ],
      },
    });
  }

  async readClientHistory(sessionID: string): Promise<RawHistoryResult> {
    const session = this.client.session;
    if (!session?.messages) return { ok: true, messages: [] };
    try {
      const result = await session.messages({
        path: { id: sessionID },
        query: { directory: this.directory },
      });
      return { ok: true, messages: result?.data ?? [] };
    } catch (error) {
      logWarning('Failed to fetch session history', error);
      return { ok: false };
    }
  }

  async queryAvailableToolIDs(): Promise<string[]> {
    const ids = new Set<string>();
    const query = { directory: this.directory };

    const toolPromise = this.client.tool?.ids?.({ query });
    const mcpPromise = this.client.mcp?.status?.({ query });

    const [toolResult, mcpResult] = await Promise.allSettled([
      toolPromise,
      mcpPromise,
    ] as const);

    const logSettledError = (
      label: string,
      result: PromiseRejectedResult
    ): void => {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      logWarning(`Failed to query ${label}`, message);
    };

    if (
      toolResult.status === 'fulfilled' &&
      Array.isArray(toolResult.value?.data)
    ) {
      for (const id of toolResult.value.data) {
        ids.add(id);
      }
      this.debugLog(
        `Built-in tools: ${toolResult.value.data.slice(0, 10).join(', ')}${toolResult.value.data.length > 10 ? '...' : ''} (${toolResult.value.data.length} total)`
      );
    } else if (toolResult.status === 'rejected') {
      logSettledError('tool IDs', toolResult);
    }

    if (
      mcpResult.status === 'fulfilled' &&
      mcpResult.value &&
      'data' in mcpResult.value
    ) {
      const mcpIds = extractConnectedMcpCapabilityIDs(
        mcpResult.value.data as Record<string, { status?: string }>
      );
      for (const id of mcpIds) {
        ids.add(id);
      }
      if (mcpIds.length > 0) {
        this.debugLog(`MCP capability IDs: ${mcpIds.join(', ')}`);
      }
    } else if (mcpResult.status === 'rejected') {
      logSettledError('MCP status', mcpResult);
    }

    return Array.from(ids);
  }
}
