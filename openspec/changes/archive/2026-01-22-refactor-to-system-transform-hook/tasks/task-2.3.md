### Task 2.3: Add Integration Test for Conditional Rules

**Files:**

- Modify: `src/index.test.ts` (add tests to OpenCodeRulesPlugin describe block)

**Context:**

Test the end-to-end flow where:

1. Messages contain file references
2. messages.transform extracts those paths
3. system.transform filters conditional rules based on extracted paths

**Dependencies:**

- Tasks 1.1, 1.2, 1.3 must be complete
- Task 2.2 should be complete

---

**Step 1: Add integration tests for conditional rules**

Add these tests inside the `describe('OpenCodeRulesPlugin', ...)` block:

```typescript
describe('conditional rules integration', () => {
  it('should include conditional rule when message context matches glob', async () => {
    // Arrange
    writeFileSync(
      path.join(globalRulesDir, 'typescript.mdc'),
      `---
globs:
  - "src/components/**/*.tsx"
---

Use React best practices for components.`
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

      // First, process messages with a matching file reference
      const messagesTransform = hooks[
        'experimental.chat.messages.transform'
      ] as any;
      await messagesTransform({
        output: {
          messages: [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'tool-invocation',
                  toolInvocation: {
                    toolName: 'read',
                    args: { filePath: 'src/components/Button.tsx' },
                  },
                },
              ],
            },
          ],
        },
      });

      // Then, get the system prompt
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform({
        output: { system: 'Base prompt.' },
      });

      // Assert - conditional rule should be included
      expect(result.system).toContain('React best practices');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should exclude conditional rule when message context does not match glob', async () => {
    // Arrange
    writeFileSync(
      path.join(globalRulesDir, 'typescript.mdc'),
      `---
globs:
  - "src/components/**/*.tsx"
---

Use React best practices for components.`
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

      // Process messages with NON-matching file reference
      const messagesTransform = hooks[
        'experimental.chat.messages.transform'
      ] as any;
      await messagesTransform({
        output: {
          messages: [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'tool-invocation',
                  toolInvocation: {
                    toolName: 'read',
                    args: { filePath: 'src/utils/helpers.ts' },
                  },
                },
              ],
            },
          ],
        },
      });

      // Get the system prompt
      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform({
        output: { system: 'Base prompt.' },
      });

      // Assert - conditional rule should NOT be included
      expect(result.system).not.toContain('React best practices');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should include unconditional rules regardless of context', async () => {
    // Arrange
    writeFileSync(
      path.join(globalRulesDir, 'always.md'),
      '# Always Apply\nThis rule always applies.'
    );
    writeFileSync(
      path.join(globalRulesDir, 'conditional.mdc'),
      `---
globs:
  - "src/special/**/*"
---

Special rule content.`
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

      // Process with non-matching context
      const messagesTransform = hooks[
        'experimental.chat.messages.transform'
      ] as any;
      await messagesTransform({
        output: {
          messages: [
            {
              role: 'user',
              parts: [{ type: 'text', text: 'Check src/index.ts' }],
            },
          ],
        },
      });

      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform({
        output: { system: '' },
      });

      // Assert
      expect(result.system).toContain('Always Apply');
      expect(result.system).toContain('This rule always applies');
      expect(result.system).not.toContain('Special rule content');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });

  it('should handle multiple matching files for conditional rules', async () => {
    // Arrange
    writeFileSync(
      path.join(globalRulesDir, 'multi.mdc'),
      `---
globs:
  - "**/*.test.ts"
---

Follow testing best practices.`
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

      // Process with one matching and one non-matching file
      const messagesTransform = hooks[
        'experimental.chat.messages.transform'
      ] as any;
      await messagesTransform({
        output: {
          messages: [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'tool-invocation',
                  toolInvocation: {
                    toolName: 'read',
                    args: { filePath: 'src/utils.ts' },
                  },
                },
                {
                  type: 'tool-invocation',
                  toolInvocation: {
                    toolName: 'read',
                    args: { filePath: 'src/utils.test.ts' },
                  },
                },
              ],
            },
          ],
        },
      });

      const systemTransform = hooks[
        'experimental.chat.system.transform'
      ] as any;
      const result = await systemTransform({
        output: { system: '' },
      });

      // Assert - rule should be included because at least one file matches
      expect(result.system).toContain('testing best practices');
    } finally {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
  });
});
```

**Step 2: Run the tests**

Run: `npm test -- --run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/index.test.ts
git commit -m "test: add integration tests for conditional rule filtering"
```
