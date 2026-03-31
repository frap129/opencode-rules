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

type ThemeColor = string | import('@opentui/core').RGBA;

interface ThemeColors {
  text: ThemeColor;
  textMuted: ThemeColor;
  [key: string]: unknown;
}

interface RuleSectionProps {
  title: string;
  rules: SidebarRuleEntry[];
  theme: ThemeColors;
  open: boolean;
  onToggle: () => void;
  expandedIndex: number | null;
  globalOffset: number;
  onExpandToggle: (globalIndex: number) => void;
}

function RuleSection(props: RuleSectionProps): JSX.Element {
  return (
    <Show when={props.rules.length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => props.onToggle()}>
          <text fg={props.theme.text}>{props.open ? '▼' : '▶'}</text>
          <text fg={props.theme.text}>
            {props.title}
            <Show when={!props.open}>
              <span style={{ fg: props.theme.textMuted }}>
                {' '}
                ({props.rules.length})
              </span>
            </Show>
          </text>
        </box>
        <Show when={props.open}>
          <For each={props.rules}>
            {(rule, localIndex) => {
              const globalIndex = () => props.globalOffset + localIndex();
              return (
                <box
                  flexDirection="column"
                  onMouseDown={() => props.onExpandToggle(globalIndex())}
                >
                  <box flexDirection="row" gap={1}>
                    <text fg={props.theme.textMuted}>•</text>
                    <text fg={props.theme.text}>{rule.name}</text>
                  </box>
                  <Show when={props.expandedIndex === globalIndex()}>
                    <box flexDirection="column" paddingLeft={4}>
                      <text fg={props.theme.textMuted}>{rule.path}</text>
                      <Show when={(rule.metadata.globs?.length ?? 0) > 0}>
                        <text fg={props.theme.textMuted}>
                          Globs: {rule.metadata.globs!.join(', ')}
                        </text>
                      </Show>
                      <Show when={(rule.metadata.keywords?.length ?? 0) > 0}>
                        <text fg={props.theme.textMuted}>
                          Keywords: {rule.metadata.keywords!.join(', ')}
                        </text>
                      </Show>
                      <Show when={(rule.metadata.tools?.length ?? 0) > 0}>
                        <text fg={props.theme.textMuted}>
                          Tools: {rule.metadata.tools!.join(', ')}
                        </text>
                      </Show>
                      <Show when={(rule.metadata.model?.length ?? 0) > 0}>
                        <text fg={props.theme.textMuted}>
                          Model: {rule.metadata.model!.join(', ')}
                        </text>
                      </Show>
                      <Show when={(rule.metadata.agent?.length ?? 0) > 0}>
                        <text fg={props.theme.textMuted}>
                          Agent: {rule.metadata.agent!.join(', ')}
                        </text>
                      </Show>
                      <Show when={(rule.metadata.command?.length ?? 0) > 0}>
                        <text fg={props.theme.textMuted}>
                          Command: {rule.metadata.command!.join(', ')}
                        </text>
                      </Show>
                      <Show when={(rule.metadata.project?.length ?? 0) > 0}>
                        <text fg={props.theme.textMuted}>
                          Project: {rule.metadata.project!.join(', ')}
                        </text>
                      </Show>
                      <Show when={(rule.metadata.branch?.length ?? 0) > 0}>
                        <text fg={props.theme.textMuted}>
                          Branch: {rule.metadata.branch!.join(', ')}
                        </text>
                      </Show>
                      <Show when={(rule.metadata.os?.length ?? 0) > 0}>
                        <text fg={props.theme.textMuted}>
                          OS: {rule.metadata.os!.join(', ')}
                        </text>
                      </Show>
                      <Show when={rule.metadata.ci !== undefined}>
                        <text fg={props.theme.textMuted}>
                          CI: {String(rule.metadata.ci)}
                        </text>
                      </Show>
                      <Show when={rule.metadata.match}>
                        <text fg={props.theme.textMuted}>
                          Match: {rule.metadata.match}
                        </text>
                      </Show>
                    </box>
                  </Show>
                </box>
              );
            }}
          </For>
        </Show>
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
  const [projectOpen, setProjectOpen] = createSignal(false);
  const [globalOpen, setGlobalOpen] = createSignal(false);

  const theme = (): ThemeColors => props.theme.current as ThemeColors;

  const resolveProjectDir = (): string | null => {
    return props.api.state.path.directory ?? null;
  };

  const loadRules = async (): Promise<void> => {
    const dir = resolveProjectDir();
    if (dir === lastDir()) return;

    setLastDir(dir);
    setStatus('loading');
    setExpandedIndex(null);
    setProjectOpen(false);
    setGlobalOpen(false);

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

  createEffect(() => {
    void props.sessionId;
    const currentDir = resolveProjectDir();
    void currentDir;
    void loadRules();
  });

  const toggleExpand = (index: number): void => {
    setExpandedIndex(prev => (prev === index ? null : index));
  };

  const projectRules = createMemo(() =>
    rules().filter(r => r.source === 'project')
  );
  const globalRules = createMemo(() =>
    rules().filter(r => r.source === 'global')
  );

  return (
    <box>
      <text fg={theme().text}>
        <b>Rules</b>
      </text>

      <Show when={status() === 'loading'}>
        <text fg={theme().textMuted}>Loading...</text>
      </Show>
      <Show when={status() === 'error'}>
        <text fg={theme().textMuted}>Failed to load rules</text>
      </Show>

      <Show when={status() === 'loaded'}>
        <Show
          when={rules().length > 0}
          fallback={<text fg={theme().textMuted}>No rules found</text>}
        >
          <RuleSection
            title="Project"
            rules={projectRules()}
            theme={theme()}
            open={projectOpen()}
            onToggle={() => setProjectOpen(x => !x)}
            expandedIndex={expandedIndex()}
            globalOffset={0}
            onExpandToggle={toggleExpand}
          />
          <RuleSection
            title="Global"
            rules={globalRules()}
            theme={theme()}
            open={globalOpen()}
            onToggle={() => setGlobalOpen(x => !x)}
            expandedIndex={expandedIndex()}
            globalOffset={projectRules().length}
            onExpandToggle={toggleExpand}
          />
        </Show>
        <Show when={skippedCount() > 0}>
          <text fg={theme().textMuted}>
            {skippedCount()} rules skipped (unreadable)
          </text>
        </Show>
      </Show>
    </box>
  );
}
