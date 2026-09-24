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
import * as os from 'os';
import { execSync } from 'child_process';

describe('ConstraintChecker - 补充覆盖', () => {
  let tempDir: string;
  const checker = ConstraintChecker.getInstance();

  beforeAll(() => {
    // 创建临时 git 仓库
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-checker-extra-'));
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

      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some(c => c.id === 'no_completion_without_verification')
      ).toBe(true);
    });

    it('不匹配的 trigger 应该返回空数组', () => {
      const context: ConstraintContext = {
        operation: 'file_creation',  // 一个很少用到的 trigger
      };

      const result = checker.findApplicableConstraints(context);

      // file_creation 可能没有任何约束匹配
      // 这个测试的目的是验证按 trigger 过滤逻辑
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe('checkBeforeExecution', () => {
    it('通过检查不应该抛出异常', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: true,
        hasVerificationEvidence: true,
        hasRequirement: true,
        taskDescription: 'Test task — single focused change',
        hasSingleTask: true,
      };

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

    it('customConfig 应替换内置集（空配置不检查内置 error 级约束）', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      // 内置 error 级约束下违规抛错
      await expect(checkBeforeExecution(context)).rejects.toThrow();

      // 空 customConfig 替换内置集 → 不抛
      await expect(
        checkBeforeExecution(context, { constraints: {}, disabled: [] })
      ).resolves.not.toThrow();
    });
  });

  describe('checkConstraints 完整流程', () => {
    it('应该返回完整的检查结果', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        hasTest: true,
        hasReuseCheck: true,
      };

      const result = await checkConstraints(context);

      expect(result.errors).toBeDefined();
      expect(result.warnings).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.warningCount).toBe('number');
    });
  });

  describe('自定义约束配置', () => {
    it('per-request customConfig 应该生效', () => {
      const constraints = checker.getConstraints({
        constraints: {},
        disabled: [],
      });

      expect(constraints).toEqual({});
    });

    it('checkConstraint 带 customConfig 应命中配置内约束', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: true,
      };
      const customConfig = {
        constraints: {
          no_completion_without_verification: {
            id: 'no_completion_without_verification',
            kind: 'check' as const,
            severity: 'error' as const,
            rule: 'TEST',
            message: 'test',
            trigger: 'code_implementation',
            enforcement: 'test',
          },
        },
        disabled: [] as string[],
      };

      // 不带 customConfig：未生效的 id 不可见
      const missing = await checkConstraint('test_only', context);
      expect(missing.satisfied).toBe(false);
      expect(missing.message).toContain('未知的约束');

      // 带 customConfig：命中配置内约束
      const hit = await checkConstraint('no_completion_without_verification', context, customConfig);
      expect(hit.id).toBe('no_completion_without_verification');
      expect(hit.satisfied).toBe(true);
    });
  });

  describe('severity 透传', () => {
    it('check 结果带约束定义的 severity', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: true,
      };

      const result = await checker.check(
        {
          id: 'no_completion_without_verification',
          kind: 'check',
          severity: 'error',
          rule: 'TEST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result.severity).toBe('error');
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

  describe('checkConstraints error 级违规', () => {
    it('error 级违规应该抛出 ConstraintViolationError', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      await expect(checkConstraints(context)).rejects.toThrow();
    });
  });

  describe('channel 通道分发过滤（ADR-0035）', () => {
    const disciplineEntry = {
      id: 'app_discipline_rule',
      kind: 'check' as const,
      channel: 'discipline' as const,
      severity: 'error' as const,
      rule: 'DISCIPLINE RECORD',
      message: '纪律登记记录',
      trigger: 'code_implementation',
      enforcement: '',
      source: 'app' as const,
    };
    const customConfig = {
      constraints: { app_discipline_rule: disciplineEntry },
      disabled: [] as string[],
    };
    const context: ConstraintContext = { operation: 'code_implementation' };

    it('非 gate 条目不进入 checker 分发、不触发注册表闭环抛错', async () => {
      const result = await checker.checkConstraints(context, customConfig);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('findApplicableConstraints 同样过滤非 gate 条目', () => {
      const applicable = checker.findApplicableConstraints(context, customConfig);
      expect(applicable.errors).toHaveLength(0);
      expect(applicable.warnings).toHaveLength(0);
    });

    it('beforeExecution 跳过非 gate 条目', async () => {
      await expect(checkBeforeExecution(context, customConfig)).resolves.not.toThrow();
    });

    it('非 gate 条目漏到 check() 单条入口 → 抛错（编排层过滤缺失不静默）', async () => {
      await expect(checker.check(disciplineEntry, context)).rejects.toThrow(/不进入检查分发/);
    });

    it('channel: gate 且无 checker 的条目依旧当场抛错（闭环不松绑）', async () => {
      const gateNoChecker = {
        id: 'no_such_builtin_constraint',
        kind: 'check' as const,
        channel: 'gate' as const,
        severity: 'error' as const,
        rule: 'GATE WITHOUT CHECKER',
        message: 'gate 无 checker',
        trigger: 'code_implementation',
        enforcement: '',
      };
      await expect(checker.check(gateNoChecker, context)).rejects.toThrow(/未注册 checker/);
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
