import { describe, it, expect } from 'vitest';
import {
  normalizeObservations,
  type RawToolEvent,
} from './file-observation.js';

const readEvent = (overrides: Partial<RawToolEvent> = {}): RawToolEvent => ({
  tool: 'read',
  args: { filePath: 'src/lib.rs' },
  output: undefined,
  ...overrides,
});

describe('normalizeToolObservation: unsupported tools', () => {
  it('yields no observation for grep, glob, bash, and unknown tools', () => {
    for (const tool of ['grep', 'glob', 'bash', 'webfetch', 'custom_tool']) {
      expect(
        normalizeObservations(
          readEvent({ tool, args: { filePath: 'src/a.ts' }, output: 'text' })
        )
      ).toEqual([]);
    }
  });

  it('yields no observation for failed calls or empty paths', () => {
    expect(
      normalizeObservations(readEvent({ args: { filePath: '' } }))
    ).toEqual([]);
    expect(
      normalizeObservations(readEvent({ args: { filePath: 42 } }))
    ).toEqual([]);
    expect(normalizeObservations(readEvent({ args: undefined }))).toEqual([]);
    expect(normalizeObservations(readEvent({ args: null }))).toEqual([]);
  });
});

describe('normalizeToolObservation: write', () => {
  it('uses verbatim submitted content keyed to the submitted path', () => {
    expect(
      normalizeObservations(
        readEvent({
          tool: 'write',
          args: { filePath: 'src/a.ts', content: 'const x = 1;\n' },
        })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'write', content: 'const x = 1;\n' }]);
  });

  it('yields a path-only observation when content is not a string', () => {
    expect(
      normalizeObservations(
        readEvent({ tool: 'write', args: { filePath: 'src/a.ts' } })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'write', content: '' }]);
  });
});

describe('normalizeToolObservation: edit', () => {
  it('contributes removed oldString plus added newString', () => {
    expect(
      normalizeObservations(
        readEvent({
          tool: 'edit',
          args: {
            filePath: 'src/a.ts',
            oldString: 'foo\nbar',
            newString: 'baz',
          },
        })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'edit', content: 'foo\nbar\nbaz' }]);
  });

  it('preserves removed text for a pure-deletion edit', () => {
    expect(
      normalizeObservations(
        readEvent({
          tool: 'edit',
          args: {
            filePath: 'src/a.ts',
            oldString: 'TODO: remove\nsecond line',
            newString: '',
          },
        })
      )
    ).toEqual([
      {
        path: 'src/a.ts',
        tool: 'edit',
        content: 'TODO: remove\nsecond line',
      },
    ]);
  });

  it('degrades malformed old/new arguments to a path-only observation', () => {
    expect(
      normalizeObservations(
        readEvent({ tool: 'edit', args: { filePath: 'src/a.ts' } })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'edit', content: '' }]);
    expect(
      normalizeObservations(
        readEvent({
          tool: 'edit',
          args: { filePath: 'src/a.ts', oldString: 42, newString: 'baz' },
        })
      )
    ).toEqual([{ path: 'src/a.ts', tool: 'edit', content: '' }]);
  });
});

describe('normalizeToolObservation: lsp', () => {
  it('keys raw successful output to the queried file path', () => {
    const rawOutput = '<content>1: symbol</content>';
    expect(
      normalizeObservations(
        readEvent({
          tool: 'lsp',
          args: { filePath: 'src/a.ts' },
          output: rawOutput,
        })
      )
    ).toEqual([
      {
        path: 'src/a.ts',
        tool: 'lsp',
        content: rawOutput,
      },
    ]);
  });

  it('has no path arg mapped for lsp', () => {
    expect(normalizeObservations(readEvent({ tool: 'lsp', args: {} }))).toEqual(
      []
    );
  });
});

