### Task 3.1: Update README with Architecture Notes

**Files:**

- Modify: `README.md`

**Context:**

Document the new two-hook architecture and note the experimental API dependency.

**Dependencies:**

- All implementation tasks (1.x) should be complete

---

**Step 1: Read current README**

Run: Review current `README.md` contents to understand existing structure.

**Step 2: Update or add Architecture section**

Find a suitable location in `README.md` (after Features or similar section) and add:

```markdown
## Architecture

This plugin uses OpenCode's experimental transform hooks to inject rules into the LLM context:

### Two-Hook Approach

1. **`experimental.chat.messages.transform`** - Fires before each LLM call
   - Extracts file paths from conversation messages (tool calls, text content)
   - Stores paths for conditional rule filtering
   - Does NOT modify messages

2. **`experimental.chat.system.transform`** - Fires after messages.transform
   - Reads discovered rule files
   - Filters conditional rules (`.mdc` with `globs`) against extracted file paths
   - Appends formatted rules to the system prompt

### Benefits Over Previous Approach

- **No session tracking** - Rules are injected fresh on every LLM call
- **No compaction handling** - System prompt is rebuilt automatically
- **Cleaner injection** - Rules in system prompt instead of conversation messages
- **Context-aware filtering** - Conditional rules only apply when relevant files are referenced

### Experimental API Notice

This plugin depends on experimental OpenCode APIs:

- `experimental.chat.messages.transform`
- `experimental.chat.system.transform`

These APIs may change in future OpenCode versions. Check OpenCode release notes when upgrading.
```

**Step 3: Update any outdated descriptions**

If README mentions "silent messages" or "session events", update to reflect new architecture:

Find references like:

- "sends rules as silent messages"
- "session.created event"
- "session.compacted event"

Replace with appropriate descriptions of the new system prompt injection approach.

**Step 4: Verify README renders correctly**

Run: Preview the README in your editor or:

```bash
# If you have a markdown preview tool
cat README.md
```

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document new transform hook architecture

- Add Architecture section explaining two-hook approach
- Note experimental API dependency
- Document benefits over previous event-based approach"
```
