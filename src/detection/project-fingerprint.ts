import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SIMPLE_MARKERS: Array<[string, string]> = [
  ['package.json', 'node'],
  ['pyproject.toml', 'python'],
  ['go.mod', 'go'],
  ['Cargo.toml', 'rust'],
  ['pnpm-workspace.yaml', 'monorepo'],
  ['turbo.json', 'monorepo'],
];

const BROWSER_EXTENSION_SIGNAL_KEYS = [
  'background',
  'content_scripts',
  'browser_action',
  'page_action',
  'action',
  'permissions',
];

export interface ProjectTagFs {
  access(filePath: string): Promise<void>;
  readFile(filePath: string, encoding: string): Promise<string>;
}

const nodeFs: ProjectTagFs = {
  access: path => fs.access(path),
  readFile: (path, encoding) => fs.readFile(path, encoding as BufferEncoding),
};

export interface ProjectTagFs {
  access(filePath: string): Promise<void>;
  readFile(filePath: string, encoding: string): Promise<string>;
}

async function fileExists(
  filePath: string,
  fs: ProjectTagFs
): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isBrowserExtensionManifest(
  manifestPath: string,
  fs: ProjectTagFs
): Promise<boolean> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return false;
    const version = parsed.manifest_version;
    if (version !== 2 && version !== 3) return false;
    return BROWSER_EXTENSION_SIGNAL_KEYS.some(key => key in parsed);
  } catch {
    return false;
  }
}

export async function detectProjectTags(
  projectDir: string,
  fs: ProjectTagFs = nodeFs
): Promise<string[]> {
  const tags = new Set<string>();

  const checks = SIMPLE_MARKERS.map(async ([marker, tag]) => {
    const markerPath = path.join(projectDir, marker);
    if (await fileExists(markerPath, fs)) {
      tags.add(tag);
    }
  });

  const manifestPath = path.join(projectDir, 'manifest.json');
  checks.push(
    (async () => {
      if (
        (await fileExists(manifestPath, fs)) &&
        (await isBrowserExtensionManifest(manifestPath, fs))
      ) {
        tags.add('browser-extension');
      }
    })()
  );

  await Promise.all(checks);

  return [...tags].sort((a, b) => a.localeCompare(b));
}
