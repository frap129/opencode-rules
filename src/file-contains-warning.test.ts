import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRuleMetadata } from './rule-metadata.js';

const warnings: string[] = [];
vi.mock('./debug.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./debug.js')>();
  return {
    ...actual,
    logWarning: (context: string, error: unknown) => {
      warnings.push(
        `${context}: ${String((error as Error)?.message ?? error)}`
      );
    },
  };
});

describe('fail-closed fileContains warning', () => {
  beforeEach(() => {
    warnings.length = 0;
  });

  it('warns once for a declared but invalid fileContains', () => {
    expect(
      parseRuleMetadata('---\nfileContains: ""\n---\nbody')?.fileContains
    ).toEqual([]);
    expect(warnings.filter(w => w.includes('fileContains'))).toHaveLength(1);
  });

  it('does not warn when the field is absent or valid', () => {
    parseRuleMetadata('---\nglobs: ["**/*.ts"]\n---\nbody');
    parseRuleMetadata('---\nfileContains: "x"\n---\nbody');
    expect(warnings).toHaveLength(0);
  });
});