describe('normalizeToolObservation: MCP file paths', () => {
  it('extracts path= from MCP output regardless of language', () => {
    const output1C = [
      '# scope=core',
      'path=Documents/Заказ покупателя/Forms/Форма/Ext/Form/Module.bsl lines=10-25',
      '--- code ---',
      'Процедура Тест()',
    ].join('\n');

    expect(
      normalizeObservations({
        tool: 'mcp__1c-index__read_method',
        args: {},
        output: output1C,
      })
    ).toEqual([
      {
        path: 'Documents/Заказ покупателя/Forms/Форма/Ext/Form/Module.bsl',
        tool: 'mcp__1c-index__read_method',
        content: output1C,
      },
    ]);

    const outputTS = 'path=src/components/Button.tsx lines=1-20';
    expect(
      normalizeObservations({
        tool: 'mcp__code_indexer__read',
        args: {},
        output: outputTS,
      })
    ).toEqual([
      {
        path: 'src/components/Button.tsx',
        tool: 'mcp__code_indexer__read',
        content: outputTS,
      },
    ]);
  });

  it('extracts module_path= and file= attributes', () => {
    expect(
      normalizeObservations({
        tool: 'mcp__analyzer__object_info',
        args: {},
        output: 'module_path=services/auth.py',
      })
    ).toEqual([
      {
        path: 'services/auth.py',
        tool: 'mcp__analyzer__object_info',
        content: 'module_path=services/auth.py',
      },
    ]);

    expect(
      normalizeObservations({
        tool: 'mcp__filesystem__get_file',
        args: {},
        output: 'file="src/My File.rs"',
      })
    ).toEqual([
      {
        path: 'src/My File.rs',
        tool: 'mcp__filesystem__get_file',
        content: 'file="src/My File.rs"',
      },
    ]);
  });

  it('extracts paths from grep-style output and caps at five', () => {
    const output = [
      '- src/core/a.go:10 found',
      '- src/core/b.go:20 found',
      '- src/core/c.go:30 found',
      '- src/core/d.go:40 found',
      '- src/core/e.go:50 found',
      '- src/core/f.go:60 found',
    ].join('\n');

    const observations = normalizeObservations({
      tool: 'mcp__ripgrep__search',
      args: {},
      output,
    });

    expect(observations).toHaveLength(5);
    expect(observations.map(o => o.path)).toEqual([
      'src/core/a.go',
      'src/core/b.go',
      'src/core/c.go',
      'src/core/d.go',
      'src/core/e.go',
    ]);
  });

  it('supports JSON MCP results', () => {
    const output = JSON.stringify({
      path: 'src/app.ts',
      results: [{ file_path: 'src/lib/a.py' }],
    });

    const observations = normalizeObservations({
      tool: 'mcp__code_indexer__search',
      args: {},
      output,
    });

    expect(observations.map(o => o.path)).toEqual([
      'src/app.ts',
      'src/lib/a.py',
    ]);
  });

  it('normalizes Windows separators and keeps spaces in paths', () => {
    const output = 'path=C:\\repo\\src\\My File.ts lines=1-2';

    expect(
      normalizeObservations({
        tool: 'mcp__filesystem__read',
        args: {},
        output,
      })
    ).toEqual([
      {
        path: 'C:/repo/src/My File.ts',
        tool: 'mcp__filesystem__read',
        content: output,
      },
    ]);
  });

  it('extracts Cyrillic grep rows and ignores URLs and plain text', () => {
    expect(
      normalizeObservations({
        tool: '1c-index_search_code',
        args: {},
        output: '- Documents/Заказ покупателя/Module.bsl:42 found',
      }).map(o => o.path)
    ).toEqual(['Documents/Заказ покупателя/Module.bsl']);

    expect(
      normalizeObservations({
        tool: 'mcp__search__run',
        args: {},
        output: 'See https://example.com/docs.ts for details\nJust plain text',
      })
    ).toEqual([]);
  });

  it('uses path-like MCP arguments when the output has no path', () => {
    const output = '<file contents>';

    expect(
      normalizeObservations({
        tool: 'mcp__filesystem__read_file',
        args: { path: 'src/App.vue' },
        output,
      })
    ).toEqual([
      {
        path: 'src/App.vue',
        tool: 'mcp__filesystem__read_file',
        content: output,
      },
    ]);
  });
});
