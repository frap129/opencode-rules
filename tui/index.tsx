// tui/index.tsx
/** @jsxImportSource @opentui/solid */
import { Plugin } from '@opencode-ai/plugin/tui';
import { SidebarContent } from './slots/sidebar-content.js';

export default Plugin.define({
  id: 'opencode-rules',
  setup(ctx) {
    return ctx.ui.slot({
      append: 'sidebar.content',
      render: ({ sessionID }) => (
        <SidebarContent sessionId={sessionID} ctx={ctx} theme={ctx.theme} />
      ),
    });
  },
});
