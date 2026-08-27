// tui/slots/sidebar-content.tsx
/** @jsxImportSource @opentui/solid */
import {
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  For,
  type JSX,
} from 'solid-js';
import type { TuiPluginApi, TuiTheme } from '@opencode-ai/plugin/tui';
import { loadSidebarRules, type SidebarRuleEntry } from '../data/rules.js';
import { createRulesLoadCoordinator } from '../data/rules-load-coordinator.js';
import type { RuleMetadata } from '../../src/utils.js';
import { logError } from '../../src/debug.js';

const metadataFieldDescriptors: Array<{
  key: keyof RuleMetadata;
  label: string;
}> = [
  { key: 'globs', label: 'Globs' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'tools', label: 'Tools' },
  { key: 'model', label: 'Model' },
  { key: 'agent', label: 'Agent' },
  { key: 'command', label: 'Command' },
  { key: 'project', label: 'Project' },
  { key: 'branch', label: 'Branch' },
  { key: 'os', label: 'OS' },
];

interface SidebarContentProps {
  sessionId: string;
  api: TuiPluginApi;
  theme: TuiTheme;
}

type ThemeColor = string | import('@opentui/core').RGBA;

interface ThemeColors {
  text: ThemeColor;
  textMuted: ThemeColor;
  success: ThemeColor;
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
    return rule.isActive === true ? props.theme.success : props.theme.textMuted;
  };

  return (
    <box>
      {props.rules.length > 0 && (
        <>
          <box flexDirection="row" gap={1} onMouseDown={() => props.onToggle()}>
            <text fg={props.theme.text}>{props.open ? '▼' : '▶'}</text>
            <text fg={props.theme.text}>
              {props.title}
              {!props.open && (
                <span style={{ fg: props.theme.textMuted }}>
                  {' '}
                  {headerCount()}
                </span>
              )}
            </text>
          </box>
          {props.open && (
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
                    {props.expandedIndex === globalIndex() && (
                      <box flexDirection="column" paddingLeft={4}>
                        <text fg={props.theme.textMuted}>{rule.path}</text>
                        <For each={metadataFieldDescriptors}>
                          {({ key, label }) => {
                            const value = rule.metadata[key];
                            if (Array.isArray(value) && value.length > 0) {
                              return (
                                <text fg={props.theme.textMuted}>
                                  {label}: {value.join(', ')}
                                </text>
                              );
                            }
                            return null;
                          }}
                        </For>
                        {rule.metadata.ci !== undefined && (
                          <text fg={props.theme.textMuted}>
                            CI: {String(rule.metadata.ci)}
                          </text>
                        )}
                        {rule.metadata.match && (
                          <text fg={props.theme.textMuted}>
                            Match: {rule.metadata.match}
                          </text>
                        )}
                      </box>
                    )}
                  </box>
                );
              }}
            </For>
          )}
        </>
      )}
    </box>
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

  // Debounce timer for event-driven refresh
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rulesLoadCoordinator = createRulesLoadCoordinator({
    load: target => loadSidebarRules(target.projectDir, target.sessionId),
    onReset: target => {
      setLastDir(target.projectDir);
      setLastSessionId(target.sessionId);
      setStatus('loading');
    },
    onResult: result => {
      setRules(result.rules);
      setSkippedCount(result.skippedCount);
      setHasEvaluationState(result.hasEvaluationState);
      setStatus('loaded');
    },
    onError: (error, _target, reset) => {
      logError('Failed to load rules', error);
      if (reset) {
        setStatus('error');
      }
    },
  });

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
      rulesLoadCoordinator.reset({
        projectDir: currentDir,
        sessionId: currentSessionId,
      });
    }
  });

  // Effect 2: Refresh on event-driven updates (refreshCounter changes)
  createEffect(() => {
    const counter = refreshCounter();
    if (counter > 0) {
      rulesLoadCoordinator.refresh();
    }
  });

  // Subscribe to OpenCode events with debounce
  const triggerRefresh = (event: {
    type: string;
    properties: Record<string, unknown>;
  }): void => {
    // Filter events to current sessionId before debouncing
    // OpenCode SDK events nest sessionID inside properties: { type, properties: { sessionID, ... } }
    const eventSessionID = event.properties.sessionID;
    if (
      typeof eventSessionID === 'string' &&
      eventSessionID !== props.sessionId
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
    rulesLoadCoordinator.dispose();
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

      {status() === 'loading' && <text fg={theme().textMuted}>Loading...</text>}
      {status() === 'error' && (
        <text fg={theme().textMuted}>Failed to load rules</text>
      )}

      {status() === 'loaded' && (
        <>
          {rules().length > 0 ? (
            <>
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
            </>
          ) : (
            <text fg={theme().textMuted}>No rules found</text>
          )}
          {skippedCount() > 0 && (
            <text fg={theme().textMuted}>
              {skippedCount()} rules skipped (unreadable)
            </text>
          )}
        </>
      )}
    </box>
  );
}
