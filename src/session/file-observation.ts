// One successful file-handling tool event yields one File observation per
// file: a flat { path, tool, content } record where content is that file's
// contribution text. Both globs and fileContains evaluate the same record.
// Paths are consumed verbatim as the after-hook receives them.

export interface FileObservation {
  path: string;
  tool: string;
  content: string;
}

export interface RawToolEvent {
  tool: string;
  args: unknown;
  output?: string;
}

export interface HistoryToolPart {
  type?: unknown;
  tool?: unknown;
  state?: {
    status?: unknown;
    input?: unknown;
    output?: unknown;
  };
  /** Legacy AI SDK invocation shape. */
  toolInvocation?: {
    toolName?: unknown;
    args?: unknown;
  };
}

const OBSERVATION_TOOLS = new Set([
  'read',
  'write',
  'edit',
  'apply_patch',
  'lsp',
]);

function completedInput(part: HistoryToolPart): unknown {
  if (typeof part.tool !== 'string') return undefined;
  if (part.state?.status !== 'completed') return undefined;
  return part.state.input;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Directory listings yield no observation; binary, image, PDF, and other
// unrecognized formats fail closed with empty content (path still matches
// globs). v2 read output is a "Read file <path>, lines N-M" header followed
// by "N: " numbered lines; the legacy <content> wrapper is still parsed for
// older peers.
function readContent(output: string | undefined): string | null | undefined {
  if (output === undefined) return undefined;
  if (
    /<type>directory<\/type>/i.test(output) ||
    /^Read directory /.test(output)
  ) {
    return null;
  }
  const contentMatch = /<content>([\s\S]*?)<\/content>/.exec(output);
  if (contentMatch) {
    return stripLineNumbers(
      contentMatch[1].replace(/^\n+/, '').replace(/\n+$/, '')
    );
  }
  if (!/^Read file /.test(output)) return '';
  return stripLineNumbers(output.replace(/^Read file [^\n]*\n?/, ''));
}

function stripLineNumbers(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/^\s*\d+:\s?/, ''))
    .join('\n');
}

// Delete File sections are path-only: their lines never become content.
function parsePatch(patchText: string): FileObservation[] | undefined {
  const isPatch =
    patchText.includes('*** Begin Patch') ||
    patchText.includes('*** Update File:');
  if (!isPatch) return undefined;

  const observations: FileObservation[] = [];
  let currentPath: string | undefined;
  let currentLines: string[] = [];
  let currentIsDelete = false;
  let sawStructure = false;

  const flush = (): void => {
    if (currentPath !== undefined) {
      observations.push({
        path: currentPath,
        tool: 'apply_patch',
        content: currentIsDelete ? '' : currentLines.join('\n'),
      });
    }
    currentPath = undefined;
    currentLines = [];
    currentIsDelete = false;
  };

  for (const line of patchText.split('\n')) {
    const add = /\*\*\* Add File: (.+)/.exec(line);
    const del = /\*\*\* Delete File: (.+)/.exec(line);
    const update = /\*\*\* Update File: (.+)/.exec(line);
    // Upstream emits `*** Move to:`; older peers used `*** Move To:`.
    const moveTo = /\*\*\* Move (?:to|To): (.+)/.exec(line);
    if (add || del || update) {
      flush();
      sawStructure = true;
      const header = add ?? del ?? update;
      currentPath = header?.[1].trim();
      currentIsDelete = del !== null;
      continue;
    }
    if (moveTo) {
      currentPath = moveTo[1].trim();
      continue;
    }
    if (currentPath === undefined) continue;
    if (line.startsWith('@@') || line.startsWith('***')) continue;
    const stripped = line.replace(/^[+-]/, '');
    currentLines.push(stripped);
  }
  flush();

  if (!sawStructure) return undefined;
  return observations;
}

function summaryPaths(output: string | undefined): FileObservation[] {
  if (!output) return [];
  const result: FileObservation[] = [];
  for (const line of output.split('\n')) {
    const move = /^R\s+(\S+)\s+->\s+(\S+)\s*$/.exec(line);
    const simple = /^([ADM])\s+(\S+)\s*$/.exec(line);
    if (move) {
      result.push({ path: move[2], tool: 'apply_patch', content: '' });
    } else if (simple) {
      result.push({ path: simple[2], tool: 'apply_patch', content: '' });
    }
  }
  return result;
}

