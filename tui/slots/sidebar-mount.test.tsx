/** @jsxImportSource @opentui/solid */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { DEFAULT_THEME, resolveThemeDocument } from '@opencode-ai/theme/tui';

let ffiAvailable = false;

beforeAll(async () => {
  try {
    const { createTestRenderer } = await import('@opentui/core/testing');
    const renderer = await createTestRenderer({ width: 10, height: 10 });
    renderer.renderer.destroy();
    ffiAvailable = true;
  } catch (error) {
    console.warn('FFI probe failed:', error);
    ffiAvailable = false;
  }
});

describe('sidebar mount', () => {
  it('renders real V2 theme colors for active and inactive rule bullets', async testContext => {
    if (!ffiAvailable) {
      const skipFn = (testContext as { skip?: () => void }).skip;
      if (typeof skipFn === 'function') {
        skipFn.call(testContext);
      } else {
        console.warn('skipped: @opentui FFI unavailable');
      }
      return;
    }

    const { testRender } = await import('@opentui/solid');
    const { SidebarContent } = await import('./sidebar-content.js');

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'oc-rules-tui-mount-'));
    const rulesDir = path.join(tmp, '.config', 'opencode', 'rules');
    const tmpHome = path.join(tmp, 'home');
    const stateDir = path.join(tmpHome, '.opencode', 'state', 'opencode-rules');
    mkdirSync(rulesDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const planPath = path.join(rulesDir, 'plan.mdc');
    writeFileSync(planPath, '---\nagent: [plan]\n---\n\nPlan body.');
    writeFileSync(path.join(rulesDir, 'always.mdc'), 'Always active body.');
    writeFileSync(
      path.join(stateDir, 'ses_sidebar_mount_theme.json'),
      JSON.stringify({
        sessionID: 'ses_sidebar_mount_theme',
        evaluatedAt: Date.now(),
        matchedRulePaths: [planPath],
      })
    );

    const savedXdg = process.env.XDG_CONFIG_HOME;
    const savedOpencode = process.env.OPENCODE_CONFIG_DIR;
    const savedHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = path.join(tmp, '.config');
    delete process.env.OPENCODE_CONFIG_DIR;
    process.env.HOME = tmpHome;

    const theme = resolveThemeDocument(DEFAULT_THEME, 'dark');
    const data = { on: () => () => {} };

    try {
      const setup = await testRender(
        () => (
          <SidebarContent
            sessionId="ses_sidebar_mount_theme"
            projectDir={tmp}
            data={data as never}
            theme={theme}
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
      expect(frame).toContain('(1/1)');
      expect(frame).not.toContain('Loading...');

      const headerFrame = setup.captureSpans();
      const headerRow = headerFrame.lines.findIndex(line =>
        line.spans.some(span => span.text.includes('Global'))
      );
      expect(headerRow).toBeGreaterThanOrEqual(0);

      await setup.mockMouse.click(2, headerRow);

      const openDeadline = Date.now() + 2000;
      let openFrame = setup.captureCharFrame();
      while (!openFrame.includes('plan') && Date.now() < openDeadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
        await setup.flush();
        openFrame = setup.captureCharFrame();
      }
      expect(openFrame).toContain('plan');
      expect(openFrame).toContain('always');

      const captured = setup.captureSpans();
      const bullets = captured.lines
        .flatMap(line => line.spans)
        .filter(span => span.text.trim() === '•');
      expect(bullets).toHaveLength(2);
      const active = bullets.filter(span =>
        span.fg.equals(theme.text.feedback.success.default)
      );
      const subdued = bullets.filter(span =>
        span.fg.equals(theme.text.subdued)
      );
      expect(active).toHaveLength(1);
      expect(subdued).toHaveLength(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      if (savedXdg !== undefined) process.env.XDG_CONFIG_HOME = savedXdg;
      else delete process.env.XDG_CONFIG_HOME;
      if (savedOpencode !== undefined)
        process.env.OPENCODE_CONFIG_DIR = savedOpencode;
      else delete process.env.OPENCODE_CONFIG_DIR;
      if (savedHome !== undefined) process.env.HOME = savedHome;
      else delete process.env.HOME;
    }
  });
});
