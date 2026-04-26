/**
 * checker.ts 测试
 */

import { ConstraintChecker, checkConstraints, checkConstraint } from '../core/constraints/checker';
import type { ConstraintContext } from '../types/constraint';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('ConstraintChecker', () => {
  const checker = ConstraintChecker.getInstance();
  const tempDir = join(process.cwd(), 'temp-test-checker');

  beforeAll(() => {
    // 创建临时测试目录
    mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    // 清理临时测试目录
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Iron Laws', () => {
    it('should check no_bypass_checkpoint with skip patterns', async () => {
      // 创建包含 skip 的文件
      const skipFile = join(tempDir, 'skip-test.ts');
      writeFileSync(skipFile, 'test.skip("skipped test", () => {});');

      const context: ConstraintContext = {
        operation: 'step_execution',
        changedFiles: [skipFile],
      };

      const result = await checker.check(
        { id: 'no_bypass_checkpoint', level: 'iron_law', rule: 'NO BYPASS', message: 'test', trigger: 'step_execution', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('should pass no_bypass_checkpoint without skip patterns', async () => {
      const normalFile = join(tempDir, 'normal-test.ts');
      writeFileSync(normalFile, 'test("normal test", () => { expect(true).toBe(true); });');

      const context: ConstraintContext = {
        operation: 'step_execution',
        changedFiles: [normalFile],
      };

      const result = await checker.check(
        { id: 'no_bypass_checkpoint', level: 'iron_law', rule: 'NO BYPASS', message: 'test', trigger: 'step_execution', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should check no_self_approval with test evidence', async () => {
      const contextWithTest: ConstraintContext = {
        operation: 'task_completion_claim',
        hasTest: true,
      };

      const contextWithoutTest: ConstraintContext = {
        operation: 'task_completion_claim',
        hasTest: false,
      };

      const resultWithTest = await checker.check(
        { id: 'no_self_approval', level: 'iron_law', rule: 'NO SELF APPROVAL', message: 'test', trigger: 'task_completion_claim', enforcement: 'test' },
        contextWithTest
      );

      const resultWithoutTest = await checker.check(
        { id: 'no_self_approval', level: 'iron_law', rule: 'NO SELF APPROVAL', message: 'test', trigger: 'task_completion_claim', enforcement: 'test' },
        contextWithoutTest
      );

      expect(resultWithTest.satisfied).toBe(true);
      expect(resultWithoutTest.satisfied).toBe(false);
    });

    it('should check no_completion_without_verification', async () => {
      const contextWithEvidence: ConstraintContext = {
        operation: 'task_completion_claim',
        hasVerificationEvidence: true,
      };

      const contextWithoutEvidence: ConstraintContext = {
        operation: 'task_completion_claim',
        hasVerificationEvidence: false,
      };

      const resultWithEvidence = await checker.check(
        { id: 'no_completion_without_verification', level: 'iron_law', rule: 'NO COMPLETION', message: 'test', trigger: 'task_completion_claim', enforcement: 'test' },
        contextWithEvidence
      );

      const resultWithoutEvidence = await checker.check(
        { id: 'no_completion_without_verification', level: 'iron_law', rule: 'NO COMPLETION', message: 'test', trigger: 'task_completion_claim', enforcement: 'test' },
        contextWithoutEvidence
      );

      expect(resultWithEvidence.satisfied).toBe(true);
      expect(resultWithoutEvidence.satisfied).toBe(false);
    });
  });

  describe('Guidelines', () => {
    it('should check no_any_type with any in file', async () => {
      const anyFile = join(tempDir, 'any-test.ts');
      writeFileSync(anyFile, 'const x: any = "test";');

      const context: ConstraintContext = {
        operation: 'code_implementation',
        changedFiles: [anyFile],
      };

      const result = await checker.check(
        { id: 'no_any_type', level: 'guideline', rule: 'NO ANY', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('should pass no_any_type without any type', async () => {
      const safeFile = join(tempDir, 'safe-test.ts');
      writeFileSync(safeFile, 'const x: string = "test";');

      const context: ConstraintContext = {
        operation: 'code_implementation',
        changedFiles: [safeFile],
      };

      const result = await checker.check(
        { id: 'no_any_type', level: 'guideline', rule: 'NO ANY', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should check capability_sync without CAPABILITIES.md', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        { id: 'capability_sync', level: 'guideline', rule: 'CAPABILITY SYNC', message: 'test', trigger: 'commit', enforcement: 'test' },
        context
      );

      // 无代码变更，默认通过
      expect(result.satisfied).toBe(true);
    });

    it('should check no_fix_without_root_cause', async () => {
      const contextWithInvestigation: ConstraintContext = {
        operation: 'bug_fix_attempt',
        hasRootCauseInvestigation: true,
      };

      const contextWithoutInvestigation: ConstraintContext = {
        operation: 'bug_fix_attempt',
        hasRootCauseInvestigation: false,
      };

      const resultWith = await checker.check(
        { id: 'no_fix_without_root_cause', level: 'guideline', rule: 'NO FIX', message: 'test', trigger: 'bug_fix_attempt', enforcement: 'test' },
        contextWithInvestigation
      );

      const resultWithout = await checker.check(
        { id: 'no_fix_without_root_cause', level: 'guideline', rule: 'NO FIX', message: 'test', trigger: 'bug_fix_attempt', enforcement: 'test' },
        contextWithoutInvestigation
      );

      expect(resultWith.satisfied).toBe(true);
      expect(resultWithout.satisfied).toBe(false);
    });

    it('should check no_code_without_test', async () => {
      const contextWithFailingTest: ConstraintContext = {
        operation: 'code_implementation',
        hasFailingTest: true,
      };

      const contextWithoutTest: ConstraintContext = {
        operation: 'code_implementation',
        hasFailingTest: false,
      };

      const resultWith = await checker.check(
        { id: 'no_code_without_test', level: 'guideline', rule: 'NO CODE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithFailingTest
      );

      const resultWithout = await checker.check(
        { id: 'no_code_without_test', level: 'guideline', rule: 'NO CODE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithoutTest
      );

      expect(resultWith.satisfied).toBe(true);
      expect(resultWithout.satisfied).toBe(false);
    });

    it('should check reuse-first guidelines', async () => {
      const contextWithReuseCheck: ConstraintContext = {
        operation: 'feature_development',
        hasReuseCheck: true,
      };

      const contextWithoutReuseCheck: ConstraintContext = {
        operation: 'feature_development',
        hasReuseCheck: false,
      };

      const resultWith = await checker.check(
        { id: 'no_creation_without_reuse_check', level: 'guideline', rule: 'REUSE FIRST', message: 'test', trigger: 'feature_development', enforcement: 'test' },
        contextWithReuseCheck
      );

      const resultWithout = await checker.check(
        { id: 'no_creation_without_reuse_check', level: 'guideline', rule: 'REUSE FIRST', message: 'test', trigger: 'feature_development', enforcement: 'test' },
        contextWithoutReuseCheck
      );

      expect(resultWith.satisfied).toBe(true);
      expect(resultWithout.satisfied).toBe(false);
    });
  });

  describe('New Iron Laws', () => {
    it('should check incremental_progress', async () => {
      const contextWithSingleTask: ConstraintContext = {
        operation: 'feature_completion_claim',
        hasSingleTask: true,
      };

      const contextWithMultipleTasks: ConstraintContext = {
        operation: 'feature_completion_claim',
        hasSingleTask: false,
      };

      const resultWith = await checker.check(
        { id: 'incremental_progress', level: 'iron_law', rule: 'ONE TASK', message: 'test', trigger: 'feature_completion_claim', enforcement: 'test' },
        contextWithSingleTask
      );

      const resultWithout = await checker.check(
        { id: 'incremental_progress', level: 'iron_law', rule: 'ONE TASK', message: 'test', trigger: 'feature_completion_claim', enforcement: 'test' },
        contextWithMultipleTasks
      );

      expect(resultWith.satisfied).toBe(true);
      expect(resultWithout.satisfied).toBe(false);
    });

    it('should check verify_external_capability', async () => {
      const contextVerified: ConstraintContext = {
        operation: 'external_api_design',
        hasExternalCapabilityVerification: true,
      };

      const contextNotVerified: ConstraintContext = {
        operation: 'external_api_design',
        hasExternalCapabilityVerification: false,
      };

      const resultVerified = await checker.check(
        { id: 'verify_external_capability', level: 'iron_law', rule: 'VERIFY', message: 'test', trigger: 'external_api_design', enforcement: 'test' },
        contextVerified
      );

      const resultNotVerified = await checker.check(
        { id: 'verify_external_capability', level: 'iron_law', rule: 'VERIFY', message: 'test', trigger: 'external_api_design', enforcement: 'test' },
        contextNotVerified
      );

      expect(resultVerified.satisfied).toBe(true);
      expect(resultNotVerified.satisfied).toBe(false);
    });
  });

  describe('Exception handling', () => {
    it('should apply exception for no_fix_without_root_cause with simple_typo', async () => {
      const context: ConstraintContext = {
        operation: 'bug_fix_attempt',
        hasRootCauseInvestigation: false,
        isSimpleTypo: true,
      };

      const result = await checker.check(
        {
          id: 'no_fix_without_root_cause',
          level: 'guideline',
          rule: 'NO FIX',
          message: 'test',
          trigger: 'bug_fix_attempt',
          enforcement: 'test',
          exceptions: ['simple_typo'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
      expect(result.message).toContain('豁免');
    });
  });

  describe('Helper functions', () => {
    it('should check single constraint via checkConstraint', async () => {
      const context: ConstraintContext = {
        operation: 'task_completion_claim',
        hasTest: true,
      };

      const result = await checkConstraint('no_self_approval', context);
      expect(result.satisfied).toBe(true);
    });

    it('should return false for unknown constraint', async () => {
      const context: ConstraintContext = {
        operation: 'task_completion_claim',
      };

      const result = await checkConstraint('unknown_constraint', context);
      expect(result.satisfied).toBe(false);
      expect(result.message).toContain('未知的约束');
    });
  });
});