// MCP tools are not part of OBSERVATION_TOOLS. Code-navigation MCP servers
// (1c-index, ripgrep wrappers, language indexers, filesystem/memory servers)
// report workspace paths in their output. Parse those into ordinary file
// observations so glob rules auto-attach when the agent inspects code through
// MCP instead of the native read tool.
//
// OpenCode names MCP tools either "mcp__<server>__<tool>" or
// "<server>_<tool>" (for example "1c-index_read_method"), so detect a known
// operation segment rather than hard-coding one server's full tool names.
const MCP_TOOL_SEGMENTS = new Set([
  'read',
  'find',
  'search',
  'lookup',
  'inspect',
  'info',
  'get',
  'grep',
  'list',
  'scan',
  'query',
  'glob',
]);

// Native tools keep their own observation path; do not parse their output here.
const NATIVE_TOOL_NAMES = new Set([
  ...OBSERVATION_TOOLS,
  'bash',
  'shell',
  'webfetch',
  'websearch',
  'glob',
  'grep',
  'task',
  'skill',
]);

function isMcpFileTool(tool: string): boolean {
  if (tool.startsWith('mcp__')) return true;
  if (NATIVE_TOOL_NAMES.has(tool)) return false;
  return tool
    .toLowerCase()
    .split(/[_-]+/)
    .some(segment => MCP_TOOL_SEGMENTS.has(segment));
}

// path=src/app.ts, file="src/app.ts", module_path=..., filePath=...
const PATH_KEY_PATTERN =
  /(?:^|[\s,;])(path|file|file_path|filePath|filepath|relative_path|relativePath|module_path|modulePath|filename|file_name)\s*=\s*/g;

const JSON_PATH_KEY =
  /^(?:path|file|file_?path|relative_?path|module_?path|filename|file_?name)$/i;

const PATH_EXTENSION = /\.[A-Za-z0-9_-]{1,12}$/;
const URL_LIKE = /^(?:https?:|\/\/|file:|www\.)/i;
const IGNORED_PATH_PREFIXES = /^(?:node_modules\/|\.git\/)/i;
const ILLEGAL_PATH_CHARS = /[*?"<>|]/;

function readPathValue(line: string, valueStart: number): string | undefined {
  let start = valueStart;
  while (line[start] === ' ' || line[start] === '\t') start++;

  const quote = line[start];
  if (quote === '"' || quote === "'") {
    const end = line.indexOf(quote, start + 1);
    return (
      end === -1 ? line.slice(start + 1) : line.slice(start + 1, end)
    ).trim();
  }

  const rest = line.slice(start);
  // A path may contain spaces; stop at the next key= pair or punctuation.
  const stop = /\s+(?=[A-Za-z_][A-Za-z0-9_]*\s*=)|\s*[,;)]/.exec(rest);
  const value = (stop ? rest.slice(0, stop.index) : rest).trim();
  return value || undefined;
}

function kvPaths(line: string): string[] {
  const values: string[] = [];
  for (const match of line.matchAll(PATH_KEY_PATTERN)) {
    const value = readPathValue(line, (match.index ?? 0) + match[0].length);
    if (value) values.push(value);
  }
  return values;
}

function linePath(line: string): string | undefined {
  let rest = line.trim().replace(/^(?:[-*>]|→|->)\s*/, '');

  // path/to/file.ext:42 or path/to/file.ext:42:7
  const withLine = /^(.+?\.([A-Za-z0-9_-]{1,12}))(?::\d+)(?::\d+)?\b/.exec(
    rest
  );
  if (withLine) return withLine[1].trim();

  // A bare path line from an MCP file-list/glob result.
  if (rest.includes('=')) return undefined;
  const bare = /^(.+?\.([A-Za-z0-9_-]{1,12}))\s*$/.exec(rest);
  return bare ? bare[1].trim() : undefined;
}

function collectJsonPaths(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonPaths(item, out, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (JSON_PATH_KEY.test(key)) {
      if (typeof child === 'string') {
        out.add(child);
      } else if (Array.isArray(child)) {
        for (const item of child) {
          if (typeof item === 'string') out.add(item);
        }
      }
    }
    collectJsonPaths(child, out, depth + 1);
  }
}

function argPaths(args: unknown): string[] {
  const paths: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 3 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (JSON_PATH_KEY.test(key)) {
        if (typeof child === 'string') {
          paths.push(child);
        } else if (Array.isArray(child)) {
          for (const item of child) {
            if (typeof item === 'string') paths.push(item);
          }
        }
      }
      walk(child, depth + 1);
    }
  };
  walk(args, 0);
  return paths;
}

