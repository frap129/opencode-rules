import { describe, it, expect, vi } from 'vitest';

import { detectProjectTags, type ProjectTagFs } from './project-fingerprint.js';

describe('detectProjectTags', () => {
  it('returns "node" tag when package.json exists', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('package.json')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toContain('node');
  });

  it('returns "python" tag when pyproject.toml exists', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('pyproject.toml')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toContain('python');
  });

  it('returns "go" tag when go.mod exists', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('go.mod')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toContain('go');
  });

  it('returns "rust" tag when Cargo.toml exists', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('Cargo.toml')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toContain('rust');
  });

  it('returns "monorepo" tag when pnpm-workspace.yaml exists', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('pnpm-workspace.yaml')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toContain('monorepo');
  });

  it('returns "monorepo" tag when turbo.json exists', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('turbo.json')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toContain('monorepo');
  });

  it('returns "browser-extension" tag when manifest.json with browser extension keys exists', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) {
          return JSON.stringify({
            manifest_version: 3,
            background: { service_worker: 'bg.js' },
          });
        }
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toContain('browser-extension');
  });

  it('does not return "browser-extension" for non-extension manifest.json', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) {
          return JSON.stringify({ name: 'some-package', version: '1.0.0' });
        }
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).not.toContain('browser-extension');
  });

  it('returns deterministic sorted tag output', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        const p = String(filePath);
        if (
          p.endsWith('package.json') ||
          p.endsWith('pyproject.toml') ||
          p.endsWith('Cargo.toml')
        ) {
          return;
        }
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toEqual(['node', 'python', 'rust']);
    expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)));
  });

  it('uses explicit comparator function for sorting', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        const p = String(filePath);
        if (p.endsWith('package.json') || p.endsWith('pyproject.toml')) {
          return;
        }
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toEqual(['node', 'python']);
  });

  it('returns empty array when no markers exist', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toEqual([]);
  });

  it('tolerates unreadable files by skipping them', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        const p = String(filePath);
        if (p.endsWith('package.json')) return;
        if (p.endsWith('manifest.json')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('EACCES');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toContain('node');
    expect(tags).not.toContain('browser-extension');
  });

  it('returns unique tags even when multiple markers map to same tag', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        const p = String(filePath);
        if (p.endsWith('pnpm-workspace.yaml') || p.endsWith('turbo.json'))
          return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags.filter(t => t === 'monorepo')).toHaveLength(1);
  });

  it('does not tag browser-extension for manifest with only generic keys like permissions', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) {
          return JSON.stringify({ permissions: ['storage'] });
        }
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).not.toContain('browser-extension');
  });

  it('does not throw and does not tag for invalid JSON manifest', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) {
          return '{ invalid json }';
        }
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).not.toContain('browser-extension');
  });

  it('does not tag browser-extension for non-object JSON payloads (null/array/string)', async () => {
    const nonObjectPayloads = ['null', '[]', '"string"', '123'];

    for (const payload of nonObjectPayloads) {
      const fs: ProjectTagFs = {
        access: vi.fn(async filePath => {
          if (String(filePath).endsWith('manifest.json')) return;
          throw new Error('ENOENT');
        }),
        readFile: vi.fn(async filePath => {
          if (String(filePath).endsWith('manifest.json')) {
            return payload;
          }
          throw new Error('ENOENT');
        }),
      };

      const tags = await detectProjectTags('/project', fs);
      expect(tags).not.toContain('browser-extension');
    }
  });

  it('does not tag browser-extension for manifest_version 3 alone without signal keys', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) {
          return JSON.stringify({ manifest_version: 3 });
        }
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).not.toContain('browser-extension');
  });

  it('tags browser-extension for manifest_version 3 with MV3 action key', async () => {
    const fs: ProjectTagFs = {
      access: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn(async filePath => {
        if (String(filePath).endsWith('manifest.json')) {
          return JSON.stringify({ manifest_version: 3, action: {} });
        }
        throw new Error('ENOENT');
      }),
    };

    const tags = await detectProjectTags('/project', fs);
    expect(tags).toContain('browser-extension');
  });
});
