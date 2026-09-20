/**
 * 约束系统测试（ADR-0029：severity 显式模型——三层命名废弃、prompt 面删除、注册表闭环保留）
 */

import { describe, it, expect } from '@jest/globals';
import {
  CONSTRAINTS,
  getAllConstraints,
  findConstraintsByTrigger,
  getConstraint
} from '../core/constraints/definitions';
import { constraintChecker } from '../core/constraints/checker';
import { getConstraintCheck, registeredCheckCount } from '../core/constraints/checkers';
import type { ConstraintContext } from '../types/constraint';

describe('Constraint System', () => {
  describe('清单构成（ADR-0029：16 → 7，全部 kind=check）', () => {
    it('getAllConstraints 返回 7 条 check 约束', () => {
      const all = getAllConstraints();
      expect(all).toHaveLength(7);
      expect(all.every(c => c.kind === 'check')).toBe(true);
    });

    it('severity 分桶 = 3 error + 4 warning', () => {
      const errors = Object.values(CONSTRAINTS).filter(c => c.severity === 'error');
      const warnings = Object.values(CONSTRAINTS).filter(c => c.severity === 'warning');
      expect(errors).toHaveLength(3);
      expect(warnings).toHaveLength(4);
      Object.values(CONSTRAINTS).forEach(c => {
        expect(c.kind).toBe('check');
      });
    });

    it('prompt 面字段已删除（promptInjection / injectPrompt / appliesTo 不存在）', () => {
      Object.values(CONSTRAINTS).forEach(c => {
        expect('promptInjection' in c).toBe(false);
        expect('injectPrompt' in c).toBe(false);
        expect('appliesTo' in c).toBe(false);
      });
    });

    it('被删除的 8 条不再存在', () => {
      const retired = [
        'no_any_type',
        'test_coverage_required',
        'no_coverage_decrease',
        'readme_required',
        'doc_required_for_public_api',
        'two_stage_review_required',
        'prefer_worktree',
        'read_before_write',
      ];
      for (const id of retired) {
        expect(getConstraint(id)).toBeUndefined();
      }
    });

    it('被吸收的成员不再单独存在', () => {
      const absorbed = [
        'no_self_approval',
        'no_claim_without_evidence',
        'no_excuse_patterns',
        'no_fallback_without_root_cause',
        'analysis_verification_gate',
        'diagnosis_to_fix_gate',
        'no_creation_without_reuse_check',
        'yagni_check',
        'no_implementation_without_requirement_review',
      ];
      for (const id of absorbed) {
        expect(getConstraint(id)).toBeUndefined();
      }
    });

    it('harness#174 删除的 10 条不再存在', () => {
      const removed = [
        'incremental_progress',
        'no_implementation_without_requirement',
        'no_bypass_checkpoint',
        'simplest_solution_first',
        'no_simplification_without_approval',
        'follow_conventions',
        'first_principles_first',
        'no_conflict_blending',
        'no_performative_agreement',
        'no_skill_without_test',
      ];
      for (const id of removed) {
        expect(getConstraint(id)).toBeUndefined();
        expect(getConstraintCheck(id)).toBeUndefined();
      }
    });

    it('ADR-0029：prompt 类 9 条随文本注入层关停删除', () => {
      const removed = [
        'no_fuzzy_completion_claim',
        'no_fix_without_root_cause',
        'no_code_without_test',
        'fix_the_problem_not_the_gate',
        'verify_external_capability',
        'no_delete_without_context',
        'design_decision_requires_discussion',
        'surgical_changes_only',
        'no_model_for_deterministic',
      ];
      for (const id of removed) {
        expect(getConstraint(id)).toBeUndefined();
        expect(getConstraintCheck(id)).toBeUndefined();
      }
    });

    it('no_completion_without_verification 不硬编码具体命令示例（#25：口径由项目声明）', () => {
      const law = CONSTRAINTS['no_completion_without_verification'];
      expect(law.description).not.toMatch(/npm test|npm run build/);
      expect(law.description).not.toContain('完整');
      expect(law.description).toContain('项目声明的测试');
    });
  });

  describe('注册表闭环', () => {
    it('每条 kind=check 约束都有已注册 checker', () => {
      const checks = getAllConstraints().filter(c => c.kind === 'check');
      for (const c of checks) {
        expect(getConstraintCheck(c.id)).toBeDefined();
      }
    });

    it('注册表数量与 check 约束数量一致（无孤儿 checker）', () => {
      const checkCount = getAllConstraints().filter(c => c.kind === 'check').length;
      expect(registeredCheckCount()).toBe(checkCount);
    });
  });

  describe('Helper Functions', () => {
    it('should find constraints by trigger', () => {
      const constraints = findConstraintsByTrigger('code_implementation');
      expect(constraints.length).toBeGreaterThan(0);
    });

    it('should get single constraint by id', () => {
      const constraint = getConstraint('no_completion_without_verification');
      expect(constraint).toBeDefined();
      expect(constraint?.kind).toBe('check');
      expect(constraint?.severity).toBe('error');
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
    expect(result.errors.length + result.warnings.length).toBeGreaterThan(0);
  });

  it('kind=check 但未注册 checker 的约束应抛错（不许静默 pass）', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    await expect(
      constraintChecker.check(
        {
          id: 'ghost_check_constraint',
          kind: 'check',
          severity: 'warning',
          rule: 'GHOST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      )
    ).rejects.toThrow(/未注册 checker/);
  });

  it('should check all constraints', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
      hasRequirement: true,
      hasVerificationEvidence: true,
      hasSingleTask: true,
    };

    const result = await constraintChecker.checkConstraints(context);
    expect(result.errors.length + result.warnings.length).toBeGreaterThan(0);
  });

  it('should skip no_completion_without_verification when hasVerificationEvidence is undefined（未接线不评估）', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    const result = await constraintChecker.check(CONSTRAINTS['no_completion_without_verification'], context);
    expect(result.skipped).toBe(true);
    expect(result.satisfied).toBe(true);
  });

  it('should pass no_completion_without_verification when hasVerificationEvidence is true', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
      hasVerificationEvidence: true,
    };

    const result = await constraintChecker.check(CONSTRAINTS['no_completion_without_verification'], context);
    expect(result.satisfied).toBe(true);
  });
});

describe('Constraint Severity', () => {
  it('error 级约束 severity 均为 error', () => {
    ['no_completion_without_verification', 'no_test_simplification', 'docs_freshness'].forEach(id => {
      expect(CONSTRAINTS[id].severity).toBe('error');
    });
  });

  it('warning 级约束 severity 均为 warning', () => {
    ['no_hardcoded_credentials', 'capability_sync', 'context_doc_sync', 'governance_presence'].forEach(id => {
      expect(CONSTRAINTS[id].severity).toBe('warning');
    });
  });
});
