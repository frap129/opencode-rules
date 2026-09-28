/** @jsxImportSource @opentui/solid */
import type { Plugin as TuiPluginNamespace } from '@opencode-ai/plugin/tui';
import { SidebarContent } from './slots/sidebar-content.js';
import { projectDirFor } from './data/project-dir.js';

const tui: TuiPluginNamespace.Definition = {
  id: 'opencode-rules',
  async setup(ctx) {
    ctx.ui.slot({
      append: 'sidebar.content',
      render: input => (
        <SidebarContent
          sessionId={input.sessionID}
          projectDir={projectDirFor(ctx.data, input.sessionID)}
          data={ctx.data}
          theme={ctx.theme}
        />
      ),
    });
  },
};

export default tui;
