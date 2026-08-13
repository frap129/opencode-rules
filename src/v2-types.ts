/**
 * Structural types for the OpenCode v2 plugin API.
 * Mirrors @opencode-ai/plugin@0.0.0-next-17335 payload shapes WITHOUT importing it,
 * confining beta API churn to this file plus the single cast in index.ts.
 */

export interface V2ModelRef {
  readonly id: string;
  readonly providerID: string;
  readonly variant?: string;
}

export interface V2SystemPart {
  readonly type: 'text';
  readonly text: string;
}

export type V2ContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool-call';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      readonly type: 'tool-result';
      readonly id: string;
      readonly name: string;
      readonly result: unknown;
    }
  | {
      readonly type: 'media';
      readonly mediaType: string;
      readonly data: unknown;
    }
  | { readonly type: 'reasoning'; readonly text: string };

export interface V2Message {
  readonly id?: string;
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: V2ContentPart[];
}

export interface V2SessionContext {
  readonly sessionID: string;
  readonly agent: string;
  readonly model: V2ModelRef;
  system: V2SystemPart[];
  messages: V2Message[];
  tools: Record<string, { description: string; input: unknown }>;
}

interface V2ToolExecuteBase {
  readonly tool: string;
  readonly sessionID: string;
  readonly agent: string;
  readonly messageID: string;
  readonly id: string;
}

export interface V2ToolExecuteBefore extends V2ToolExecuteBase {
  input: unknown;
}

export type V2ToolExecuteAfter = V2ToolExecuteBase & {
  readonly input: unknown;
} & (
    | {
        readonly status: 'completed';
        result: { output?: unknown; content?: unknown; metadata?: unknown };
      }
    | { readonly status: 'error'; error: unknown }
  );

export interface V2Registration {
  readonly dispose: () => Promise<void>;
}

export interface V2SessionApi {
  // Intentionally lossy vs @opencode-ai/plugin: real session.get returns Promise<SessionInfo>
  // with required location.directory and never undefined; kept defensive so callers must check.
  get(input: {
    sessionID: string;
  }): Promise<{ location?: { directory?: string } } | undefined>;
}

export type V2HookApi<Spec> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]) => Promise<void> | void
) => Promise<V2Registration>;

export interface V2PluginContext {
  readonly session: V2SessionApi & {
    hook: V2HookApi<{ context: V2SessionContext }>;
  };
  readonly tool: {
    hook: V2HookApi<{
      'execute.before': V2ToolExecuteBefore;
      'execute.after': V2ToolExecuteAfter;
    }>;
  };
}

export type V2Cleanup = () => Promise<void> | void;
