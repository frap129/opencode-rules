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
  _resetWriteQueues,
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
    _resetWriteQueues();

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

    it('throws for sessionID with path traversal', () => {
      expect(() => getStateFilePath('../escape')).toThrow('Invalid sessionID');
      expect(() => getStateFilePath('foo/bar')).toThrow('Invalid sessionID');
      expect(() => getStateFilePath('/absolute')).toThrow('Invalid sessionID');
    });

    it('throws for sessionID with special characters', () => {
      expect(() => getStateFilePath('ses.123')).toThrow('Invalid sessionID');
      expect(() => getStateFilePath('ses 123')).toThrow('Invalid sessionID');
      expect(() => getStateFilePath('')).toThrow('Invalid sessionID');
    });
  });

  describe('writeActiveRulesState and readActiveRulesState', () => {
    it('write/read round-trip preserves data', async () => {
      const sessionID = 'ses_roundtrip';
      const matchedPaths = ['/path/to/rule1.md', '/path/to/rule2.md'];

      await writeActiveRulesState(sessionID, matchedPaths);

      const state = await readActiveRulesState(sessionID);

      expect(state).not.toBeNull();
      expect(state!.sessionID).toBe(sessionID);
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
          sessionID: 123,
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
          sessionID: 'ses_badarray',
          matchedRulePaths: ['/valid.md', 123, null],
          evaluatedAt: Date.now(),
        }),
        'utf-8'
      );

      const state = await readActiveRulesState('ses_badarray');
      expect(state).toBeNull();
    });

    it('throws on write with invalid sessionID', () => {
      expect(() => writeActiveRulesState('../escape', ['/rule.md'])).toThrow(
        'Invalid sessionID'
      );
      expect(() => writeActiveRulesState('foo/bar', ['/rule.md'])).toThrow(
        'Invalid sessionID'
      );
    });

    it('throws for read with invalid sessionID', async () => {
      await expect(readActiveRulesState('../escape')).rejects.toThrow(
        'Invalid sessionID'
      );
    });

    it('no temp file remains after write', async () => {
      const sessionID = 'ses_no_temp';
      const matchedPaths = ['/rule.md'];

      await writeActiveRulesState(sessionID, matchedPaths);

      // Check that no temp files remain
      const files = await fs.readdir(testStateDir);
      const tempFiles = files.filter(f => f.endsWith('.tmp'));

      expect(tempFiles).toHaveLength(0);
    });

    it('serializes concurrent writes for same session', async () => {
      const sessionID = 'ses_concurrent';

      // Fire multiple writes concurrently
      const first = writeActiveRulesState(sessionID, ['path1']);
      const second = writeActiveRulesState(sessionID, ['path2']);
      const third = writeActiveRulesState(sessionID, ['path3']);

      await Promise.all([first, second, third]);

      // The final state should reflect the last write
      const state = await readActiveRulesState(sessionID);
      expect(state).not.toBeNull();
      expect(state!.matchedRulePaths).toEqual(['path3']);
    });

    it('creates state directory when it does not exist', async () => {
      const sessionID = 'ses_newdir';
      const matchedPaths = ['/rule.md'];

      // Verify directory doesn't exist yet
      await expect(fs.access(testStateDir)).rejects.toThrow();

      await writeActiveRulesState(sessionID, matchedPaths);

      // Verify directory now exists
      await expect(fs.access(testStateDir)).resolves.toBeUndefined();
    });

    it('handles writes to different sessions independently', async () => {
      await Promise.all([
        writeActiveRulesState('ses_a', ['ruleA']),
        writeActiveRulesState('ses_b', ['ruleB']),
      ]);

      const stateA = await readActiveRulesState('ses_a');
      const stateB = await readActiveRulesState('ses_b');

      expect(stateA!.matchedRulePaths).toEqual(['ruleA']);
      expect(stateB!.matchedRulePaths).toEqual(['ruleB']);
    });
  });
});
