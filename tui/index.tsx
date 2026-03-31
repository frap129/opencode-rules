// tui/index.tsx
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin } from '@opencode-ai/plugin/tui';
import { SidebarContent } from './slots/sidebar-content.js';

const id = 'opencode-rules' as const;

const tui: TuiPlugin = async api => {
  api.slots.register({
    order: 90,
    slots: {
      sidebar_content: (ctx, props) => (
        <SidebarContent
          sessionId={props.session_id}
          api={api}
          theme={ctx.theme}
        />
      ),
    },
  });
};

export default { id, tui };
