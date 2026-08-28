import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  MatchedRulesStateStore,
  readMatchedRulesState,
} from './matched-rules-state.js';

describe('matched-rules-state', () => {
  let testStateDir: string;
  let store: MatchedRulesStateStore;

  beforeEach(async () => {
    // Create a temp directory for tests
    const testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'matched-rules-test-')
    );
    testStateDir = path.join(testDir, 'state');
    store = new MatchedRulesStateStore({ stateDir: testStateDir });
  });

  afterEach(async () => {
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

  describe('write and readMatchedRulesState', () => {
    it('write/read round-trip preserves data', async () => {
      const sessionID = 'ses_roundtrip';
      const matchedPaths = ['/path/to/rule1.md', '/path/to/rule2.md'];

      await store.write(sessionID, matchedPaths);

      const state = await readMatchedRulesState(sessionID, {
        stateDir: testStateDir,
      });

      expect(state).not.toBeNull();
      expect(state!.sessionID).toBe(sessionID);
      expect(state!.matchedRulePaths).toEqual(matchedPaths);
      expect(typeof state!.evaluatedAt).toBe('number');
      expect(state!.evaluatedAt).toBeLessThanOrEqual(Date.now());
    });

    it('returns null for missing file', async () => {
      const state = await readMatchedRulesState('ses_nonexistent', {
        stateDir: testStateDir,
      });
      expect(state).toBeNull();
    });

    it('reads from an explicit state directory', async () => {
      const explicitStateDir = path.join(
        path.dirname(testStateDir),
        'explicit'
      );
      await fs.mkdir(explicitStateDir, { recursive: true });
      await fs.writeFile(
        path.join(explicitStateDir, 'ses_explicit.json'),
        JSON.stringify({
          sessionID: 'ses_explicit',
          matchedRulePaths: ['/rule.md'],
          evaluatedAt: 123,
        }),
        'utf-8'
      );

      const state = await readMatchedRulesState('ses_explicit', {
        stateDir: explicitStateDir,
      });

      expect(state).toEqual({
        sessionID: 'ses_explicit',
        matchedRulePaths: ['/rule.md'],
        evaluatedAt: 123,
      });
    });

    it('returns null for corrupt/invalid JSON', async () => {
      await fs.mkdir(testStateDir, { recursive: true });

      const filePath = path.join(testStateDir, 'ses_corrupt.json');
      await fs.writeFile(filePath, 'not valid json {{{', 'utf-8');

      const state = await readMatchedRulesState('ses_corrupt', {
        stateDir: testStateDir,
      });
      expect(state).toBeNull();
    });

    it('returns null for invalid state format', async () => {
      await fs.mkdir(testStateDir, { recursive: true });

      const filePath = path.join(testStateDir, 'ses_invalid.json');
      await fs.writeFile(filePath, JSON.stringify({ foo: 'bar' }), 'utf-8');

      const state = await readMatchedRulesState('ses_invalid', {
        stateDir: testStateDir,
      });
      expect(state).toBeNull();
    });

    it('returns null for wrong-type values in state', async () => {
      await fs.mkdir(testStateDir, { recursive: true });

      const filePath = path.join(testStateDir, 'ses_wrongtypes.json');
      await fs.writeFile(
        filePath,
        JSON.stringify({
          sessionID: 123,
          matchedRulePaths: 'not-an-array',
          evaluatedAt: 'not-a-number',
        }),
        'utf-8'
      );

      const state = await readMatchedRulesState('ses_wrongtypes', {
        stateDir: testStateDir,
      });
      expect(state).toBeNull();
    });

    it('returns null for array with non-string items', async () => {
      await fs.mkdir(testStateDir, { recursive: true });

      const filePath = path.join(testStateDir, 'ses_badarray.json');
      await fs.writeFile(
        filePath,
        JSON.stringify({
          sessionID: 'ses_badarray',
          matchedRulePaths: ['/valid.md', 123, null],
          evaluatedAt: Date.now(),
        }),
        'utf-8'
      );

      const state = await readMatchedRulesState('ses_badarray', {
        stateDir: testStateDir,
      });
      expect(state).toBeNull();
    });

    it('throws on write with invalid sessionID', () => {
      for (const sessionID of [
        '../escape',
        'foo/bar',
        '/absolute',
        'ses.123',
        'ses 123',
        '',
      ]) {
        expect(() => store.write(sessionID, ['/rule.md'])).toThrow(
          'Invalid sessionID'
        );
      }
    });

    it('throws for read with invalid sessionID', async () => {
      for (const sessionID of ['../escape', '/absolute', 'ses.123', '']) {
        await expect(
          readMatchedRulesState(sessionID, { stateDir: testStateDir })
        ).rejects.toThrow('Invalid sessionID');
      }
    });

    it('no temp file remains after write', async () => {
      const sessionID = 'ses_no_temp';
      const matchedPaths = ['/rule.md'];

      await store.write(sessionID, matchedPaths);

      // Check that no temp files remain
      const files = await fs.readdir(testStateDir);
      const tempFiles = files.filter(f => f.endsWith('.tmp'));

      expect(tempFiles).toHaveLength(0);
    });

    it('serializes concurrent writes for same session', async () => {
      const sessionID = 'ses_concurrent';

      // Fire multiple writes concurrently
      const first = store.write(sessionID, ['path1']);
      const second = store.write(sessionID, ['path2']);
      const third = store.write(sessionID, ['path3']);

      expect(getWriteQueues(store).has(sessionID)).toBe(true);

      await Promise.all([first, second, third]);

      // The final state should reflect the last write
      const state = await readMatchedRulesState(sessionID, {
        stateDir: testStateDir,
      });
      expect(state).not.toBeNull();
      expect(state!.matchedRulePaths).toEqual(['path3']);
      expect(getWriteQueues(store).has(sessionID)).toBe(false);
    });

    it('releases a session queue entry after its final write settles', async () => {
      const write = store.write('ses_lifecycle', ['path1']);

      expect(getWriteQueues(store).has('ses_lifecycle')).toBe(true);

      await write;

      expect(getWriteQueues(store).has('ses_lifecycle')).toBe(false);
    });

    it('creates state directory when it does not exist', async () => {
      const sessionID = 'ses_newdir';
      const matchedPaths = ['/rule.md'];

      // Verify directory doesn't exist yet
      await expect(fs.access(testStateDir)).rejects.toThrow();

      await store.write(sessionID, matchedPaths);

      // Verify directory now exists — fs.access resolves to null on Bun, undefined on Node
      const dirExists = await fs.access(testStateDir).then(
        () => true,
        () => false
      );
      expect(dirExists).toBe(true);
    });

    it('handles writes to different sessions independently', async () => {
      await Promise.all([
        store.write('ses_a', ['ruleA']),
        store.write('ses_b', ['ruleB']),
      ]);

      const stateA = await readMatchedRulesState('ses_a', {
        stateDir: testStateDir,
      });
      const stateB = await readMatchedRulesState('ses_b', {
        stateDir: testStateDir,
      });

      expect(stateA!.matchedRulePaths).toEqual(['ruleA']);
      expect(stateB!.matchedRulePaths).toEqual(['ruleB']);
    });
  });
});

function getWriteQueues(
  store: MatchedRulesStateStore
): Map<string, Promise<void>> {
  // Pin queue ownership without adding a production test hook.
  return (store as unknown as { writeQueues: Map<string, Promise<void>> })
    .writeQueues;
}
