/** @jsxImportSource @opentui/solid */
import {
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  For,
  type JSX,
} from 'solid-js';
import type { Plugin as TuiPluginNamespace } from '@opencode-ai/plugin/tui';
import {
  formatRuleDetail,
  loadSidebarRules,
  type SidebarRuleEntry,
} from '../data/rules.js';
import { createRulesLoadCoordinator } from '../data/rules-load-coordinator.js';
import { logError } from '../../src/shared/debug.js';
import {
  fgProps,
  resolveSidebarColors,
  type SidebarColor,
  type SidebarColors,
} from './theme-colors.js';

interface SidebarContentProps {
  sessionId: string;
  projectDir: string | null;
  data: TuiPluginNamespace.Context['data'];
  theme: TuiPluginNamespace.Context['theme'];
}

interface RuleSectionProps {
  title: string;
  rules: SidebarRuleEntry[];
  colors: SidebarColors;
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

  const bulletColor = (rule: SidebarRuleEntry): SidebarColor => {
    return rule.isActive === true ? props.colors.success : props.colors.subdued;
  };

  return (
    <box>
      {props.rules.length > 0 && (
        <>
          <box flexDirection="row" gap={1} onMouseDown={() => props.onToggle()}>
            <text {...fgProps(props.colors.text)}>
              {props.open ? '▼' : '▶'}
            </text>
            <text {...fgProps(props.colors.text)}>
              {props.title}
              {!props.open && (
                <span style={fgProps(props.colors.subdued)}>
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
                      <text {...fgProps(bulletColor(rule))}>•</text>
                      <text {...fgProps(props.colors.text)}>{rule.name}</text>
                    </box>
                    {props.expandedIndex === globalIndex() && (
                      <box flexDirection="column" paddingLeft={4}>
                        <text {...fgProps(props.colors.subdued)}>
                          <i>{formatRuleDetail(rule)}</i>
                        </text>
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

  const colors = (): SidebarColors => resolveSidebarColors(props.theme);

  const resolveProjectDir = (): string | null => props.projectDir;

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

  createEffect(() => {
    const currentSessionId = props.sessionId;
    const currentDir = resolveProjectDir();

    if (currentSessionId !== lastSessionId() || currentDir !== lastDir()) {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      setExpandedIndex(null);
      setProjectOpen(false);
      setGlobalOpen(false);
      rulesLoadCoordinator.reset({
        projectDir: currentDir,
        sessionId: currentSessionId,
      });
    }
  });

  createEffect(() => {
    const counter = refreshCounter();
    if (counter > 0) {
      rulesLoadCoordinator.refresh();
    }
  });

  const triggerRefresh = (event: { data: { sessionID?: string } }): void => {
    const eventSessionID = event.data?.sessionID;
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

  const unsubMessageUpdated = props.data.on(
    'session.message.content.updated',
    triggerRefresh
  );
  const unsubSessionStatus = props.data.on('session.status', triggerRefresh);

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
      <text {...fgProps(colors().text)}>
        <b>Rules</b>
      </text>

      {status() === 'loading' && (
        <text {...fgProps(colors().subdued)}>Loading...</text>
      )}
      {status() === 'error' && (
        <text {...fgProps(colors().subdued)}>Failed to load rules</text>
      )}

      {status() === 'loaded' && (
        <>
          {rules().length > 0 ? (
            <>
              <RuleSection
                title="Project"
                rules={projectRules()}
                colors={colors()}
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
                colors={colors()}
                open={globalOpen()}
                onToggle={() => setGlobalOpen(x => !x)}
                expandedIndex={expandedIndex()}
                globalOffset={projectRules().length}
                onExpandToggle={toggleExpand}
                hasEvaluationState={hasEvaluationState()}
              />
            </>
          ) : (
            <text {...fgProps(colors().subdued)}>No rules found</text>
          )}
          {skippedCount() > 0 && (
            <text {...fgProps(colors().subdued)}>
              {skippedCount()} rules skipped (unreadable)
            </text>
          )}
        </>
      )}
    </box>
  );
}
