/**
 * Minimal structural views of the v2 TUI context used by the sidebar.
 * Kept local (like src/v2-types.ts) to confine beta API churn.
 */

type ThemeColor = string | import('@opentui/core').RGBA;

export interface ThemeColors {
  text: ThemeColor;
  textMuted: ThemeColor;
  success: ThemeColor;
}

interface ResolvedThemeLike {
  readonly text: {
    readonly default: ThemeColor;
    readonly subdued: ThemeColor;
    readonly feedback: { readonly success: { readonly default: ThemeColor } };
  };
}

export function themeColors(theme: ResolvedThemeLike): ThemeColors {
  return {
    text: theme.text.default,
    textMuted: theme.text.subdued,
    success: theme.text.feedback.success.default,
  };
}

export function projectDirectory(location: {
  default(): { directory: string };
}): string {
  return location.default().directory;
}
