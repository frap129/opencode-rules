import { describe, expect, it } from 'vitest';
import { RGBA } from '@opentui/core';
import type { Plugin as TuiPluginNamespace } from '@opencode/plugin/tui';
import { fgProps, resolveSidebarColors } from './theme-colors.js';

const text = RGBA.fromInts(10, 20, 30);
const subdued = RGBA.fromInts(40, 50, 60);
const success = RGBA.fromInts(70, 80, 90);

type Theme = TuiPluginNamespace.Context['theme'];

const asTheme = (value: unknown): Theme => value as Theme;

describe('resolveSidebarColors', () => {
  it('reads the resolved 2.2.0 theme tokens', () => {
    expect(
      resolveSidebarColors(
        asTheme({
          text: {
            base: text,
            muted: subdued,
            feedback: { success: { base: success } },
          },
        })
      )
    ).toEqual({ text, subdued, success });
  });
});

describe('fgProps', () => {
  it('omits fg for undefined colors', () => {
    expect(fgProps(undefined)).toEqual({});
  });

  it('spreads fg for defined colors', () => {
    expect(fgProps(text)).toEqual({ fg: text });
  });
});
