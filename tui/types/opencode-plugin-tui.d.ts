// tui/types/opencode-plugin-tui.d.ts
//
// Vendored type declarations for @opencode-ai/plugin/tui.
// Allows tsc to compile TUI code without requiring the optional
// peer dependency to be installed at compile time.
//
// Source: @opencode-ai/plugin v1.3.7 (packages/plugin/src/tui.ts)
// If bumping @opencode-ai/plugin, re-verify these types match.

declare module '@opencode-ai/plugin/tui' {
  export interface TuiTheme {
    [key: string]: unknown;
  }

  export interface TuiSlotMap {
    sidebar_content: { session_id: string };
  }

  export interface TuiSlotContext {
    theme: TuiTheme;
  }

  export type SlotRenderer<K extends keyof TuiSlotMap> = (
    ctx: Readonly<TuiSlotContext>,
    props: TuiSlotMap[K]
  ) => JSX.Element;

  export interface TuiSlotPlugin {
    id?: never;
    order?: number;
    setup?: (ctx: Readonly<TuiSlotContext>, renderer: unknown) => void;
    dispose?: () => void;
    slots: {
      [K in keyof TuiSlotMap]?: SlotRenderer<K>;
    };
  }

  export interface TuiSlots {
    register: (plugin: TuiSlotPlugin) => string;
  }

  export interface TuiWorkspace {
    current: () => string | undefined;
    set: (id?: string) => void;
  }

  export interface TuiState {
    readonly path: {
      state: string;
      config: string;
      worktree: string;
      directory: string;
    };
    workspace: {
      get: (id: string) => { directory: string | null } | undefined;
    };
  }

  export interface TuiEventBus {
    on: (
      type: string,
      handler: (event: {
        type: string;
        properties: Record<string, unknown>;
      }) => void
    ) => () => void;
  }

  export interface TuiPluginApi {
    slots: TuiSlots;
    workspace: TuiWorkspace;
    state: TuiState;
    kv: unknown;
    event: TuiEventBus;
  }

  export type TuiPlugin = (api: TuiPluginApi) => Promise<void> | void;
}
