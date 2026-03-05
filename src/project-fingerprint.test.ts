import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';

import { detectProjectTags } from './project-fingerprint.js';

vi.mock('fs/promises');

const mockedFs = vi.mocked(fs);

describe('detectProjectTags', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "node" tag when package.json exists', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('package.json')) return;
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).toContain('node');
  });

  it('returns "python" tag when pyproject.toml exists', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('pyproject.toml')) return;
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).toContain('python');
  });

  it('returns "go" tag when go.mod exists', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('go.mod')) return;
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).toContain('go');
  });

  it('returns "rust" tag when Cargo.toml exists', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('Cargo.toml')) return;
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).toContain('rust');
  });

  it('returns "monorepo" tag when pnpm-workspace.yaml exists', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('pnpm-workspace.yaml')) return;
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).toContain('monorepo');
  });

  it('returns "monorepo" tag when turbo.json exists', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('turbo.json')) return;
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).toContain('monorepo');
  });

  it('returns "browser-extension" tag when manifest.json with browser extension keys exists', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) return;
      throw new Error('ENOENT');
    });
    mockedFs.readFile.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) {
        return JSON.stringify({
          manifest_version: 3,
          background: { service_worker: 'bg.js' },
        });
      }
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).toContain('browser-extension');
  });

  it('does not return "browser-extension" for non-extension manifest.json', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) return;
      throw new Error('ENOENT');
    });
    mockedFs.readFile.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) {
        return JSON.stringify({ name: 'some-package', version: '1.0.0' });
      }
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).not.toContain('browser-extension');
  });

  it('returns deterministic sorted tag output', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      const p = String(filePath);
      if (
        p.endsWith('package.json') ||
        p.endsWith('pyproject.toml') ||
        p.endsWith('Cargo.toml')
      ) {
        return;
      }
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).toEqual(['node', 'python', 'rust']);
    // Verify explicit lexicographic sort comparator is used
    expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)));
  });

  it('returns empty array when no markers exist', async () => {
    mockedFs.access.mockRejectedValue(new Error('ENOENT'));

    const tags = await detectProjectTags('/project');
    expect(tags).toEqual([]);
  });

  it('tolerates unreadable files by skipping them', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      const p = String(filePath);
      if (p.endsWith('package.json')) return;
      if (p.endsWith('manifest.json')) return;
      throw new Error('ENOENT');
    });
    mockedFs.readFile.mockRejectedValue(new Error('EACCES'));

    const tags = await detectProjectTags('/project');
    expect(tags).toContain('node');
    expect(tags).not.toContain('browser-extension');
  });

  it('returns unique tags even when multiple markers map to same tag', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      const p = String(filePath);
      if (p.endsWith('pnpm-workspace.yaml') || p.endsWith('turbo.json')) return;
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags.filter(t => t === 'monorepo')).toHaveLength(1);
  });

  it('does not tag browser-extension for manifest with only generic keys like permissions', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) return;
      throw new Error('ENOENT');
    });
    mockedFs.readFile.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) {
        return JSON.stringify({ permissions: ['storage'] });
      }
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).not.toContain('browser-extension');
  });

  it('does not throw and does not tag for invalid JSON manifest', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) return;
      throw new Error('ENOENT');
    });
    mockedFs.readFile.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) {
        return '{ invalid json }';
      }
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).not.toContain('browser-extension');
  });

  it('does not tag browser-extension for non-object JSON payloads (null/array/string)', async () => {
    const nonObjectPayloads = ['null', '[]', '"string"', '123'];

    for (const payload of nonObjectPayloads) {
      vi.resetAllMocks();
      mockedFs.access.mockImplementation(async filePath => {
        if (String(filePath).endsWith('manifest.json')) return;
        throw new Error('ENOENT');
      });
      mockedFs.readFile.mockImplementation(async filePath => {
        if (String(filePath).endsWith('manifest.json')) {
          return payload;
        }
        throw new Error('ENOENT');
      });

      const tags = await detectProjectTags('/project');
      expect(tags).not.toContain('browser-extension');
    }
  });

  it('does not tag browser-extension for manifest_version 3 alone without signal keys', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) return;
      throw new Error('ENOENT');
    });
    mockedFs.readFile.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) {
        return JSON.stringify({ manifest_version: 3 });
      }
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).not.toContain('browser-extension');
  });

  it('tags browser-extension for manifest_version 3 with MV3 action key', async () => {
    mockedFs.access.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) return;
      throw new Error('ENOENT');
    });
    mockedFs.readFile.mockImplementation(async filePath => {
      if (String(filePath).endsWith('manifest.json')) {
        return JSON.stringify({ manifest_version: 3, action: {} });
      }
      throw new Error('ENOENT');
    });

    const tags = await detectProjectTags('/project');
    expect(tags).toContain('browser-extension');
  });
});
