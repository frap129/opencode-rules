import type { Plugin as TuiPluginNamespace } from '@opencode/plugin/tui';
import type { RGBA } from '@opentui/core';

export type SidebarColor = RGBA | undefined;

export interface SidebarColors {
  text: SidebarColor;
  subdued: SidebarColor;
  success: SidebarColor;
}

export function resolveSidebarColors(
  theme: TuiPluginNamespace.Context['theme']
): SidebarColors {
  return {
    text: theme.text.base,
    subdued: theme.text.muted,
    success: theme.text.feedback.success.base,
  };
}

export function fgProps(color: SidebarColor): { fg?: RGBA } {
  return color === undefined ? {} : { fg: color };
}
