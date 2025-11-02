## 1. Remove Unused Validation Code

- [x] 1.1 Remove Rule interface and related types
- [x] 1.2 Remove ValidationResult interface
- [x] 1.3 Remove RuleEngine class and all its methods
- [x] 1.4 Remove createRule utility function
- [x] 1.5 Remove combineResults utility function
- [x] 1.6 Remove defaultRuleEngine export

## 2. Simplify Plugin Implementation

- [x] 2.1 Review and clean up discoverRuleFiles function
- [x] 2.2 Review and clean up readAndFormatRules function
- [x] 2.3 Ensure OpenCodeRulesPlugin properly implements Plugin interface
- [x] 2.4 Verify chat.params hook implementation is correct
- [x] 2.5 Add proper TypeScript types for plugin input/output

## 3. Update Exports

- [x] 3.1 Remove exports for validation-related functionality
- [x] 3.2 Keep only the plugin default export
- [x] 3.3 Ensure package.json main field points to correct export

## 4. Testing and Validation

- [x] 4.1 Test plugin loads without errors
- [x] 4.2 Test file discovery from both global and project directories
- [x] 4.3 Test system prompt injection works correctly
- [x] 4.4 Verify no TypeScript errors remain
- [x] 4.5 Run existing tests to ensure no regressions
