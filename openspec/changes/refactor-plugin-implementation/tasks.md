## 1. Remove Unused Validation Code

- [ ] 1.1 Remove Rule interface and related types
- [ ] 1.2 Remove ValidationResult interface
- [ ] 1.3 Remove RuleEngine class and all its methods
- [ ] 1.4 Remove createRule utility function
- [ ] 1.5 Remove combineResults utility function
- [ ] 1.6 Remove defaultRuleEngine export

## 2. Simplify Plugin Implementation

- [ ] 2.1 Review and clean up discoverRuleFiles function
- [ ] 2.2 Review and clean up readAndFormatRules function
- [ ] 2.3 Ensure OpenCodeRulesPlugin properly implements Plugin interface
- [ ] 2.4 Verify chat.params hook implementation is correct
- [ ] 2.5 Add proper TypeScript types for plugin input/output

## 3. Update Exports

- [ ] 3.1 Remove exports for validation-related functionality
- [ ] 3.2 Keep only the plugin default export
- [ ] 3.3 Ensure package.json main field points to correct export

## 4. Testing and Validation

- [ ] 4.1 Test plugin loads without errors
- [ ] 4.2 Test file discovery from both global and project directories
- [ ] 4.3 Test system prompt injection works correctly
- [ ] 4.4 Verify no TypeScript errors remain
- [ ] 4.5 Run existing tests to ensure no regressions
