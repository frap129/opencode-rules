import { describe, it, expect } from 'vitest';
import { themeColors, projectDirectory } from './adapt.js';

const fakeTheme = {
  text: {
    default: '#ffffff',
    subdued: '#888888',
    feedback: { success: { default: '#00aa00' } },
  },
};

describe('themeColors', () => {
  it('maps v2 tokens to sidebar colors', () => {
    expect(themeColors(fakeTheme)).toEqual({
      text: '#ffffff',
      textMuted: '#888888',
      success: '#00aa00',
    });
  });
});

describe('projectDirectory', () => {
  it('reads the default location directory', () => {
    const location = { default: () => ({ directory: '/some/project' }) };
    expect(projectDirectory(location)).toBe('/some/project');
  });
});
