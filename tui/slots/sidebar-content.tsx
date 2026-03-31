// tui/slots/sidebar-content.tsx
/** @jsxImportSource @opentui/solid */
import {
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
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
  hasEvaluationState: boolean;
}

const BULLET_GREEN: ThemeColor = '#02a25a';

function RuleSection(props: RuleSectionProps): JSX.Element {
  const activeCount = createMemo(
    () => props.rules.filter(r => r.isActive === true).length
  );

  const headerCount = createMemo(() => {
    if (props.hasEvaluationState) {
      return `(${activeCount()}/${props.rules.length})`;
    }
    return `(${props.rules.length})`;
  });

  const bulletColor = (rule: SidebarRuleEntry): ThemeColor => {
    return rule.isActive === true ? BULLET_GREEN : props.theme.textMuted;
  };

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
                {headerCount()}
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
                    <text fg={bulletColor(rule)}>•</text>
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
  const [hasEvaluationState, setHasEvaluationState] = createSignal(false);
  const [expandedIndex, setExpandedIndex] = createSignal<number | null>(null);
  const [lastDir, setLastDir] = createSignal<string | null | undefined>(
    undefined
  );
  const [lastSessionId, setLastSessionId] = createSignal<string | undefined>(
    undefined
  );
  const [projectOpen, setProjectOpen] = createSignal(false);
  const [globalOpen, setGlobalOpen] = createSignal(false);
  const [refreshCounter, setRefreshCounter] = createSignal(0);

  const theme = (): ThemeColors => props.theme.current as ThemeColors;

  const resolveProjectDir = (): string | null => {
    return props.api.state.path.directory ?? null;
  };

  // Monotonic counter to detect stale async results
  let requestId = 0;
  // Debounce timer for event-driven refresh
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Initial load: triggered by session/directory change, resets all UI state
  const loadRulesInitial = async (): Promise<void> => {
    const thisRequest = ++requestId;
    const dir = resolveProjectDir();
    const sessionId = props.sessionId;

    setLastDir(dir);
    setLastSessionId(sessionId);
    setStatus('loading');

    try {
      const result = await loadSidebarRules(dir, sessionId);
      // Discard if a newer request started
      if (requestId !== thisRequest) return;
      setRules(result.rules);
      setSkippedCount(result.skippedCount);
      setHasEvaluationState(result.hasEvaluationState);
      setStatus('loaded');
    } catch (err) {
      // Discard if a newer request started
      if (requestId !== thisRequest) return;
      console.error('[opencode-rules] Failed to load rules:', err);
      setStatus('error');
    }
  };

  // Refresh load: triggered by events, only updates rule data (no UI state reset)
  const loadRulesRefresh = async (): Promise<void> => {
    // Skip refresh if initial load is still in flight
    if (status() === 'loading') return;

    const thisRequest = ++requestId;
    const dir = resolveProjectDir();
    const sessionId = props.sessionId;

    try {
      const result = await loadSidebarRules(dir, sessionId);
      // Discard if a newer request started
      if (requestId !== thisRequest) return;
      setRules(result.rules);
      setSkippedCount(result.skippedCount);
      setHasEvaluationState(result.hasEvaluationState);
      setStatus('loaded');
    } catch (err) {
      // Discard if a newer request started
      if (requestId !== thisRequest) return;
      console.error('[opencode-rules] Failed to refresh rules:', err);
    }
  };

  // Effect 1: Initial load on session/directory change
  createEffect(() => {
    const currentSessionId = props.sessionId;
    const currentDir = resolveProjectDir();

    // Check if session or directory changed
    if (currentSessionId !== lastSessionId() || currentDir !== lastDir()) {
      // Clear pending debounce from previous session
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      // Reset UI state on session/directory change
      setExpandedIndex(null);
      setProjectOpen(false);
      setGlobalOpen(false);
      void loadRulesInitial();
    }
  });

  // Effect 2: Refresh on event-driven updates (refreshCounter changes)
  createEffect(() => {
    const counter = refreshCounter();
    if (counter > 0) {
      void loadRulesRefresh();
    }
  });

  // Subscribe to OpenCode events with debounce
  const triggerRefresh = (...args: unknown[]): void => {
    // Filter events to current sessionId before debouncing
    const event = args[0];
    if (
      event !== null &&
      typeof event === 'object' &&
      'sessionId' in event &&
      typeof (event as Record<string, unknown>).sessionId === 'string' &&
      (event as Record<string, unknown>).sessionId !== props.sessionId
    ) {
      return;
    }

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      setRefreshCounter(c => c + 1);
    }, 150);
  };

  const unsubMessageUpdated = props.api.event.on(
    'message.updated',
    triggerRefresh
  );
  const unsubSessionStatus = props.api.event.on(
    'session.status',
    triggerRefresh
  );

  onCleanup(() => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    unsubMessageUpdated();
    unsubSessionStatus();
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
            hasEvaluationState={hasEvaluationState()}
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
            hasEvaluationState={hasEvaluationState()}
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
