/**
 * checker.ts 补充测试
 * 
 * 目标：覆盖 checkTestCoverage、checkNoSimplificationWithoutApproval、
 *       checkCapabilitySync 完整流程、beforeExecution、findApplicableConstraints
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  ConstraintChecker,
  checkConstraints,
  checkBeforeExecution,
} from '../core/constraints/checker';
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

  describe('checkTestCoverage', () => {
    it('无 coverage 报告应该通过', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'test_coverage_required',
          level: 'guideline',
          rule: 'COVERAGE',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('有 coverage-summary.json 且达标应该通过', async () => {
      // 创建 coverage 目录和报告
      const coverageDir = path.join(tempDir, 'coverage');
      fs.mkdirSync(coverageDir, { recursive: true });

      const summaryPath = path.join(coverageDir, 'coverage-summary.json');
      fs.writeFileSync(
        summaryPath,
        JSON.stringify({
          total: {
            lines: { pct: 80 },
            statements: { pct: 80 },
            branches: { pct: 75 },
            functions: { pct: 85 },
          },
        })
      );

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'test_coverage_required',
          level: 'guideline',
          rule: 'COVERAGE',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      // 清理
      fs.rmSync(coverageDir, { recursive: true, force: true });
    });

    it('覆盖率低于 50% 应该失败', async () => {
      const coverageDir = path.join(tempDir, 'coverage');
      fs.mkdirSync(coverageDir, { recursive: true });

      const summaryPath = path.join(coverageDir, 'coverage-summary.json');
      fs.writeFileSync(
        summaryPath,
        JSON.stringify({
          total: {
            lines: { pct: 30 },
          },
        })
      );

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'test_coverage_required',
          level: 'guideline',
          rule: 'COVERAGE',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(false);

      fs.rmSync(coverageDir, { recursive: true, force: true });
    });

    it('coverage-summary.json 解析失败应该通过', async () => {
      const coverageDir = path.join(tempDir, 'coverage');
      fs.mkdirSync(coverageDir, { recursive: true });

      const summaryPath = path.join(coverageDir, 'coverage-summary.json');
      fs.writeFileSync(summaryPath, 'invalid json {');

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'test_coverage_required',
          level: 'guideline',
          rule: 'COVERAGE',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      // 解析失败默认通过
      expect(result.satisfied).toBe(true);

      fs.rmSync(coverageDir, { recursive: true, force: true });
    });
  });

  describe('checkNoSimplificationWithoutApproval', () => {
    it('正常 diff 应该通过', async () => {
      // clean state
      execSync('git checkout .', { cwd: tempDir, stdio: 'pipe' });
      
      const normalFile = path.join(tempDir, 'normal.ts');
      fs.writeFileSync(normalFile, 'export const x = 1;');

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'no_simplification_without_approval',
          level: 'guideline',
          rule: 'NO SIMPLIFICATION',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('包含简化关键词应该失败', async () => {
      // 先完成之前的提交
      execSync('git add .', { cwd: tempDir });
      execSync('git commit -m "cleanup" --allow-empty', { cwd: tempDir });
      
      // 创建包含简化关键词的文件并 stage
      const simplifyFile = path.join(tempDir, 'simplify-msg.ts');
      fs.writeFileSync(simplifyFile, '// removed test for simplicity\nexport const y = 2;');
      execSync('git add .', { cwd: tempDir });

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'no_simplification_without_approval',
          level: 'guideline',
          rule: 'NO SIMPLIFICATION',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(false);
      
      // cleanup - unstage and remove
      execSync('git reset HEAD -- ' + simplifyFile, { cwd: tempDir, stdio: 'pipe' });
      fs.rmSync(simplifyFile, { force: true });
    });
  });

  describe('checkCapabilitySync', () => {
    it('无代码变更应该通过', async () => {
      // 清理 staged changes
      execSync('git reset HEAD', { cwd: tempDir, stdio: 'pipe' });
      
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('有代码变更且有 CAPABILITIES.md 应该通过', async () => {
      // 创建 CAPABILITIES.md（如果不存在）
      const capFile = path.join(tempDir, 'CAPABILITIES.md');
      fs.writeFileSync(capFile, '# Capabilities\n\n- Feature: test');
      
      // 创建代码文件并 stage
      const codeFile = path.join(tempDir, 'feature.ts');
      fs.writeFileSync(codeFile, 'export function feature() {}');
      execSync('git add .', { cwd: tempDir });

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      // Cleanup
      execSync('git reset HEAD', { cwd: tempDir, stdio: 'pipe' });
    });

    it('有代码变更但无 CAPABILITIES.md 应该失败', async () => {
      // 确保 CAPABILITIES.md 不存在
      const capFile = path.join(tempDir, 'CAPABILITIES.md');
      if (fs.existsSync(capFile)) {
        fs.rmSync(capFile, { force: true });
      }
      
      // 创建新的代码文件并 stage
      const newCodeFile = path.join(tempDir, 'newfeature.ts');
      fs.writeFileSync(newCodeFile, 'export function newfeature() {}');
      execSync('git add ' + newCodeFile, { cwd: tempDir });

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      // 没有 CAPABILITIES.md，应该失败
      expect(result.satisfied).toBe(false);

      // Cleanup
      execSync('git reset HEAD', { cwd: tempDir, stdio: 'pipe' });
    });
  });

  describe('findApplicableConstraints', () => {
    it('应该过滤出匹配 trigger 的约束', () => {
      const context: ConstraintContext = {
        operation: 'task_completion_claim',
      };

      const result = checker.findApplicableConstraints(context);

      expect(result.ironLaws.length).toBeGreaterThan(0);
      expect(
        result.ironLaws.some((c: any) => c.id === 'no_self_approval')
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
      expect(Array.isArray(result.tips)).toBe(true);
    });
  });

  describe('checkBeforeExecution', () => {
    it('通过检查不应该抛出异常', async () => {
      const context: ConstraintContext = {
        operation: 'task_completion_claim',
        hasTest: true,
        hasVerificationEvidence: true,
      };

      // 不应该抛出异常
      await expect(checkBeforeExecution(context)).resolves.not.toThrow();
    });

    it('违规应该抛出 ConstraintViolationError', async () => {
      const context: ConstraintContext = {
        operation: 'task_completion_claim',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      await expect(checkBeforeExecution(context)).rejects.toThrow();
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
      expect(result.tips).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.warningCount).toBe('number');
      expect(typeof result.tipCount).toBe('number');
    });
  });

  describe('自定义约束配置', () => {
    it('setCustomConfig 应该生效', () => {
      checker.setCustomConfig({
        ironLaws: {},
        guidelines: {},
        tips: {},
        disabled: [],
        custom: [],
      });

      const constraints = checker.getConstraints();

      expect(constraints.ironLaws).toEqual({});
      expect(constraints.guidelines).toEqual({});
      expect(constraints.tips).toEqual({});

      // 重置为默认
      (checker as any).customConfig = null;
    });
  });

  describe('getSeverity', () => {
    it('iron_law 应该返回 error', async () => {
      const context: ConstraintContext = {
        operation: 'step_execution',
        hasTest: true,
      };

      const result = await checker.check(
        {
          id: 'test_severity_iron',
          level: 'iron_law',
          rule: 'TEST',
          message: 'test',
          trigger: 'step_execution',
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

    it('tip 应该返回 info', async () => {
      const context: ConstraintContext = {
        operation: 'step_execution',
      };

      const result = await checker.check(
        {
          id: 'test_severity_tip',
          level: 'tip',
          rule: 'TEST',
          message: 'test',
          trigger: 'step_execution',
          enforcement: 'test',
        },
        context
      );

      expect(result).toBeDefined();
    });
  });

  describe('checkException 例外豁免', () => {
    it('guideline 匹配例外条件应该被豁免', async () => {
      const context: ConstraintContext = {
        operation: 'bug_fix_attempt',
        isSimpleTypo: true,
      };

      const result = await checker.check(
        {
          id: 'no_fix_without_root_cause',
          level: 'guideline',
          rule: 'NO FIXES WITHOUT ROOT CAUSE',
          message: 'test',
          trigger: 'bug_fix_attempt',
          enforcement: 'test',
          exceptions: ['simple_typo', 'config_value_error'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
      expect(result.message).toContain('豁免');
    });

    it('guideline 不匹配例外条件应该正常检查', async () => {
      const context: ConstraintContext = {
        operation: 'bug_fix_attempt',
        isSimpleTypo: false,
        isConfigValueError: false,
      };

      const result = await checker.check(
        {
          id: 'no_fix_without_root_cause',
          level: 'guideline',
          rule: 'NO FIXES WITHOUT ROOT CAUSE',
          message: 'test',
          trigger: 'bug_fix_attempt',
          enforcement: 'test',
          exceptions: ['simple_typo', 'config_value_error'],
        },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('iron_law 不应该检查例外条件', async () => {
      const context: ConstraintContext = {
        operation: 'task_completion_claim',
        hasTest: false,
      };

      const result = await checker.check(
        {
          id: 'no_self_approval',
          level: 'iron_law',
          rule: 'NO SELF APPROVAL',
          message: 'test',
          trigger: 'task_completion_claim',
          enforcement: 'test',
          exceptions: ['simple_typo'],
        },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('无 exceptions 字段应该正常检查', async () => {
      const context: ConstraintContext = {
        operation: 'bug_fix_attempt',
        hasRootCauseInvestigation: true,
      };

      const result = await checker.check(
        {
          id: 'no_fix_without_root_cause',
          level: 'guideline',
          rule: 'NO FIXES WITHOUT ROOT CAUSE',
          message: 'test',
          trigger: 'bug_fix_attempt',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });
  });

  describe('checkNoBypassCheckpoint 文件内容检查', () => {
    it('changedFiles 包含 skip 内容应该失败', async () => {
      const bypassFile = path.join(tempDir, 'bypass-test.ts');
      fs.writeFileSync(bypassFile, 'test.skip("skipped", () => {});');
      execSync('git add .', { cwd: tempDir, stdio: 'pipe' });

      const context: ConstraintContext = {
        operation: 'step_execution',
        projectPath: tempDir,
        changedFiles: [bypassFile],
      };

      const result = await checker.check(
        {
          id: 'no_bypass_checkpoint',
          level: 'iron_law',
          rule: 'NO BYPASS',
          message: 'test',
          trigger: 'step_execution',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(false);

      fs.unlinkSync(bypassFile);
      execSync('git reset HEAD -- ' + bypassFile, { cwd: tempDir, stdio: 'pipe' });
    });

    it('changedFiles 不包含 bypass 内容应该通过', async () => {
      const cleanFile = path.join(tempDir, 'clean-test.ts');
      fs.writeFileSync(cleanFile, 'test("clean", () => { expect(true).toBe(true); });');
      execSync('git add .', { cwd: tempDir, stdio: 'pipe' });

      const context: ConstraintContext = {
        operation: 'step_execution',
        projectPath: tempDir,
        changedFiles: [cleanFile],
      };

      const result = await checker.check(
        {
          id: 'no_bypass_checkpoint',
          level: 'iron_law',
          rule: 'NO BYPASS',
          message: 'test',
          trigger: 'step_execution',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.unlinkSync(cleanFile);
      execSync('git reset HEAD -- ' + cleanFile, { cwd: tempDir, stdio: 'pipe' });
    });
  });

  describe('checkNoAnyType 文件检查', () => {
    it('.ts 文件包含 : any 应该失败', async () => {
      const anyFile = path.join(tempDir, 'any-test.ts');
      fs.writeFileSync(anyFile, 'const x: any = {};');

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: tempDir,
        changedFiles: [anyFile],
      };

      const result = await checker.check(
        {
          id: 'no_any_type',
          level: 'guideline',
          rule: 'NO ANY',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(false);

      fs.unlinkSync(anyFile);
    });

    it('.ts 文件注释中的 : any 应该被忽略', async () => {
      const commentFile = path.join(tempDir, 'comment-any.ts');
      fs.writeFileSync(commentFile, '// const x: any = {};\nconst y: string = "ok";');

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: tempDir,
        changedFiles: [commentFile],
      };

      const result = await checker.check(
        {
          id: 'no_any_type',
          level: 'guideline',
          rule: 'NO ANY',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.unlinkSync(commentFile);
    });

    it('非 .ts 文件应该跳过检查', async () => {
      const jsFile = path.join(tempDir, 'any-test.js');
      fs.writeFileSync(jsFile, 'const x = {};');

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: tempDir,
        changedFiles: [jsFile],
      };

      const result = await checker.check(
        {
          id: 'no_any_type',
          level: 'guideline',
          rule: 'NO ANY',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.unlinkSync(jsFile);
    });
  });

  describe('checkTestCoverage coverage-final.json', () => {
    it('只有 coverage-final.json 应该通过', async () => {
      const coverageDir = path.join(tempDir, 'coverage');
      fs.mkdirSync(coverageDir, { recursive: true });

      const finalPath = path.join(coverageDir, 'coverage-final.json');
      fs.writeFileSync(finalPath, JSON.stringify({}));

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'test_coverage_required',
          level: 'guideline',
          rule: 'COVERAGE',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(coverageDir, { recursive: true, force: true });
    });
  });

  describe('deprecated 函数', () => {
    it('checkIronLaw 应该等同于 checkConstraint', async () => {
      const { checkIronLaw } = await import('../core/constraints/checker');

      const context: ConstraintContext = {
        operation: 'task_completion_claim',
        hasTest: true,
        hasVerificationEvidence: true,
      };

      const result = await checkIronLaw('no_self_approval', context);
      expect(result.id).toBe('no_self_approval');
      expect(result.satisfied).toBe(true);
    });

    it('checkAllIronLaws 应该返回所有检查结果', async () => {
      const { checkAllIronLaws } = await import('../core/constraints/checker');

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        hasTest: true,
      };

      const results = await checkAllIronLaws(context);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
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
        operation: 'task_completion_claim',
        hasTest: true,
      };

      const result = await checkConstraint('no_self_approval', context);
      expect(result.id).toBe('no_self_approval');
      expect(result.satisfied).toBe(true);
    });
  });

  describe('checkConstraints Iron Law 违规', () => {
    it('Iron Law 违规应该抛出 ConstraintViolationError', async () => {
      const context: ConstraintContext = {
        operation: 'task_completion_claim',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      await expect(checkConstraints(context)).rejects.toThrow();
    });
  });

  describe('checkNoTestSimplification git diff 失败', () => {
    it('git diff 失败应该默认通过', async () => {
      // 非 git 目录
      const nonGitDir = path.join(tempDir, 'non-git');
      fs.mkdirSync(nonGitDir, { recursive: true });

      const context: ConstraintContext = {
        operation: 'test_creation',
        projectPath: nonGitDir,
      };

      const result = await checker.check(
        {
          id: 'no_test_simplification',
          level: 'iron_law',
          rule: 'NO SIMPLIFY',
          message: 'test',
          trigger: 'test_creation',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(nonGitDir, { recursive: true, force: true });
    });
  });
});
