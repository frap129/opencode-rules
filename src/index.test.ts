import { describe, it, expect } from 'vitest';
import { RuleEngine, createRule, combineResults } from './index.js';

describe('RuleEngine', () => {
  it('should create a rule engine instance', () => {
    const engine = new RuleEngine();
    expect(engine).toBeDefined();
    expect(engine.getRules()).toEqual([]);
  });

  it('should register and retrieve rules', () => {
    const engine = new RuleEngine();
    const rule = createRule(
      'test-rule',
      'Test Rule',
      'A test rule',
      'error',
      () => ({ errors: [], warnings: [], info: [] })
    );

    engine.register(rule);
    expect(engine.getRules()).toHaveLength(1);
    expect(engine.getRule('test-rule')).toEqual(rule);
  });

  it('should validate input against rules', () => {
    const engine = new RuleEngine();
    const rule = createRule(
      'test-rule',
      'Test Rule',
      'A test rule',
      'error',
      input => ({
        errors: input === 'invalid' ? ['Input is invalid'] : [],
        warnings: [],
        info: [],
      })
    );

    engine.register(rule);

    const validResult = engine.validate('valid');
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toEqual([]);

    const invalidResult = engine.validate('invalid');
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors).toEqual(['Input is invalid']);
  });
});

describe('createRule', () => {
  it('should create a rule with proper structure', () => {
    const rule = createRule(
      'test-rule',
      'Test Rule',
      'A test rule',
      'warning',
      () => ({ errors: [], warnings: ['test warning'], info: [] })
    );

    expect(rule.id).toBe('test-rule');
    expect(rule.name).toBe('Test Rule');
    expect(rule.description).toBe('A test rule');
    expect(rule.severity).toBe('warning');

    const result = rule.validate(null);
    expect(result.valid).toBe(true); // No errors
    expect(result.warnings).toEqual(['test warning']);
  });
});

describe('combineResults', () => {
  it('should combine multiple validation results', () => {
    const result1 = {
      valid: true,
      errors: [],
      warnings: ['warning 1'],
      info: ['info 1'],
    };

    const result2 = {
      valid: false,
      errors: ['error 1'],
      warnings: ['warning 2'],
      info: ['info 2'],
    };

    const combined = combineResults(result1, result2);

    expect(combined.valid).toBe(false);
    expect(combined.errors).toEqual(['error 1']);
    expect(combined.warnings).toEqual(['warning 1', 'warning 2']);
    expect(combined.info).toEqual(['info 1', 'info 2']);
  });
});
