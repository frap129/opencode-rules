### Task 2.1: Add Unit Tests for `extractFilePathsFromMessages()`

**Files:**

- Modify: `src/index.test.ts` (add new describe block)

**Context:**

Test the new utility function added in Task 1.1. Cover:

1. Tool call argument parsing (read, edit, glob, grep)
2. Regex path extraction from message text content
3. Deduplication of paths
4. Edge cases (empty messages, no paths, URLs filtered out)

**Dependencies:**

- Task 1.1 must be complete

---

**Step 1: Add import for the new function**

Find in `src/index.test.ts`:

```typescript
import {
  discoverRuleFiles,
  readAndFormatRules,
  parseRuleMetadata,
} from './utils.js';
```

Replace with:

```typescript
import {
  discoverRuleFiles,
  readAndFormatRules,
  parseRuleMetadata,
  extractFilePathsFromMessages,
} from './utils.js';
```

**Step 2: Add describe block for extractFilePathsFromMessages**

Add after the `parseRuleMetadata` describe block (around line 93):

```typescript
describe('extractFilePathsFromMessages', () => {
  it('should extract file path from read tool invocation', () => {
    // Arrange
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'read',
              args: { filePath: '/src/utils/helper.ts' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('/src/utils/helper.ts');
  });

  it('should extract file path from edit tool invocation', () => {
    // Arrange
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'edit',
              args: { filePath: 'src/components/Button.tsx' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/components/Button.tsx');
  });

  it('should extract directory from glob pattern', () => {
    // Arrange
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'glob',
              args: { pattern: 'src/components/**/*.ts' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/components');
  });

  it('should extract path from grep tool invocation', () => {
    // Arrange
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'grep',
              args: { path: 'src/services', include: '*.ts' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/services');
  });

  it('should extract paths from text content using regex', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Please check the file src/index.ts and also look at lib/utils/helpers.js',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('lib/utils/helpers.js');
  });

  it('should deduplicate paths', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Check src/index.ts' }],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'read',
              args: { filePath: 'src/index.ts' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    const indexCount = paths.filter(p => p === 'src/index.ts').length;
    expect(indexCount).toBe(1);
  });

  it('should filter out URLs', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Check https://example.com/path/to/file.js and http://test.com/api/endpoint',
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).not.toContainEqual(expect.stringContaining('http'));
    expect(paths).not.toContainEqual(expect.stringContaining('example.com'));
  });

  it('should return empty array for messages with no paths', () => {
    // Arrange
    const messages = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Hello, how are you?' }],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toEqual([]);
  });

  it('should return empty array for empty messages array', () => {
    // Act
    const paths = extractFilePathsFromMessages([]);

    // Assert
    expect(paths).toEqual([]);
  });

  it('should handle messages with multiple tool invocations', () => {
    // Arrange
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'read',
              args: { filePath: 'src/a.ts' },
            },
          },
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'read',
              args: { filePath: 'src/b.ts' },
            },
          },
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'edit',
              args: { filePath: 'src/c.ts' },
            },
          },
        ],
      },
    ];

    // Act
    const paths = extractFilePathsFromMessages(messages);

    // Assert
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
    expect(paths).toContain('src/c.ts');
  });
});
```

**Step 3: Run the tests to verify they fail (TDD - tests written before implementation would fail)**

Run: `npm test -- --run`
Expected: If Task 1.1 is complete, tests should PASS

**Step 4: Commit**

```bash
git add src/index.test.ts
git commit -m "test: add unit tests for extractFilePathsFromMessages utility"
```
