import type { Plugin as TuiPluginNamespace } from '@opencode-ai/plugin/tui';
import type { RGBA } from '@opentui/core';
import { logWarning } from '../../src/shared/debug.js';

export type SidebarColor = RGBA | string | undefined;

export interface SidebarColors {
  text: SidebarColor;
  subdued: SidebarColor;
  success: SidebarColor;
}

type TokenMap = Record<string, unknown>;

// Color values are hex strings or RGBA-shaped objects. Duck-typing instead of
// instanceof: host theme values may come from a different @opentui/core copy.
function isColorValue(value: unknown): value is RGBA | string {
  if (typeof value === 'string') return value.length > 0;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RGBA).r === 'number' &&
    typeof (value as RGBA).equals === 'function'
  );
}

function pickColor(root: TokenMap, paths: string[][]): SidebarColor {
  for (const keys of paths) {
    let cursor: unknown = root;
    for (const key of keys) {
      if (typeof cursor !== 'object' || cursor === null) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as TokenMap)[key];
    }
    if (isColorValue(cursor)) return cursor;
  }
  return undefined;
}

// Flat runtime shape first (the running host uses theme.text/muted/success),
// then legacy wrapper and nested shapes.
const TEXT_PATHS: string[][] = [
  ['text'],
  ['current', 'text'],
  ['text', 'base'],
  ['text', 'default'],
];
const SUBDUED_PATHS: string[][] = [
  ['muted'],
  ['textMuted'],
  ['current', 'muted'],
  ['current', 'textMuted'],
  ['text', 'muted'],
  ['text', 'subdued'],
];
const SUCCESS_PATHS: string[][] = [
  ['success'],
  ['current', 'success'],
  ['text', 'feedback', 'success', 'base'],
  ['text', 'feedback', 'success', 'default'],
];

export function resolveSidebarColors(
  theme: TuiPluginNamespace.Context['theme']
): SidebarColors {
  const root = (theme ?? {}) as unknown as TokenMap;
  const colors: SidebarColors = {
    text: pickColor(root, TEXT_PATHS),
    subdued: pickColor(root, SUBDUED_PATHS),
    success: pickColor(root, SUCCESS_PATHS),
  };

  const missing = (Object.keys(colors) as Array<keyof SidebarColors>).filter(
    key => colors[key] === undefined
  );
  if (missing.length > 0) {
    logWarning('sidebar theme colors unresolved', {
      missing,
      themeKeys: Object.keys(root),
    });
  }
  return colors;
}

export function fgProps(color: SidebarColor): { fg?: string | RGBA } {
  return color === undefined ? {} : { fg: color };
}
