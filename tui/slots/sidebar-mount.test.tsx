/** @jsxImportSource @opentui/solid */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolveTheme, type ThemeDefinition } from '@opencode/theme/tui';

const tokenColor = '#808080';
const hue = {
  100: '#eeeeee',
  200: '#dddddd',
  300: '#cccccc',
  400: '#bbbbbb',
  500: '#aaaaaa',
  600: '#999999',
  700: '#888888',
  800: '#777777',
  900: '#666666',
};
const testTheme = {
  text: {
    base: '#ffffff',
    muted: tokenColor,
    action: {
      primary: { base: '#ffffff' },
      secondary: { base: tokenColor },
      destructive: { base: '#ff0000' },
    },
    formfield: { base: '#ffffff' },
    feedback: {
      error: { base: '#ff0000' },
      warning: { base: '#ffff00' },
      success: { base: '#00ff00' },
      info: { base: '#0000ff' },
    },
  },
  background: {
    base: '#000000',
    raised: { base: '#111111', high: '#222222', max: '#333333' },
    action: {
      primary: { base: '#000000' },
      secondary: { base: '#000000' },
      destructive: { base: '#000000' },
    },
    formfield: { base: '#000000' },
    feedback: {
      error: { base: '#000000' },
      warning: { base: '#000000' },
      success: { base: '#000000' },
      info: { base: '#000000' },
    },
  },
  border: { base: '#444444' },
  scrollbar: { base: '#555555' },
  diff: {
    text: {
      added: '#00ff00',
      removed: '#ff0000',
      context: tokenColor,
      hunkHeader: tokenColor,
    },
    background: { added: '#002200', removed: '#220000', context: '#111111' },
    highlight: { added: '#00ff00', removed: '#ff0000' },
    lineNumber: {
      text: tokenColor,
      background: { added: '#002200', removed: '#220000' },
    },
  },
  syntax: {
    comment: tokenColor,
    keyword: tokenColor,
    function: tokenColor,
    variable: tokenColor,
    string: tokenColor,
    number: tokenColor,
    type: tokenColor,
    operator: tokenColor,
    punctuation: tokenColor,
  },
  markdown: {
    text: tokenColor,
    heading: tokenColor,
    link: tokenColor,
    linkText: tokenColor,
    code: tokenColor,
    blockQuote: tokenColor,
    emphasis: tokenColor,
    strong: tokenColor,
    horizontalRule: tokenColor,
    listItem: tokenColor,
    listEnumeration: tokenColor,
    image: tokenColor,
    imageText: tokenColor,
    codeBlock: tokenColor,
  },
  hue: {
    gray: hue,
    accent: '$hue.gray',
    interactive: '$hue.gray',
    neutral: '$hue.gray',
  },
  categorical: ['neutral'],
} satisfies ThemeDefinition;

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

    const theme = resolveTheme(testTheme);
    const data = { on: () => () => {} };

    try {
      const setup = await testRender(
        () => (
          <SidebarContent
            sessionId="ses_sidebar_mount_theme"
            projectDir={tmp}
            additionalRuleDirectories={[]}
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

      const planRow = openFrame
        .split('\n')
        .findIndex(line => line.includes('plan'));
      expect(planRow).toBeGreaterThanOrEqual(0);
      await setup.mockMouse.click(2, planRow);

      const detailDeadline = Date.now() + 2000;
      let detailFrame = setup.captureCharFrame();
      while (
        !detailFrame.includes('agent: plan · plan.mdc') &&
        Date.now() < detailDeadline
      ) {
        await new Promise(resolve => setTimeout(resolve, 10));
        await setup.flush();
        detailFrame = setup.captureCharFrame();
      }
      expect(detailFrame).toContain('agent: plan · plan.mdc');

      const captured = setup.captureSpans();
      const bullets = captured.lines
        .flatMap(line => line.spans)
        .filter(span => span.text.trim() === '•');
      expect(bullets).toHaveLength(2);
      const active = bullets.filter(span =>
        span.fg.equals(theme.text.feedback.success.base)
      );
      const subdued = bullets.filter(span => span.fg.equals(theme.text.muted));
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
