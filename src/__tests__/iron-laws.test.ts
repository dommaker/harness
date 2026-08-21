/**
 * 约束系统测试（ADR-0001：kind 二元模型，26 条清单构成 + 注册表闭环）
 */

import { describe, it, expect } from '@jest/globals';
import {
  IRON_LAWS,
  GUIDELINES,
  PROMPTS,
  getAllConstraints,
  findConstraintsByTrigger,
  getConstraint
} from '../core/constraints/definitions';
import { constraintChecker } from '../core/constraints/checker';
import { getConstraintCheck, registeredCheckCount } from '../core/constraints/checkers';
import type { ConstraintContext } from '../types/constraint';

describe('Constraint System', () => {
  describe('清单构成（ADR-0001：42 → 26）', () => {
    it('getAllConstraints 返回 26 条：10 check + 16 prompt', () => {
      const all = getAllConstraints();
      expect(all).toHaveLength(26);
      expect(all.filter(c => c.kind === 'check')).toHaveLength(10);
      expect(all.filter(c => c.kind === 'prompt')).toHaveLength(16);
    });

    it('check 层 = 5 iron + 5 guideline', () => {
      expect(Object.keys(IRON_LAWS)).toHaveLength(5);
      expect(Object.keys(GUIDELINES)).toHaveLength(5);
      Object.values(IRON_LAWS).forEach(c => {
        expect(c.kind).toBe('check');
        expect(c.level).toBe('iron_law');
      });
      Object.values(GUIDELINES).forEach(c => {
        expect(c.kind).toBe('check');
        expect(c.level).toBe('guideline');
      });
    });

    it('prompt 层 16 条，level 统一为 prompt', () => {
      expect(Object.keys(PROMPTS)).toHaveLength(16);
      Object.values(PROMPTS).forEach(c => {
        expect(c.kind).toBe('prompt');
        expect(c.level).toBe('prompt');
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

    it('场景标签：no_skill_without_test / no_model_for_deterministic', () => {
      expect(PROMPTS['no_skill_without_test'].appliesTo).toEqual(['agent-skill']);
      expect(PROMPTS['no_model_for_deterministic'].appliesTo).toEqual(['llm-app']);
    });

    it('no_completion_without_verification 不硬编码具体命令示例（#25：口径由项目声明）', () => {
      const law = IRON_LAWS['no_completion_without_verification'];
      expect(law.promptInjection).not.toMatch(/npm test|npm run build/);
      expect(law.description).not.toMatch(/npm test|npm run build/);
      expect(law.promptInjection).not.toContain('完整');
      expect(law.description).not.toContain('完整');
      expect(law.promptInjection).toContain('项目声明的测试');
      expect(law.description).toContain('项目声明的测试');
      expect(law.promptInjection).toContain('不得凭记忆声称完成');
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

    it('prompt 约束不注册 checker', () => {
      for (const c of Object.values(PROMPTS)) {
        expect(getConstraintCheck(c.id)).toBeUndefined();
      }
    });
  });

  describe('Helper Functions', () => {
    it('should find constraints by trigger', () => {
      const constraints = findConstraintsByTrigger('code_implementation');
      expect(constraints.length).toBeGreaterThan(0);
    });

    it('should get single constraint by id', () => {
      const constraint = getConstraint('no_fix_without_root_cause');
      expect(constraint).toBeDefined();
      expect(constraint?.kind).toBe('prompt');
      expect(constraint?.level).toBe('prompt');
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
    expect(result.ironLaws.length + result.guidelines.length).toBeGreaterThan(0);
  });

  it('prompt 约束 check() 短路 satisfied，不查注册表', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    const result = await constraintChecker.check(PROMPTS['no_fix_without_root_cause'], context);
    expect(result.satisfied).toBe(true);
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
          level: 'guideline',
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
    expect(result.ironLaws.length + result.guidelines.length).toBeGreaterThan(0);
  });

  it('should skip incremental_progress when hasSingleTask is undefined（未接线不评估）', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    const result = await constraintChecker.check(IRON_LAWS['incremental_progress'], context);
    expect(result.skipped).toBe(true);
    expect(result.satisfied).toBe(true);
  });

  it('should pass incremental_progress when hasSingleTask is true', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
      hasSingleTask: true,
    };

    const result = await constraintChecker.check(IRON_LAWS['incremental_progress'], context);
    expect(result.satisfied).toBe(true);
  });

  it('should skip no_implementation_without_requirement when hasRequirement is undefined（未接线不评估）', async () => {
    const context: ConstraintContext = {
      operation: 'code_implementation',
    };

    const result = await constraintChecker.check(IRON_LAWS['no_implementation_without_requirement'], context);
    expect(result.skipped).toBe(true);
    expect(result.satisfied).toBe(true);
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

  it('should have correct level for prompts', () => {
    Object.values(PROMPTS).forEach(prompt => {
      expect(prompt.level).toBe('prompt');
    });
  });
});
