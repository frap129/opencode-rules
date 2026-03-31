// tui/slots/sidebar-content.tsx
/** @jsxImportSource @opentui/solid */
import { createSignal, createEffect, Show, For, type JSX } from 'solid-js';
import type { TuiPluginApi, TuiTheme } from '@opencode-ai/plugin/tui';
import { loadSidebarRules, type SidebarRuleEntry } from '../data/rules.js';

interface SidebarContentProps {
  sessionId: string;
  api: TuiPluginApi;
  theme: TuiTheme;
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
    const workspaceId = props.api.workspace.current();
    if (!workspaceId) return null;
    const workspace = props.api.state.workspace.get(workspaceId);
    return workspace?.directory ?? null;
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

  return (
    <box flexDirection="column">
      <Show when={status() === 'loading'}>
        <text>Loading rules...</text>
      </Show>

      <Show when={status() === 'error'}>
        <text>Failed to load rules</text>
      </Show>

      <Show when={status() === 'loaded'}>
        <Show when={rules().length > 0} fallback={<text>No rules found</text>}>
          <text>
            {rules().length} rules loaded
            {skippedCount() > 0 ? ` (${skippedCount()} skipped)` : ''}
          </text>

          <For each={rules()}>
            {(rule, index) => (
              <box
                flexDirection="column"
                onMouseDown={() => toggleExpand(index())}
              >
                <text>
                  <text fg="gray">
                    [{rule.source === 'project' ? 'P' : 'G'}]
                  </text>{' '}
                  {rule.name} — {rule.conditionSummary}
                </text>

                <Show when={expandedIndex() === index()}>
                  <box flexDirection="column" paddingLeft={2}>
                    <text fg="gray">Path: {rule.path}</text>
                    <text fg="gray">
                      Source: {rule.source === 'project' ? 'project' : 'global'}
                    </text>
                    <Show when={(rule.metadata.globs?.length ?? 0) > 0}>
                      <text fg="gray">
                        Globs: {rule.metadata.globs!.join(', ')}
                      </text>
                    </Show>
                    <Show when={(rule.metadata.keywords?.length ?? 0) > 0}>
                      <text fg="gray">
                        Keywords: {rule.metadata.keywords!.join(', ')}
                      </text>
                    </Show>
                    <Show when={(rule.metadata.tools?.length ?? 0) > 0}>
                      <text fg="gray">
                        Tools: {rule.metadata.tools!.join(', ')}
                      </text>
                    </Show>
                    <Show when={(rule.metadata.model?.length ?? 0) > 0}>
                      <text fg="gray">
                        Model: {rule.metadata.model!.join(', ')}
                      </text>
                    </Show>
                    <Show when={(rule.metadata.agent?.length ?? 0) > 0}>
                      <text fg="gray">
                        Agent: {rule.metadata.agent!.join(', ')}
                      </text>
                    </Show>
                    <Show when={(rule.metadata.command?.length ?? 0) > 0}>
                      <text fg="gray">
                        Command: {rule.metadata.command!.join(', ')}
                      </text>
                    </Show>
                    <Show when={(rule.metadata.project?.length ?? 0) > 0}>
                      <text fg="gray">
                        Project: {rule.metadata.project!.join(', ')}
                      </text>
                    </Show>
                    <Show when={(rule.metadata.branch?.length ?? 0) > 0}>
                      <text fg="gray">
                        Branch: {rule.metadata.branch!.join(', ')}
                      </text>
                    </Show>
                    <Show when={(rule.metadata.os?.length ?? 0) > 0}>
                      <text fg="gray">OS: {rule.metadata.os!.join(', ')}</text>
                    </Show>
                    <Show when={rule.metadata.ci !== undefined}>
                      <text fg="gray">CI: {String(rule.metadata.ci)}</text>
                    </Show>
                    <Show when={rule.metadata.match}>
                      <text fg="gray">Match: {rule.metadata.match}</text>
                    </Show>
                  </box>
                </Show>
              </box>
            )}
          </For>
        </Show>
      </Show>
    </box>
  );
}
