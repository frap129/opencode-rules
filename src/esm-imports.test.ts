import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOTS = ['src', 'tui'] as const;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;
const ALLOWED_RUNTIME_EXTENSIONS = new Set(['.js', '.json', '.css', '.wasm']);

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
      continue;
    }

    if (
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !TEST_FILE_PATTERN.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function findExtensionlessRelativeImports(source: string): string[] {
  const findings: string[] = [];
  const staticImportPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
  const dynamicImportPattern = /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!ALLOWED_RUNTIME_EXTENSIONS.has(path.extname(specifier))) {
        findings.push(specifier);
      }
    }
  }

  return findings;
}

describe('ESM import specifiers', () => {
  it('uses explicit runtime extensions for relative imports', async () => {
    const files = (
      await Promise.all(SOURCE_ROOTS.map(root => collectSourceFiles(root)))
    ).flat();
    const failures: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf-8');
      for (const specifier of findExtensionlessRelativeImports(source)) {
        failures.push(`${file}: ${specifier}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
