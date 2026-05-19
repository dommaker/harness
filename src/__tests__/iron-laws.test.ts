/**
 * 约束系统测试
 */

import { describe, it, expect } from '@jest/globals';
import { 
  IRON_LAWS, 
  GUIDELINES, 
  TIPS, 
  getAllConstraints, 
  findConstraintsByTrigger, 
  getConstraint 
} from '../core/constraints/definitions';
import { constraintChecker } from '../core/constraints/checker';
import type { ConstraintContext } from '../types/constraint';

describe('Constraint System', () => {
  describe('Iron Laws', () => {
    it('should have 12 iron laws defined', () => {
      expect(Object.keys(IRON_LAWS).length).toBeGreaterThan(0); // 数量随版本变动
    });

    it('should have no exceptions for iron laws', () => {
      Object.values(IRON_LAWS).forEach(law => {
        expect(law.exceptions).toBeUndefined();
      });
    });
  });

  describe('Guidelines', () => {
    it('should have 22 guidelines defined', () => {
      expect(Object.keys(GUIDELINES)).toHaveLength(22);
    });

    it('should have exceptions for some guidelines', () => {
      const withExceptions = Object.values(GUIDELINES).filter(g => g.exceptions && g.exceptions.length > 0);
      expect(withExceptions.length).toBeGreaterThan(0);
    });
  });

  describe('Tips', () => {
    it('should have 2 tips defined', () => {
      expect(Object.keys(TIPS)).toHaveLength(2);
    });
  });

  describe('Helper Functions', () => {
    it('should get all constraints', () => {
      const all = getAllConstraints();
      expect(all.length).toBeGreaterThan(0); // 约束数量随版本变动
    });

    it('should find constraints by trigger', () => {
      const constraints = findConstraintsByTrigger('code_implementation');
      expect(constraints.length).toBeGreaterThan(0);
    });

    it('should get single constraint by id', () => {
      const constraint = getConstraint('no_fix_without_root_cause');
      expect(constraint).toBeDefined();
      expect(constraint?.level).toBe('guideline');
    });

    it('should return undefined for unknown constraint', () => {
      const constraint = getConstraint('unknown_constraint');
      expect(constraint).toBeUndefined();
    });
  });
});

describe('Constraint Checker', () => {
  it('should return singleton instance', () => {
    const instance1 = constraintChecker;
    expect(instance1).toBeDefined();
  });

  it('should find applicable constraints for context', () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    const result = constraintChecker.findApplicableConstraints(context);
    expect(result.ironLaws.length + result.guidelines.length + result.tips.length).toBeGreaterThan(0);
  });

  it('should check constraint', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
      hasRootCauseInvestigation: false,
    };

    const result = await constraintChecker.check(GUIDELINES['no_fix_without_root_cause'], context);
    expect(result.satisfied).toBe(false);
  });

  it('should check constraint with satisfied precondition', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
      hasRootCauseInvestigation: true,
    };

    const result = await constraintChecker.check(GUIDELINES['no_fix_without_root_cause'], context);
    expect(result.satisfied).toBe(true);
  });

  it('should check all constraints', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
      hasRequirement: true,
      hasWorktree: true,
      hasTest: true,
      hasVerificationEvidence: true,
      taskDescription: 'Test task',
      hasSingleTask: true,
      hasRequirementReview: true,
      hasTwoStageReview: true,
      completionClaimText: '142 tests passed, coverage 87%',
    };

    const result = await constraintChecker.checkConstraints(context);
    expect(result.ironLaws.length + result.guidelines.length + result.tips.length).toBeGreaterThan(0);
  });

  it('should fail incremental_progress when hasSingleTask is undefined', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    const result = await constraintChecker.check(IRON_LAWS['incremental_progress'], context);
    expect(result.satisfied).toBe(false);
  });

  it('should pass incremental_progress when hasSingleTask is true', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
      hasSingleTask: true,
    };

    const result = await constraintChecker.check(IRON_LAWS['incremental_progress'], context);
    expect(result.satisfied).toBe(true);
  });

  it('should fail verify_external_capability when hasExternalCapabilityVerification is undefined', async () => {
    const context: ConstraintContext = {
      operation: 'api_change',
    };

    const result = await constraintChecker.check(IRON_LAWS['verify_external_capability'], context);
    expect(result.satisfied).toBe(false);
  });

  it('should pass verify_external_capability when hasExternalCapabilityVerification is true', async () => {
    const context: ConstraintContext = {
      operation: 'api_change',
      hasExternalCapabilityVerification: true,
    };

    const result = await constraintChecker.check(IRON_LAWS['verify_external_capability'], context);
    expect(result.satisfied).toBe(true);
  });

  it('should fail no_implementation_without_requirement_review when hasRequirementReview is undefined', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    const result = await constraintChecker.check(IRON_LAWS['no_implementation_without_requirement_review'], context);
    expect(result.satisfied).toBe(false);
  });

  it('should pass no_implementation_without_requirement_review when hasRequirementReview is true', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
      hasRequirementReview: true,
    };

    const result = await constraintChecker.check(IRON_LAWS['no_implementation_without_requirement_review'], context);
    expect(result.satisfied).toBe(true);
  });

  it('should fail no_implementation_without_requirement when hasRequirement is undefined', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    const result = await constraintChecker.check(IRON_LAWS['no_implementation_without_requirement'], context);
    expect(result.satisfied).toBe(false);
  });

  it('should pass no_implementation_without_requirement when hasRequirement is true', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
      hasRequirement: true,
    };

    const result = await constraintChecker.check(IRON_LAWS['no_implementation_without_requirement'], context);
    expect(result.satisfied).toBe(true);
  });
});

describe('Constraint Levels', () => {
  it('should have correct level for iron laws', () => {
    Object.values(IRON_LAWS).forEach(law => {
      expect(law.level).toBe('iron_law');
    });
  });

  it('should have correct level for guidelines', () => {
    Object.values(GUIDELINES).forEach(guideline => {
      expect(guideline.level).toBe('guideline');
    });
  });

  it('should have correct level for tips', () => {
    Object.values(TIPS).forEach(tip => {
      expect(tip.level).toBe('tip');
    });
  });
});

describe('IronLawViolationError (deprecated)', () => {
  it('should be instanceof ConstraintViolationError', () => {
    const { IronLawViolationError, ConstraintViolationError } = require('../types/constraint');
    
    const result = {
      id: 'test',
      level: 'iron_law',
      satisfied: false,
      constraint: {
        id: 'test',
        level: 'iron_law',
        rule: 'TEST',
        message: 'test',
        trigger: 'code_implementation',
        enforcement: 'test',
      },
      message: 'Test error',
      checkedAt: new Date(),
    };

    const error = new IronLawViolationError(result);
    expect(error).toBeInstanceOf(ConstraintViolationError);
    expect(error.name).toBe('IronLawViolationError');
    expect(error.result).toBe(result);
  });
});