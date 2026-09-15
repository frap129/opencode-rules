import { extractConnectedMcpCapabilityIDs } from '../detection/mcp-tools.js';
import { logWarning } from '../shared/debug.js';
import type { DebugLog } from '../shared/debug.js';
import type { RawHistoryResult } from '../delivery/rule-delivery-history.js';
import type { DeliveryPart } from '../delivery/rule-delivery-codec.js';
import { fromSessionMessages } from '../session/v2-messages.js';

/**
 * Structural view of the opencode v2 client surface this plugin consumes.
 * The v2 plugin context IS the client (v1's `pluginInput.client` is gone),
 * so adapters receive the context object itself. Session history in v2 is
 * `session.context({ sessionID })` -> SessionMessageInfo[]; the v1
 * `session.messages` and `tool.ids` RPCs are gone.
 */
export interface OpenCodeClient {
  session?: {
    synthetic?: (input: {
      sessionID: string;
      id?: string;
      text: string;
      description?: string;
      metadata?: Record<string, unknown>;
      delivery?: 'steer' | 'queue';
      resume?: boolean;
    }) => Promise<unknown>;
    context?: (input: { sessionID: string }) => Promise<{ data?: unknown }>;
  };
  mcp?: {
    list?: (input?: {
      location?: { directory?: string; workspace?: string };
    }) => Promise<{ data?: unknown }>;
  };
}

export class OpenCodeClientAdapter {
  private readonly client: OpenCodeClient;
  private readonly directory: string;
  private readonly debugLog: DebugLog;

  constructor(options: {
    client: OpenCodeClient;
    directory: string;
    debugLog: DebugLog;
  }) {
    this.client = options.client;
    this.directory = options.directory;
    this.debugLog = options.debugLog;
  }

  // Awaited no-reply admission: v2 session.synthetic with resume:false
  // never generates an assistant reply or wakes an idle session, and
  // without a description the admitted message stays hidden from the UI
  // (session.prompt always admits a visible `user` message). Invoked as a
  // method so prototype-style SDK methods keep their `this` receiver.
  async persistRuleAdmission(
    sessionID: string,
    part: DeliveryPart
  ): Promise<void> {
    const session = this.client.session;
    if (
      !session?.synthetic ||
      part.type !== 'text' ||
      typeof part.text !== 'string'
    ) {
      throw new Error('OpenCode session.synthetic is unavailable');
    }
    await session.synthetic({
      ...(typeof part.messageID === 'string' ? { id: part.messageID } : {}),
      sessionID,
      text: part.text,
      ...(part.metadata ? { metadata: part.metadata } : {}),
      resume: false,
    });
  }

  async readClientHistory(sessionID: string): Promise<RawHistoryResult> {
    const session = this.client.session;
    if (!session?.context) return { ok: true, messages: [] };
    try {
      const result = await session.context({ sessionID });
      const data = result?.data;
      if (!Array.isArray(data)) return { ok: true, messages: [] };
      return { ok: true, messages: fromSessionMessages(data) };
    } catch (error) {
      logWarning('Failed to fetch session history', error);
      return { ok: false };
    }
  }

  async queryAvailableToolIDs(
    contextToolIDs?: readonly string[]
  ): Promise<string[]> {
    const ids = new Set<string>();

    // v2 removed the tool.ids RPC; the session context hook's tool table is
    // the source of truth for available built-in tools.
    if (contextToolIDs) {
      for (const id of contextToolIDs) {
        ids.add(id);
      }
      if (contextToolIDs.length > 0) {
        this.debugLog(
          `Available tools from session context: ${contextToolIDs
            .slice(0, 10)
            .join(
              ', '
            )}${contextToolIDs.length > 10 ? '...' : ''} (${contextToolIDs.length} total)`
        );
      }
    }

    const mcpPromise = this.client.mcp?.list?.({
      location: { directory: this.directory },
    });
    const [mcpResult] = await Promise.allSettled([mcpPromise] as const);

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

    if (mcpResult.status === 'fulfilled' && mcpResult.value) {
      const mcpIds = extractConnectedMcpCapabilityIDs(
        mcpResult.value.data as unknown
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
