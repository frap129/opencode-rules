import { describe, expect, it } from 'vitest';
import { RGBA } from '@opentui/core';
import type { Plugin as TuiPluginNamespace } from '@opencode-ai/plugin/tui';
import { fgProps, resolveSidebarColors } from './theme-colors.js';

const text = RGBA.fromInts(10, 20, 30);
const subdued = RGBA.fromInts(40, 50, 60);
const success = RGBA.fromInts(70, 80, 90);

type Theme = TuiPluginNamespace.Context['theme'];

const asTheme = (value: unknown): Theme => value as Theme;

describe('resolveSidebarColors', () => {
  it('reads the flat runtime shape (text/muted/success)', () => {
    expect(
      resolveSidebarColors(asTheme({ text, muted: subdued, success }))
    ).toEqual({ text, subdued, success });
  });

  it('reads the flat legacy shape (text/textMuted/success)', () => {
    expect(
      resolveSidebarColors(asTheme({ text, textMuted: subdued, success }))
    ).toEqual({ text, subdued, success });
  });

  it('reads the v1 wrapper shape (current.*)', () => {
    expect(
      resolveSidebarColors(
        asTheme({ current: { text, textMuted: subdued, success } })
      )
    ).toEqual({ text, subdued, success });
  });

  it('reads the nested v2 shape (text.default/subdued, feedback.success.default)', () => {
    expect(
      resolveSidebarColors(
        asTheme({
          text: {
            default: text,
            subdued,
            feedback: { success: { default: success } },
          },
        })
      )
    ).toEqual({ text, subdued, success });
  });

  it('reads the renamed nested shape (text.base/muted, feedback.success.base)', () => {
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

  it('passes hex strings through unchanged', () => {
    expect(
      resolveSidebarColors(asTheme({ text: '#aabbcc', muted: '#112233' }))
    ).toEqual({ text: '#aabbcc', subdued: '#112233', success: undefined });
  });

  it('returns undefined slots for unknown shapes without throwing', () => {
    expect(resolveSidebarColors(asTheme({ unrelated: 1 }))).toEqual({
      text: undefined,
      subdued: undefined,
      success: undefined,
    });
  });
});

describe('fgProps', () => {
  it('omits fg for undefined colors', () => {
    expect(fgProps(undefined)).toEqual({});
  });

  it('spreads fg for defined colors', () => {
    expect(fgProps(text)).toEqual({ fg: text });
    expect(fgProps('#aabbcc')).toEqual({ fg: '#aabbcc' });
  });
});
