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
// globs).
function readContent(output: string | undefined): string | null | undefined {
  if (output === undefined) return undefined;
  if (/<type>directory<\/type>/i.test(output)) return null;
  const contentMatch = /<content>([\s\S]*?)<\/content>/.exec(output);
  if (!contentMatch) {
    return '';
  }
  return contentMatch[1]
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
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

export function normalizeObservations(event: RawToolEvent): FileObservation[] {
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
