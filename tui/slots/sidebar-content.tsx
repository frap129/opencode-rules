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

  return (
    <box flexDirection="column">
      <Show when={status() === 'loading'}>
        <text content="Loading rules..." />
      </Show>

      <Show when={status() === 'error'}>
        <text content="Failed to load rules" />
      </Show>

      <Show when={status() === 'loaded'}>
        <Show
          when={rules().length > 0}
          fallback={<text content="No rules found" />}
        >
          <text
            content={`${rules().length} rules loaded${skippedCount() > 0 ? ` (${skippedCount()} skipped)` : ''}`}
          />

          <For each={rules()}>
            {(rule, index) => (
              <box
                flexDirection="column"
                onMouseDown={() => toggleExpand(index())}
              >
                <box flexDirection="row">
                  <text
                    fg="gray"
                    content={`[${rule.source === 'project' ? 'P' : 'G'}]`}
                  />
                  <text content={` ${rule.name} — ${rule.conditionSummary}`} />
                </box>

                <Show when={expandedIndex() === index()}>
                  <box flexDirection="column" paddingLeft={2}>
                    <text fg="gray" content={`Path: ${rule.path}`} />
                    <text
                      fg="gray"
                      content={`Source: ${rule.source === 'project' ? 'project' : 'global'}`}
                    />
                    <Show when={(rule.metadata.globs?.length ?? 0) > 0}>
                      <text
                        fg="gray"
                        content={`Globs: ${rule.metadata.globs!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.keywords?.length ?? 0) > 0}>
                      <text
                        fg="gray"
                        content={`Keywords: ${rule.metadata.keywords!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.tools?.length ?? 0) > 0}>
                      <text
                        fg="gray"
                        content={`Tools: ${rule.metadata.tools!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.model?.length ?? 0) > 0}>
                      <text
                        fg="gray"
                        content={`Model: ${rule.metadata.model!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.agent?.length ?? 0) > 0}>
                      <text
                        fg="gray"
                        content={`Agent: ${rule.metadata.agent!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.command?.length ?? 0) > 0}>
                      <text
                        fg="gray"
                        content={`Command: ${rule.metadata.command!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.project?.length ?? 0) > 0}>
                      <text
                        fg="gray"
                        content={`Project: ${rule.metadata.project!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.branch?.length ?? 0) > 0}>
                      <text
                        fg="gray"
                        content={`Branch: ${rule.metadata.branch!.join(', ')}`}
                      />
                    </Show>
                    <Show when={(rule.metadata.os?.length ?? 0) > 0}>
                      <text
                        fg="gray"
                        content={`OS: ${rule.metadata.os!.join(', ')}`}
                      />
                    </Show>
                    <Show when={rule.metadata.ci !== undefined}>
                      <text
                        fg="gray"
                        content={`CI: ${String(rule.metadata.ci)}`}
                      />
                    </Show>
                    <Show when={rule.metadata.match}>
                      <text
                        fg="gray"
                        content={`Match: ${rule.metadata.match}`}
                      />
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
