/** @jsxImportSource @opentui/solid */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';

let ffiAvailable = false;

beforeAll(async () => {
  try {
    const { createTestRenderer } = await import('@opentui/core/testing');
    const renderer = await createTestRenderer({ width: 10, height: 10 });
    renderer.renderer.destroy();
    ffiAvailable = true;
  } catch {
    ffiAvailable = false;
  }
});

describe('sidebar mount', () => {
  it('renders rules without crashing on Solid conditions', async () => {
    if (!ffiAvailable) {
      return;
    }

    const { testRender } = await import('@opentui/solid');
    const { SidebarContent } = await import('./sidebar-content.js');

    const tmp = path.join(os.tmpdir(), `oc-rules-tui-mount-${Date.now()}`);
    const rulesDir = path.join(tmp, '.config', 'opencode', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(
      path.join(rulesDir, 'plan.mdc'),
      '---\nagent: [plan]\n---\n\nPlan body.'
    );
    const savedXdg = process.env.XDG_CONFIG_HOME;
    const savedOpencode = process.env.OPENCODE_CONFIG_DIR;
    process.env.XDG_CONFIG_HOME = path.join(tmp, '.config');
    delete process.env.OPENCODE_CONFIG_DIR;

    const theme = {
      current: { text: 'white', textMuted: 'gray', success: 'green' },
    };
    const api = {
      state: { path: { directory: tmp } },
      event: { on: () => () => {} },
    };

    try {
      const setup = await testRender(
        () => (
          <SidebarContent
            sessionId="ses_sidebar_mount_render_only"
            api={api as never}
            theme={theme as never}
          />
        ),
        { width: 60, height: 20 }
      );
      const deadline = Date.now() + 2000;
      let frame = setup.captureCharFrame();
      while (!frame.includes('Global') && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
        await setup.flush();
        frame = setup.captureCharFrame();
      }
      expect(frame).toContain('Rules');
      expect(frame).toContain('Global');
      expect(frame).not.toContain('Loading...');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      if (savedXdg !== undefined) process.env.XDG_CONFIG_HOME = savedXdg;
      else delete process.env.XDG_CONFIG_HOME;
      if (savedOpencode !== undefined)
        process.env.OPENCODE_CONFIG_DIR = savedOpencode;
      else delete process.env.OPENCODE_CONFIG_DIR;
    }
  });
});
