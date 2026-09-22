/**
 * collectConstraints — 收集模式（架构评审候选1）
 *
 * 与 checkConstraints 共享检查体，唯一差别是不 throw：
 * 铁律违规不抛、全量收进 ironLaws、guidelines 照常、passed 如实。
 * block 模式的 throw 契约由 checker-extra / iron-laws 既有用例钉住，这里只测 collect 侧。
 */

import { describe, it, expect } from '@jest/globals';
import { ConstraintChecker } from '../checker';
import type { ConstraintContext, ConstraintResult } from '../../../types/constraint';

// 缺省 no-op trace 记录器：本套件不验 trace 面（trace 面由 trace-injection 套件钉住）
const checker = new ConstraintChecker();

/** 只违 no_completion_without_verification，其余铁律满足（flag 口径同 checker-extra） */
const VIOLATING: ConstraintContext = {
  operation: 'code_implementation',
  hasTest: false,
  hasVerificationEvidence: false,
  hasRequirement: true,
  hasSingleTask: true,
  taskDescription: 'single focused change',
};

const CLEAN: ConstraintContext = {
  operation: 'code_implementation',
  hasTest: true,
  hasVerificationEvidence: true,
  hasRequirement: true,
  hasSingleTask: true,
  taskDescription: 'single focused change',
};

describe('collectConstraints（收集模式，不抛）', () => {
  it('铁律违规不抛 —— resolves 而非 rejects', async () => {
    await expect(checker.collectConstraints(VIOLATING)).resolves.toBeDefined();
  });

  it('违规铁律如实进 ironLaws：satisfied=false 且 passed=false', async () => {
    const result = await checker.collectConstraints(VIOLATING);
    const violated = result.errors.find((r: ConstraintResult) => r.id === 'no_completion_without_verification');
    expect(violated).toBeDefined();
    expect(violated!.satisfied).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('首个违规不截断：触发域内后续铁律照常评估', async () => {
    // 首条铁律（no_completion_without_verification）违规后，extraTriggers 带入的
    // no_test_simplification 仍须出现在收集结果里
    const result = await checker.collectConstraints({
      ...VIOLATING,
      extraTriggers: ['test_creation'],
    });
    const ids = result.errors.map((r: ConstraintResult) => r.id);
    expect(ids).toContain('no_completion_without_verification');
    expect(ids).toContain('no_test_simplification');
  });

  it('guidelines 照常执行，warningCount 与不满意条目同口径', async () => {
    // 触发域用 module_modification：32c07ed 把 no_hardcoded_credentials 升 error 级后，
    // code_implementation 域内已无 warning 级约束，原断言恒假
    const result = await checker.collectConstraints({ ...VIOLATING, operation: 'module_modification' });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warningCount).toBe(result.warnings.filter((g: ConstraintResult) => !g.satisfied).length);
  });

  it('干净上下文对照：passed=true、ironLaws 全满意', async () => {
    const result = await checker.collectConstraints(CLEAN);
    expect(result.passed).toBe(true);
    expect(result.errors.every((r: ConstraintResult) => r.satisfied)).toBe(true);
  });
});
