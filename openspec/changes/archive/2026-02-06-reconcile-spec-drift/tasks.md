# Tasks: reconcile-spec-drift

## Task List

1. **Review ADDED requirements for completeness**
   - Verify Tool-Based Rule Matching scenarios cover exact-match semantics and OR logic
   - Verify MCP Capability Discovery scenarios cover connected/disconnected/sanitization
   - Verify Real-Time Context Capture scenarios cover tool.execute.before and chat.message hooks
   - Verify Session Compacting Support scenarios cover marking, skipping, TTL, and context injection
   - _Validation_: Each requirement has at least one scenario with GIVEN/WHEN/THEN

2. **Review MODIFIED requirements for accuracy**
   - Verify Rule File Formats includes `tools` field and OR-across-all-dimensions scenario
   - Verify Debug Logging reflects truthy (non-empty string) enablement
   - Verify System Prompt Rule Injection includes compaction skip and tool ID passing
   - Verify Message Context Extraction describes multi-source seeding with `seededFromHistory`
   - Verify Session Context Lifecycle describes LRU SessionStore (not delete-after-read)
   - Verify Frontmatter Parsing is case-sensitive and includes `tools` key
   - _Validation_: MODIFIED requirements include full replacement text

3. **Review REMOVED requirements**
   - Confirm the uppercase frontmatter keys scenario is correctly removed
   - _Validation_: Removal is justified with rationale

4. **Validate proposal**
   - Run `openspec validate reconcile-spec-drift --strict`
   - Resolve any reported issues
   - _Validation_: Zero validation errors

## Dependencies

- Tasks 1-3 can be done in parallel
- Task 4 depends on tasks 1-3
