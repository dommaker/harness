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
    it('should have 7 iron laws defined', () => {
      expect(Object.keys(IRON_LAWS)).toHaveLength(7); // no_bypass_checkpoint, no_self_approval, no_completion_without_verification, no_test_simplification, incremental_progress, verify_external_capability, no_implementation_without_requirement_review
    });

    it('should have no exceptions for iron laws', () => {
      Object.values(IRON_LAWS).forEach(law => {
        expect(law.exceptions).toBeUndefined();
      });
    });
  });

  describe('Guidelines', () => {
    it('should have 11 guidelines defined', () => {
      expect(Object.keys(GUIDELINES)).toHaveLength(11);
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
      expect(all.length).toBe(20); // 7 iron laws + 11 guidelines + 2 tips
    });

    it('should find constraints by trigger', () => {
      const constraints = findConstraintsByTrigger('bug_fix_attempt');
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
      operation: 'bug_fix_attempt',
    };

    const result = constraintChecker.findApplicableConstraints(context);
    expect(result.ironLaws.length + result.guidelines.length + result.tips.length).toBeGreaterThan(0);
  });

  it('should check constraint', async () => {
    const context: ConstraintContext = {
      operation: 'bug_fix_attempt',
      hasRootCauseInvestigation: false,
    };

    const result = await constraintChecker.check(GUIDELINES['no_fix_without_root_cause'], context);
    expect(result.satisfied).toBe(false);
  });

  it('should check constraint with satisfied precondition', async () => {
    const context: ConstraintContext = {
      operation: 'bug_fix_attempt',
      hasRootCauseInvestigation: true,
    };

    const result = await constraintChecker.check(GUIDELINES['no_fix_without_root_cause'], context);
    expect(result.satisfied).toBe(true);
  });

  it('should check all constraints', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    const result = await constraintChecker.checkConstraints(context);
    expect(result.ironLaws.length + result.guidelines.length + result.tips.length).toBeGreaterThan(0);
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
        trigger: 'step_execution',
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