function normalizePathCandidate(raw: string): string | undefined {
  let value = raw.trim().replace(/^[("'`]+|[)"'`,;]+$/g, '');
  if (!value) return undefined;

  // Normalize Windows separators so minimatch sees one path shape.
  value = value.replace(/\\/g, '/');

  if (URL_LIKE.test(value) || IGNORED_PATH_PREFIXES.test(value)) {
    return undefined;
  }
  if (ILLEGAL_PATH_CHARS.test(value)) return undefined;
  if (!PATH_EXTENSION.test(value)) return undefined;

  const basename = value.split('/').pop() ?? value;
  const dot = basename.lastIndexOf('.');
  const stem = dot > 0 ? basename.slice(0, dot) : '';
  if (!stem) return undefined;
  // Reject version-like tokens such as "1.2.3" that slipped through a line.
  if (!/\p{L}/u.test(stem) && !value.includes('/')) return undefined;

  return value;
}

function mcpObservations(event: RawToolEvent): FileObservation[] {
  const tool = event.tool;
  if (!isMcpFileTool(tool)) return [];

  const output = asString(event.output);
  if (!output) return [];

  const paths = new Set<string>();
  const add = (raw: string | undefined): void => {
    if (!raw) return;
    const normalized = normalizePathCandidate(raw);
    if (normalized) paths.add(normalized);
  };

  // Some MCP servers take the path as an argument and return only content.
  for (const value of argPaths(event.args)) add(value);

  for (const line of output.split(/\r?\n/)) {
    const kv = kvPaths(line);
    if (kv.length > 0) {
      for (const value of kv) add(value);
      continue;
    }
    add(linePath(line));
  }

  const trimmed = output.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const jsonPaths = new Set<string>();
      collectJsonPaths(parsed, jsonPaths);
      for (const value of jsonPaths) add(value);
    } catch {
      // Not JSON; the line parser above already handled the text form.
    }
  }

  return [...paths].slice(0, 5).map(path => ({ path, tool, content: output }));
}

export function normalizeObservations(event: RawToolEvent): FileObservation[] {
  const mcp = mcpObservations(event);
  if (mcp.length > 0) return mcp;

  if (!OBSERVATION_TOOLS.has(event.tool)) return [];
  if (!event.args || typeof event.args !== 'object') return [];
  const args = event.args as Record<string, unknown>;

  const path = asString(args.filePath) ?? asString(args.path);

  switch (event.tool) {
    case 'write':
      return path
        ? [{ path, tool: 'write', content: asString(args.content) ?? '' }]
        : [];
    case 'edit': {
      if (!path) return [];
      // Empty submitted strings count, so pure deletions keep their removed
      // text; malformed args degrade to a path-only observation.
      const oldString =
        typeof args.oldString === 'string' ? args.oldString : undefined;
      const newString =
        typeof args.newString === 'string' ? args.newString : undefined;
      const content =
        oldString !== undefined && newString !== undefined
          ? [oldString, newString].filter(value => value.length > 0).join('\n')
          : '';
      return [{ path, tool: 'edit', content }];
    }
    case 'apply_patch': {
      const patchText = asString(args.patchText);
      if (patchText) {
        const parsed = parsePatch(patchText);
        if (parsed) return parsed;
      }
      // An applied but unparseable patch still yielded file writes; the
      // model-visible summary is the only record of which paths.
      return summaryPaths(event.output);
    }
    case 'read':
    case 'lsp': {
      if (!path) return [];
      const content =
        event.tool === 'lsp'
          ? (asString(event.output) ?? '')
          : readContent(event.output);
      if (content === null) return [];
      return [
        {
          path,
          tool: event.tool,
          content: content ?? '',
        },
      ];
    }
    default:
      return [];
  }
}

export function extractObservationsFromMessageParts(
  parts: readonly unknown[]
): FileObservation[] {
  const result: FileObservation[] = [];
  if (!Array.isArray(parts)) return result;

  for (const value of parts) {
    if (value === null || typeof value !== 'object') continue;
    const part = value as HistoryToolPart;

    // Current shape: completed tool parts carrying state.input.
    if (part.type === undefined || part.type === 'tool') {
      const input = completedInput(part);
      if (input !== undefined && typeof input === 'object') {
        const toolName = typeof part.tool === 'string' ? part.tool : undefined;
        if (toolName) {
          const state = part.state as { output?: unknown } | undefined;
          const output = asString(state?.output);
          result.push(
            ...normalizeObservations({
              tool: toolName,
              args: input,
              ...(output !== undefined ? { output } : {}),
            })
          );
          continue;
        }
      }
    }

    // Legacy AI SDK part shape, carrying no observable output.
    if (part.type === 'tool-invocation') {
      const invocation = part.toolInvocation;
      const toolName =
        typeof invocation?.toolName === 'string'
          ? invocation.toolName
          : undefined;
      if (!toolName || !invocation?.args) continue;
      result.push(
        ...normalizeObservations({ tool: toolName, args: invocation.args })
      );
    }
  }
  return result;
}
