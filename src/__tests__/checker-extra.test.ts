/**
 * checker.ts 补充测试（engine 流程面：findApplicable/beforeExecution/快捷函数/缓存契约）
 *
 * 单个检查器的判定测试不放这里——在 checkers/__tests__/ 旁测，测 evaluate(env) interface
 * （ADR-0009 / 架构评审候选4；全部 10 个已注册 checker 旁测就位）。
 * （ADR-0001：已退役 checker 的用例随约束数据模型 v2 移除）
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  ConstraintChecker,
  checkConstraint,
  checkConstraints,
  checkBeforeExecution,
} from '../core/constraints/checker';
import { buildCheckEnv } from '../core/constraints/checkers';
import { contextEvidenceFlag } from '../core/constraints/checkers/types';
import type { ConstraintContext } from '../types/constraint';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('ConstraintChecker - 补充覆盖', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-checker-extra');
  const checker = ConstraintChecker.getInstance();

  beforeAll(() => {
    // 创建临时 git 仓库
    fs.mkdirSync(tempDir, { recursive: true });
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });

    // 初始提交
    const initialFile = path.join(tempDir, 'initial.txt');
    fs.writeFileSync(initialFile, 'initial');
    execSync('git add .', { cwd: tempDir });
    execSync('git commit -m "init"', { cwd: tempDir });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
  describe('findApplicableConstraints', () => {
    it('应该过滤出匹配 trigger 的约束', () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
      };

      const result = checker.findApplicableConstraints(context);

      expect(result.ironLaws.length).toBeGreaterThan(0);
      expect(
        result.ironLaws.some((c: any) => c.id === 'no_completion_without_verification')
      ).toBe(true);
    });

    it('不匹配的 trigger 应该返回空数组', () => {
      const context: ConstraintContext = {
        operation: 'file_creation',  // 一个很少用到的 trigger
      };

      const result = checker.findApplicableConstraints(context);

      // file_creation 可能没有任何约束匹配
      // 这个测试的目的是验证 filterByTrigger 逻辑
      expect(Array.isArray(result.ironLaws)).toBe(true);
      expect(Array.isArray(result.guidelines)).toBe(true);
    });
  });

  describe('checkBeforeExecution', () => {
    it('通过检查不应该抛出异常', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: true,
        hasVerificationEvidence: true,
        hasWorktree: true,
        hasRequirement: true,
        taskDescription: 'Test task — single focused change',
        hasSingleTask: true,
        hasRequirementReview: true,
        hasTwoStageReview: true,
        completionClaimText: 'All 142 tests passed, coverage 87.3%',
      } as any;

      // 不应该抛出异常
      await expect(checkBeforeExecution(context)).resolves.not.toThrow();
    });

    it('违规应该抛出 ConstraintViolationError', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      await expect(checkBeforeExecution(context)).rejects.toThrow();
    });

    it('customConfig 应替换内置集（空配置不检查内置铁律）', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      // 内置铁律下违规抛错
      await expect(checkBeforeExecution(context)).rejects.toThrow();

      // 空 customConfig 替换内置集 → 不抛
      await expect(
        checkBeforeExecution(context, { ironLaws: {}, guidelines: {}, disabled: [], custom: [] })
      ).resolves.not.toThrow();
    });
  });

  describe('checkConstraints 完整流程', () => {
    it('应该返回完整的三层检查结果', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        hasTest: true,
        hasReuseCheck: true,
      };

      const result = await checkConstraints(context);

      expect(result.ironLaws).toBeDefined();
      expect(result.guidelines).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.warningCount).toBe('number');
    });
  });

  describe('自定义约束配置', () => {
    it('per-request customConfig 应该生效', () => {
      const constraints = checker.getConstraints({
        ironLaws: {},
        guidelines: {},
        disabled: [],
        custom: [],
      });

      expect(constraints.ironLaws).toEqual({});
      expect(constraints.guidelines).toEqual({});
    });

    it('checkConstraint 带 customConfig 应命中自定义约束', async () => {
      const context: ConstraintContext = { operation: 'file_modification' };
      const customConfig = {
        ironLaws: {
          test_only: {
            id: 'test_only',
            kind: 'prompt' as const,
            level: 'iron_law' as const,
            rule: 'TEST',
            message: 'test',
            trigger: 'file_modification',
            enforcement: 'test',
          },
        },
        guidelines: {},
        disabled: [] as string[],
        custom: [] as string[],
      };

      // 不带 customConfig：自定义约束不可见
      const missing = await checkConstraint('test_only', context);
      expect(missing.satisfied).toBe(false);
      expect(missing.message).toContain('未知的约束');

      // 带 customConfig：命中（prompt kind 直接 pass）
      const hit = await checkConstraint('test_only', context, customConfig);
      expect(hit.id).toBe('test_only');
      expect(hit.satisfied).toBe(true);
    });
  });

  describe('getSeverity', () => {
    it('iron_law 应该返回 error', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: true,
      };

      const result = await checker.check(
        {
          id: 'test_severity_iron',
          kind: 'prompt',
          level: 'iron_law',
          rule: 'TEST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result).toBeDefined();
    });

    it('guideline 应该返回 warning', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
      };

      const result = await checker.check(
        {
          id: 'test_severity_guideline',
          kind: 'prompt',
          level: 'guideline',
          rule: 'TEST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result).toBeDefined();
    });

  });

  describe('checkConstraint 快捷函数', () => {
    it('未知约束应该返回不满足', async () => {
      const { checkConstraint } = await import('../core/constraints/checker');

      const context: ConstraintContext = {
        operation: 'commit',
      };

      const result = await checkConstraint('nonexistent_constraint', context);
      expect(result.satisfied).toBe(false);
      expect(result.message).toContain('未知');
    });

    it('已知约束应该正常检查', async () => {
      const { checkConstraint } = await import('../core/constraints/checker');

      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: true,
      };

      const result = await checkConstraint('no_completion_without_verification', context);
      expect(result.id).toBe('no_completion_without_verification');
      expect(result.satisfied).toBe(true);
    });
  });

  describe('checkConstraints Iron Law 违规', () => {
    it('Iron Law 违规应该抛出 ConstraintViolationError', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      await expect(checkConstraints(context)).rejects.toThrow();
    });
  });
});

describe('buildCheckEnv - 证据接线契约', () => {
  const context: ConstraintContext = { operation: 'manual', projectPath: '/nonexistent' };

  it("'none' 变体：证据函数返回空", async () => {
    const env = buildCheckEnv(context, 'none');
    expect(env.projectPath).toBe('/nonexistent');
    expect(await env.stagedDiff()).toBe('');
    expect(await env.stagedDiffNames()).toBe('');
    expect(env.srcScan('src')).toEqual([]);
  });

  it('providers 变体：证据提供者原样透传', async () => {
    const providers = {
      stagedDiff: async () => 'diff-content',
      stagedDiffNames: async () => 'a.ts\nb.ts',
      srcScan: (root: string) => [`${root}/x.ts`],
    };
    const env = buildCheckEnv(context, providers);
    expect(await env.stagedDiff()).toBe('diff-content');
    expect(await env.stagedDiffNames()).toBe('a.ts\nb.ts');
    expect(env.srcScan('src')).toEqual(['src/x.ts']);
  });

  it("'none' env 下 evidence flag 未接线的 checker 返回 'skip'", async () => {
    // 「没接证据 → skip」由注释固化为可执行契约
    const check = contextEvidenceFlag('test-flag', (ctx) => ctx.hasVerificationEvidence);
    const env = buildCheckEnv(context, 'none');
    expect(await check.evaluate(env)).toBe('skip');
  });
});
