import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveStateDir,
  getStateFilePath,
  writeActiveRulesState,
  readActiveRulesState,
  _setStateDirForTesting,
} from './active-rules-state.js';

describe('active-rules-state', () => {
  let testStateDir: string;

  beforeEach(async () => {
    // Create a temp directory for tests
    const testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'active-rules-test-')
    );
    testStateDir = path.join(testDir, 'state');

    // Use test override instead of mocking os.homedir
    _setStateDirForTesting(testStateDir);
  });

  afterEach(async () => {
    // Reset the override
    _setStateDirForTesting(null);

    // Clean up test directory
    if (testStateDir) {
      try {
        // Go up one level to remove the whole temp dir
        const parentDir = path.dirname(testStateDir);
        await fs.rm(parentDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('resolveStateDir', () => {
    it('returns overridden path when set', () => {
      const stateDir = resolveStateDir();
      expect(stateDir).toBe(testStateDir);
    });

    it('returns default path when not overridden', () => {
      _setStateDirForTesting(null);
      const stateDir = resolveStateDir();
      expect(stateDir).toBe(
        path.join(os.homedir(), '.opencode', 'state', 'opencode-rules')
      );
    });
  });

  describe('getStateFilePath', () => {
    it('returns session-specific JSON path', () => {
      const filePath = getStateFilePath('ses_123');
      expect(filePath).toBe(path.join(testStateDir, 'ses_123.json'));
    });

    it('throws for sessionId with path traversal', () => {
      expect(() => getStateFilePath('../escape')).toThrow('Invalid sessionId');
      expect(() => getStateFilePath('foo/bar')).toThrow('Invalid sessionId');
      expect(() => getStateFilePath('/absolute')).toThrow('Invalid sessionId');
    });

    it('throws for sessionId with special characters', () => {
      expect(() => getStateFilePath('ses.123')).toThrow('Invalid sessionId');
      expect(() => getStateFilePath('ses 123')).toThrow('Invalid sessionId');
      expect(() => getStateFilePath('')).toThrow('Invalid sessionId');
    });
  });

  describe('writeActiveRulesState and readActiveRulesState', () => {
    it('write/read round-trip preserves data', async () => {
      const sessionId = 'ses_roundtrip';
      const matchedPaths = ['/path/to/rule1.md', '/path/to/rule2.md'];

      writeActiveRulesState(sessionId, matchedPaths);

      // Wait for the fire-and-forget write to complete
      await waitForFile(getStateFilePath(sessionId));

      const state = await readActiveRulesState(sessionId);

      expect(state).not.toBeNull();
      expect(state!.sessionId).toBe(sessionId);
      expect(state!.matchedRulePaths).toEqual(matchedPaths);
      expect(typeof state!.evaluatedAt).toBe('number');
      expect(state!.evaluatedAt).toBeLessThanOrEqual(Date.now());
    });

    it('returns null for missing file', async () => {
      const state = await readActiveRulesState('ses_nonexistent');
      expect(state).toBeNull();
    });

    it('returns null for corrupt/invalid JSON', async () => {
      await fs.mkdir(testStateDir, { recursive: true });

      const filePath = getStateFilePath('ses_corrupt');
      await fs.writeFile(filePath, 'not valid json {{{', 'utf-8');

      const state = await readActiveRulesState('ses_corrupt');
      expect(state).toBeNull();
    });

    it('returns null for invalid state format', async () => {
      await fs.mkdir(testStateDir, { recursive: true });

      const filePath = getStateFilePath('ses_invalid');
      await fs.writeFile(filePath, JSON.stringify({ foo: 'bar' }), 'utf-8');

      const state = await readActiveRulesState('ses_invalid');
      expect(state).toBeNull();
    });

    it('returns null for wrong-type values in state', async () => {
      await fs.mkdir(testStateDir, { recursive: true });

      const filePath = getStateFilePath('ses_wrongtypes');
      await fs.writeFile(
        filePath,
        JSON.stringify({
          sessionId: 123,
          matchedRulePaths: 'not-an-array',
          evaluatedAt: 'not-a-number',
        }),
        'utf-8'
      );

      const state = await readActiveRulesState('ses_wrongtypes');
      expect(state).toBeNull();
    });

    it('returns null for array with non-string items', async () => {
      await fs.mkdir(testStateDir, { recursive: true });

      const filePath = getStateFilePath('ses_badarray');
      await fs.writeFile(
        filePath,
        JSON.stringify({
          sessionId: 'ses_badarray',
          matchedRulePaths: ['/valid.md', 123, null],
          evaluatedAt: Date.now(),
        }),
        'utf-8'
      );

      const state = await readActiveRulesState('ses_badarray');
      expect(state).toBeNull();
    });

    it('silently ignores write with invalid sessionId', async () => {
      writeActiveRulesState('../escape', ['/rule.md']);
      writeActiveRulesState('foo/bar', ['/rule.md']);

      // Give time for any writes to occur
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify no files were created
      try {
        await fs.access(testStateDir);
        const files = await fs.readdir(testStateDir);
        expect(files).toHaveLength(0);
      } catch {
        // Directory doesn't exist, which is expected
      }
    });

    it('returns null for read with invalid sessionId', async () => {
      const state = await readActiveRulesState('../escape');
      expect(state).toBeNull();
    });

    it('no temp file remains after write', async () => {
      const sessionId = 'ses_no_temp';
      const matchedPaths = ['/rule.md'];

      writeActiveRulesState(sessionId, matchedPaths);

      // Wait for write to complete
      await waitForFile(getStateFilePath(sessionId));

      // Check that no temp files remain
      const files = await fs.readdir(testStateDir);
      const tempFiles = files.filter(f => f.endsWith('.tmp'));

      expect(tempFiles).toHaveLength(0);
    });

    it('serializes concurrent writes for same session', async () => {
      const sessionId = 'ses_concurrent';

      // Fire multiple writes concurrently
      writeActiveRulesState(sessionId, ['path1']);
      writeActiveRulesState(sessionId, ['path2']);
      writeActiveRulesState(sessionId, ['path3']);

      // Wait for all writes to complete
      await waitForFile(getStateFilePath(sessionId));

      // Give a bit more time for all queued writes to finish
      await new Promise(resolve => setTimeout(resolve, 100));

      // The final state should reflect the last write
      const state = await readActiveRulesState(sessionId);
      expect(state).not.toBeNull();
      expect(state!.matchedRulePaths).toEqual(['path3']);
    });

    it('creates state directory when it does not exist', async () => {
      const sessionId = 'ses_newdir';
      const matchedPaths = ['/rule.md'];

      // Verify directory doesn't exist yet
      await expect(fs.access(testStateDir)).rejects.toThrow();

      writeActiveRulesState(sessionId, matchedPaths);

      // Wait for write to complete
      await waitForFile(getStateFilePath(sessionId));

      // Verify directory now exists
      await expect(fs.access(testStateDir)).resolves.toBeUndefined();
    });

    it('handles writes to different sessions independently', async () => {
      writeActiveRulesState('ses_a', ['ruleA']);
      writeActiveRulesState('ses_b', ['ruleB']);

      // Wait for both writes
      await Promise.all([
        waitForFile(getStateFilePath('ses_a')),
        waitForFile(getStateFilePath('ses_b')),
      ]);

      const stateA = await readActiveRulesState('ses_a');
      const stateB = await readActiveRulesState('ses_b');

      expect(stateA!.matchedRulePaths).toEqual(['ruleA']);
      expect(stateB!.matchedRulePaths).toEqual(['ruleB']);
    });
  });
});

// Helper to wait for a file to exist
async function waitForFile(filePath: string, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}
