/**
 * OpenCode Rules Package
 *
 * This package provides rules and validation utilities for OpenCode integration.
 */

export interface Rule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  validate: (input: any) => ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

export class RuleEngine {
  private rules: Map<string, Rule> = new Map();

  /**
   * Register a new rule
   */
  register(rule: Rule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Unregister a rule by ID
   */
  unregister(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Get all registered rules
   */
  getRules(): Rule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get a specific rule by ID
   */
  getRule(ruleId: string): Rule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Validate input against all registered rules
   */
  validate(input: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const info: string[] = [];

    for (const rule of this.rules.values()) {
      const result = rule.validate(input);

      errors.push(...result.errors);
      warnings.push(...result.warnings);
      info.push(...result.info);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      info,
    };
  }

  /**
   * Validate input against a specific rule
   */
  validateWithRule(ruleId: string, input: any): ValidationResult {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return {
        valid: false,
        errors: [`Rule '${ruleId}' not found`],
        warnings: [],
        info: [],
      };
    }

    return rule.validate(input);
  }
}

// Create a default rule engine instance
export const defaultRuleEngine = new RuleEngine();

// Export some basic utility functions
export function createRule(
  id: string,
  name: string,
  description: string,
  severity: Rule['severity'],
  validator: (input: any) => Omit<ValidationResult, 'valid'>
): Rule {
  return {
    id,
    name,
    description,
    severity,
    validate: (input: any): ValidationResult => {
      const result = validator(input);
      return {
        valid: result.errors.length === 0,
        ...result,
      };
    },
  };
}

export function combineResults(
  ...results: ValidationResult[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  for (const result of results) {
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    info.push(...result.info);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
  };
}
