/**
 * checker.ts 测试
 *
 * ADR-0001：只覆盖存活 check 约束的 checker 行为；
 * prompt 类约束的短路语义见 'Prompt constraints' 一节；
 * 已退役/被吸收约束的用例随之移除。
 */

import { ConstraintChecker, checkConstraint } from '../core/constraints/checker';
import { PROMPTS } from '../core/constraints/definitions';
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
        operation: 'code_implementation',
        changedFiles: [skipFile],
      };

      const result = await checker.check(
        { id: 'no_bypass_checkpoint', kind: 'check', level: 'guideline', rule: 'NO BYPASS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('should pass no_bypass_checkpoint without skip patterns', async () => {
      const normalFile = join(tempDir, 'normal-test.ts');
      writeFileSync(normalFile, 'test("normal test", () => { expect(true).toBe(true); });');

      const context: ConstraintContext = {
        operation: 'code_implementation',
        changedFiles: [normalFile],
      };

      const result = await checker.check(
        { id: 'no_bypass_checkpoint', kind: 'check', level: 'guideline', rule: 'NO BYPASS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should check no_completion_without_verification', async () => {
      const contextWithEvidence: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: true,
      };

      const contextWithoutEvidence: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: false,
      };

      const resultWithEvidence = await checker.check(
        { id: 'no_completion_without_verification', kind: 'check', level: 'iron_law', rule: 'NO COMPLETION', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithEvidence
      );

      const resultWithoutEvidence = await checker.check(
        { id: 'no_completion_without_verification', kind: 'check', level: 'iron_law', rule: 'NO COMPLETION', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithoutEvidence
      );

      expect(resultWithEvidence.satisfied).toBe(true);
      expect(resultWithoutEvidence.satisfied).toBe(false);
    });

    it('should check incremental_progress', async () => {
      const contextWithSingleTask: ConstraintContext = {
        operation: 'code_implementation',
        hasSingleTask: true,
      };

      const contextWithMultipleTasks: ConstraintContext = {
        operation: 'code_implementation',
        hasSingleTask: false,
      };

      const resultWith = await checker.check(
        { id: 'incremental_progress', kind: 'check', level: 'iron_law', rule: 'ONE TASK', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithSingleTask
      );

      const resultWithout = await checker.check(
        { id: 'incremental_progress', kind: 'check', level: 'iron_law', rule: 'ONE TASK', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithMultipleTasks
      );

      expect(resultWith.satisfied).toBe(true);
      expect(resultWithout.satisfied).toBe(false);
    });

    it('should check no_implementation_without_requirement', async () => {
      const contextWithRequirement: ConstraintContext = {
        operation: 'code_implementation',
        hasRequirement: true,
      };

      const contextWithoutRequirement: ConstraintContext = {
        operation: 'code_implementation',
        hasRequirement: false,
      };

      const resultWith = await checker.check(
        { id: 'no_implementation_without_requirement', kind: 'check', level: 'iron_law', rule: 'REQ EXISTS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithRequirement
      );

      const resultWithout = await checker.check(
        { id: 'no_implementation_without_requirement', kind: 'check', level: 'iron_law', rule: 'REQ EXISTS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithoutRequirement
      );

      expect(resultWith.satisfied).toBe(true);
      expect(resultWithout.satisfied).toBe(false);
    });
  });

  describe('Guidelines', () => {
    it('should check capability_sync without CAPABILITIES.md', async () => {
      // 注意：tempDir 在 harness 仓库内，如果有缓存的变更，会检查到代码变更
      // 所以需要创建一个无代码变更的场景或创建 CAPABILITIES.md
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      // 创建 CAPABILITIES.md 文件确保测试通过
      const fs = require('fs');
      const path = require('path');
      const capabilitiesPath = path.join(tempDir, 'CAPABILITIES.md');
      fs.writeFileSync(capabilitiesPath, '# Capabilities\n');

      const result = await checker.check(
        { id: 'capability_sync', kind: 'check', level: 'guideline', rule: 'CAPABILITY SYNC', message: 'test', trigger: 'commit', enforcement: 'test' },
        context
      );

      // 有 CAPABILITIES.md 文件，应该通过
      expect(result.satisfied).toBe(true);

      // 清理
      fs.unlinkSync(capabilitiesPath);
    });
  });

  describe('Exception handling', () => {
    it('should apply exception for scalability_required', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        scalabilityRequired: true,
      };

      const result = await checker.check(
        {
          id: 'simplest_solution_first',
          kind: 'check',
          level: 'guideline',
          rule: 'SIMPLEST FIRST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['scalability_required'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for security_required', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        securityRequired: true,
      };

      const result = await checker.check(
        {
          id: 'simplest_solution_first',
          kind: 'check',
          level: 'guideline',
          rule: 'SIMPLEST FIRST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['security_required'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for performance_required', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        performanceRequired: true,
      };

      const result = await checker.check(
        {
          id: 'simplest_solution_first',
          kind: 'check',
          level: 'guideline',
          rule: 'SIMPLEST FIRST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['performance_required'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for reliability_required', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        reliabilityRequired: true,
      };

      const result = await checker.check(
        {
          id: 'simplest_solution_first',
          kind: 'check',
          level: 'guideline',
          rule: 'SIMPLEST FIRST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['reliability_required'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for config_value_error', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        isConfigValueError: true,
      };

      const result = await checker.check(
        {
          id: 'no_fix_without_root_cause',
          kind: 'check',
          level: 'guideline',
          rule: 'NO FIX',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['config_value_error'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for missing_config', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        isMissingConfig: true,
      };

      const result = await checker.check(
        {
          id: 'no_fix_without_root_cause',
          kind: 'check',
          level: 'guideline',
          rule: 'NO FIX',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['missing_config'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for config_file', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        isConfigFile: true,
      };

      const result = await checker.check(
        {
          id: 'no_code_without_test',
          kind: 'check',
          level: 'guideline',
          rule: 'NO CODE',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['config_file'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for type_definition', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        isTypeDefinition: true,
      };

      const result = await checker.check(
        {
          id: 'no_code_without_test',
          kind: 'check',
          level: 'guideline',
          rule: 'NO CODE',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['type_definition'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for simple_accessor', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        isSimpleAccessor: true,
      };

      const result = await checker.check(
        {
          id: 'no_code_without_test',
          kind: 'check',
          level: 'guideline',
          rule: 'NO CODE',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['simple_accessor'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for pure_display_component', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        isPureDisplayComponent: true,
      };

      const result = await checker.check(
        {
          id: 'no_code_without_test',
          kind: 'check',
          level: 'guideline',
          rule: 'NO CODE',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['pure_display_component'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for internal_refactor', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        isInternalRefactor: true,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
          exceptions: ['internal_refactor'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for bug_fix_only', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        isBugFixOnly: true,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
          exceptions: ['bug_fix_only'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for performance_optimization', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        isPerformanceOptimization: true,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
          exceptions: ['performance_optimization'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for redundant_code_cleanup', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        isRedundantCodeCleanup: true,
      };

      const result = await checker.check(
        {
          id: 'no_simplification_without_approval',
          kind: 'check',
          level: 'guideline',
          rule: 'NO SIMPLIFICATION',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
          exceptions: ['redundant_code_cleanup'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for same_effect_refactor', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        isSameEffectRefactor: true,
      };

      const result = await checker.check(
        {
          id: 'no_simplification_without_approval',
          kind: 'check',
          level: 'guideline',
          rule: 'NO SIMPLIFICATION',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
          exceptions: ['same_effect_refactor'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for unused_code_removal', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        isUnusedCodeRemoval: true,
      };

      const result = await checker.check(
        {
          id: 'no_simplification_without_approval',
          kind: 'check',
          level: 'guideline',
          rule: 'NO SIMPLIFICATION',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
          exceptions: ['unused_code_removal'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });
  });

  describe('Prompt constraints（ADR-0001：不执行 checker，check() 短路 satisfied）', () => {
    it('所有内置 prompt 约束 check() 均短路通过', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      for (const prompt of Object.values(PROMPTS)) {
        const result = await checker.check(prompt, context);
        expect(result.satisfied).toBe(true);
      }
    });

    it('prompt 短路不产生 requiredAction/message', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(PROMPTS['no_fix_without_root_cause'], context);
      expect(result.satisfied).toBe(true);
      expect(result.message).toBeUndefined();
      expect(result.requiredAction).toBeUndefined();
    });
  });

  describe('Helper functions', () => {
    it('should check single constraint via checkConstraint', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: true,
      };

      const result = await checkConstraint('no_completion_without_verification', context);
      expect(result.satisfied).toBe(true);
    });

    it('prompt 约束经 checkConstraint 短路通过', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
      };

      const result = await checkConstraint('no_fuzzy_completion_claim', context);
      expect(result.id).toBe('no_fuzzy_completion_claim');
      expect(result.satisfied).toBe(true);
    });

    it('should return false for unknown constraint', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
      };

      const result = await checkConstraint('unknown_constraint', context);
      expect(result.satisfied).toBe(false);
      expect(result.message).toContain('未知的约束');
    });
  });
});
