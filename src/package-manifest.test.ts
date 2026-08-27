import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type PackageManifest = {
  scripts?: {
    build?: string;
  };
  exports?: {
    './tui'?: {
      import?: string;
    };
  };
};

const packagePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../package.json'
);

describe('package manifest', () => {
  it('exports the compiled TUI entrypoint', async () => {
    const manifest = JSON.parse(
      await readFile(packagePath, 'utf8')
    ) as PackageManifest;

    expect(manifest.exports?.['./tui']?.import).toBe('./dist/tui/index.js');
    expect(manifest.scripts?.build).toContain('bun run build-tui.mjs');
  });
});
