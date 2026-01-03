### Task 2.2: Update Existing Tests for New Architecture

**Files:**

- Modify: `src/index.test.ts` (update/remove old tests, add new hook tests)

**Context:**

The old tests verify:

- Session tracking (Set<string>) - REMOVE
- Event hook behavior - REMOVE
- Compaction handling - REMOVE
- Silent message sending via client.session.prompt() - REMOVE

New tests need to verify:

- Plugin returns transform hooks
- System transform hook injects rules
- Messages transform hook extracts context (already in 2.1)

**Dependencies:**

- Task 1.2 must be complete (new hook architecture)
- Task 2.1 should be complete

---

**Step 1: Remove the old OpenCodeRulesPlugin describe block**

Find and DELETE the entire `describe('OpenCodeRulesPlugin', ...)` block in `src/index.test.ts` (lines 515-951).

This removes tests for:

- `should export a default plugin function`
- `should return hooks object from plugin`
- `should send silent message with rules on session.created event`
- `should not send message when no rules exist`
- `should discover and send rules from project directory`
- `should not send rules twice to the same session`
- `should send rules to multiple different sessions`
- `should re-send rules after session compaction`
- `should handle compaction event for unknown session gracefully`

**Step 2: Add new OpenCodeRulesPlugin describe block**

Add at the end of the file (after the extractFilePathsFromMessages tests):

```typescript
describe('OpenCodeRulesPlugin', () => {
  beforeEach(() => {
    setupTestDirs();
  });

  afterEach(() => {
    teardownTestDirs();
    vi.resetAllMocks();
  });

  it('should export a default plugin function', async () => {
    const { default: plugin } = await import('./index.js');
    expect(typeof plugin).toBe('function');
  });

  it('should return empty object when no rules exist', async () => {
    // Arrange
    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, 'empty-config');
    mkdirSync(path.join(testDir, 'empty-config', 'opencode', 'rules'), {
      recursive: true,
    });

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: path.join(testDir, 'empty-project'),
      worktree: testDir,
      $: {} as any,
    };

    try {
      // Act
      const hooks = await plugin(mockInput);

      // Assert - no hooks when no rules
      expect(hooks).toEqual({});
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should return transform hooks when rules exist', async () => {
    // Arrange
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Test Rule');

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    try {
      // Act
      const hooks = await plugin(mockInput);

      // Assert
      expect(hooks).toHaveProperty('experimental.chat.messages.transform');
      expect(hooks).toHaveProperty('experimental.chat.system.transform');
      expect(typeof hooks['experimental.chat.messages.transform']).toBe(
        'function'
      );
      expect(typeof hooks['experimental.chat.system.transform']).toBe(
        'function'
      );
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should inject rules into system prompt via system.transform hook', async () => {
    // Arrange
    writeFileSync(
      path.join(globalRulesDir, 'rule.md'),
      '# Test Rule\nDo this always'
    );

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    try {
      // Act
      const hooks = await plugin(mockInput);
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform({
        output: { system: 'You are a helpful assistant.' },
      });

      // Assert
      expect(result.system).toContain('You are a helpful assistant.');
      expect(result.system).toContain('OpenCode Rules');
      expect(result.system).toContain('Test Rule');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should append rules to existing system prompt', async () => {
    // Arrange
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# My Rule');

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    try {
      // Act
      const hooks = await plugin(mockInput);
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform({
        output: { system: 'Original system prompt.' },
      });

      // Assert - original comes first, rules appended
      expect(result.system).toMatch(/^Original system prompt\./);
      expect(result.system).toContain('My Rule');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should handle empty system prompt', async () => {
    // Arrange
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule Content');

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    try {
      // Act
      const hooks = await plugin(mockInput);
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform({
        output: { system: '' },
      });

      // Assert
      expect(result.system).toContain('OpenCode Rules');
      expect(result.system).toContain('Rule Content');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should not modify messages in messages.transform hook', async () => {
    // Arrange
    writeFileSync(path.join(globalRulesDir, 'rule.md'), '# Rule');

    const originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');

    const { default: plugin } = await import('./index.js');
    const mockInput = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      $: {} as any,
    };

    const originalMessages = [
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
    ];

    try {
      // Act
      const hooks = await plugin(mockInput);
      const messagesTransform = hooks[
        'experimental.chat.messages.transform'
      ] as any;
      const result = await messagesTransform({
        output: { messages: originalMessages },
      });

      // Assert - messages unchanged
      expect(result.messages).toEqual(originalMessages);
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });
});
```

**Step 3: Run tests to verify**

Run: `npm test -- --run`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/index.test.ts
git commit -m "test: update tests for new transform hook architecture

Remove tests for deprecated event/session tracking.
Add tests for experimental.chat.system.transform hook.
Add tests for experimental.chat.messages.transform hook."
```
