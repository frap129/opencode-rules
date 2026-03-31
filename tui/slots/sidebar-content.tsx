// tui/slots/sidebar-content.tsx
/** @jsxImportSource @opentui/solid */
import {
  createSignal,
  createEffect,
  createMemo,
  Show,
  For,
  type JSX,
} from 'solid-js';
import type { TuiPluginApi, TuiTheme } from '@opencode-ai/plugin/tui';
import { loadSidebarRules, type SidebarRuleEntry } from '../data/rules.js';

interface SidebarContentProps {
  sessionId: string;
  api: TuiPluginApi;
  theme: TuiTheme;
}

const SINGLE_BORDER = { type: 'single' } as any;

type PaletteColor = import('@opentui/core').RGBA | string;

interface Palette {
  panel: PaletteColor;
  surface: PaletteColor;
  text: PaletteColor;
  muted: PaletteColor;
  accent: PaletteColor;
}

function getPalette(theme: TuiTheme): Palette {
  const raw = theme.current as unknown as Record<string, unknown>;
  const get = (name: string, fallback: string): PaletteColor => {
    const v = raw[name];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return v as import('@opentui/core').RGBA;
    return fallback;
  };
  return {
    panel: get('backgroundPanel', '#111111'),
    surface: get('background', '#171717'),
    text: get('text', '#f0f0f0'),
    muted: get('textMuted', '#a5a5a5'),
    accent: get('primary', '#5f87ff'),
  };
}

interface RuleSectionProps {
  label: string;
  rules: SidebarRuleEntry[];
  palette: Palette;
  expandedIndex: number | null;
  globalOffset: number;
  onToggle: (globalIndex: number) => void;
}

function RuleSection(props: RuleSectionProps): JSX.Element {
  return (
    <Show when={props.rules.length > 0}>
      <box flexDirection="column" paddingTop={1}>
        <text fg={props.palette.muted}>
          {`${props.rules.length} ${props.label}`}
        </text>
        <For each={props.rules}>
          {(rule, localIndex) => {
            const globalIndex = () => props.globalOffset + localIndex();
            return (
              <box
                flexDirection="column"
                onMouseDown={() => props.onToggle(globalIndex())}
              >
                <text fg={props.palette.text} content={`  ${rule.name}`} />

                <Show when={props.expandedIndex === globalIndex()}>
                  <box flexDirection="column" paddingLeft={4}>
                    <text
                      fg={props.palette.muted}
                      content={`Path: ${rule.path}`}
                    />
                    <Show when={(rule.metadata.globs?.length ?? 0) > 0}>
                      <text
                        fg={props.palette.muted}
                        content={`Globs: ${rule.metadata.globs!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.keywords?.length ?? 0) > 0}>
                      <text
                        fg={props.palette.muted}
                        content={`Keywords: ${rule.metadata.keywords!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.tools?.length ?? 0) > 0}>
                      <text
                        fg={props.palette.muted}
                        content={`Tools: ${rule.metadata.tools!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.model?.length ?? 0) > 0}>
                      <text
                        fg={props.palette.muted}
                        content={`Model: ${rule.metadata.model!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.agent?.length ?? 0) > 0}>
                      <text
                        fg={props.palette.muted}
                        content={`Agent: ${rule.metadata.agent!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.command?.length ?? 0) > 0}>
                      <text
                        fg={props.palette.muted}
                        content={`Command: ${rule.metadata.command!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.project?.length ?? 0) > 0}>
                      <text
                        fg={props.palette.muted}
                        content={`Project: ${rule.metadata.project!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.branch?.length ?? 0) > 0}>
                      <text
                        fg={props.palette.muted}
                        content={`Branch: ${rule.metadata.branch!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.os?.length ?? 0) > 0}>
                      <text
                        fg={props.palette.muted}
                        content={`OS: ${rule.metadata.os!.join(', ')}`}
                      />
                    </Show>
                    <Show when={rule.metadata.ci !== undefined}>
                      <text
                        fg={props.palette.muted}
                        content={`CI: ${String(rule.metadata.ci)}`}
                      />
                    </Show>
                    <Show when={rule.metadata.match}>
                      <text
                        fg={props.palette.muted}
                        content={`Match: ${rule.metadata.match}`}
                      />
                    </Show>
                  </box>
                </Show>
              </box>
            );
          }}
        </For>
      </box>
    </Show>
  );
}

export function SidebarContent(props: SidebarContentProps): JSX.Element {
  const [rules, setRules] = createSignal<SidebarRuleEntry[]>([]);
  const [status, setStatus] = createSignal<'loading' | 'loaded' | 'error'>(
    'loading'
  );
  const [skippedCount, setSkippedCount] = createSignal(0);
  const [expandedIndex, setExpandedIndex] = createSignal<number | null>(null);
  const [lastDir, setLastDir] = createSignal<string | null | undefined>(
    undefined
  );

  const resolveProjectDir = (): string | null => {
    return props.api.state.path.directory ?? null;
  };

  const loadRules = async (): Promise<void> => {
    const dir = resolveProjectDir();
    if (dir === lastDir()) return;

    setLastDir(dir);
    setStatus('loading');
    setExpandedIndex(null);

    try {
      const result = await loadSidebarRules(dir);
      setRules(result.rules);
      setSkippedCount(result.skippedCount);
      setStatus('loaded');
    } catch (err) {
      console.error('[opencode-rules] Failed to load rules:', err);
      setStatus('error');
    }
  };

  // Load rules on mount and reload when the workspace changes.
  // Track both sessionId (which changes on workspace switch) and
  // the resolved directory. The loadRules guard (dir === lastDir())
  // prevents redundant reloads if sessionId changes but dir stays the same.
  createEffect(() => {
    void props.sessionId;
    const currentDir = resolveProjectDir();
    void currentDir;
    void loadRules();
  });

  const toggleExpand = (index: number): void => {
    setExpandedIndex(prev => (prev === index ? null : index));
  };

  const palette = () => getPalette(props.theme);
  const projectRules = createMemo(() =>
    rules().filter(r => r.source === 'project')
  );
  const globalRules = createMemo(() =>
    rules().filter(r => r.source === 'global')
  );

  return (
    <box
      width="100%"
      flexDirection="column"
      backgroundColor={palette().surface}
      border={SINGLE_BORDER}
      borderColor={palette().accent}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Header badge */}
      <box flexDirection="row" alignItems="center">
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={palette().accent}
        >
          <text fg={palette().panel}>
            <b>oc-rules</b>
          </text>
        </box>
      </box>

      {/* Loading / Error states */}
      <Show when={status() === 'loading'}>
        <text fg={palette().muted} content="Loading rules..." />
      </Show>
      <Show when={status() === 'error'}>
        <text fg={palette().muted} content="Failed to load rules" />
      </Show>

      {/* Rule sections */}
      <Show when={status() === 'loaded'}>
        <Show
          when={rules().length > 0}
          fallback={<text fg={palette().muted} content="No rules found" />}
        >
          <RuleSection
            label="project rules"
            rules={projectRules()}
            palette={palette()}
            expandedIndex={expandedIndex()}
            globalOffset={0}
            onToggle={toggleExpand}
          />
          <RuleSection
            label="global rules"
            rules={globalRules()}
            palette={palette()}
            expandedIndex={expandedIndex()}
            globalOffset={projectRules().length}
            onToggle={toggleExpand}
          />
        </Show>
        <Show when={skippedCount() > 0}>
          <text fg={palette().muted}>
            {`${skippedCount()} rules skipped (unreadable)`}
          </text>
        </Show>
      </Show>
    </box>
  );
}
