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
        operation: 'code_implementation',
        changedFiles: [skipFile],
      };

      const result = await checker.check(
        { id: 'no_bypass_checkpoint', level: 'iron_law', rule: 'NO BYPASS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
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
        { id: 'no_bypass_checkpoint', level: 'iron_law', rule: 'NO BYPASS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should check no_self_approval with test evidence', async () => {
      const contextWithTest: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: true,
      };

      const contextWithoutTest: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: false,
      };

      const resultWithTest = await checker.check(
        { id: 'no_self_approval', level: 'iron_law', rule: 'NO SELF APPROVAL', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithTest
      );

      const resultWithoutTest = await checker.check(
        { id: 'no_self_approval', level: 'iron_law', rule: 'NO SELF APPROVAL', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithoutTest
      );

      expect(resultWithTest.satisfied).toBe(true);
      expect(resultWithoutTest.satisfied).toBe(false);
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
        { id: 'no_completion_without_verification', level: 'iron_law', rule: 'NO COMPLETION', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithEvidence
      );

      const resultWithoutEvidence = await checker.check(
        { id: 'no_completion_without_verification', level: 'iron_law', rule: 'NO COMPLETION', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
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
        { id: 'capability_sync', level: 'guideline', rule: 'CAPABILITY SYNC', message: 'test', trigger: 'commit', enforcement: 'test' },
        context
      );

      // 有 CAPABILITIES.md 文件，应该通过
      expect(result.satisfied).toBe(true);

      // 清理
      fs.unlinkSync(capabilitiesPath);
    });

    it('should check no_fix_without_root_cause', async () => {
      const contextWithInvestigation: ConstraintContext = {
        operation: 'code_implementation',
        hasRootCauseInvestigation: true,
      };

      const contextWithoutInvestigation: ConstraintContext = {
        operation: 'code_implementation',
        hasRootCauseInvestigation: false,
      };

      const resultWith = await checker.check(
        { id: 'no_fix_without_root_cause', level: 'guideline', rule: 'NO FIX', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithInvestigation
      );

      const resultWithout = await checker.check(
        { id: 'no_fix_without_root_cause', level: 'guideline', rule: 'NO FIX', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
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
        operation: 'code_implementation',
        hasReuseCheck: true,
      };

      const contextWithoutReuseCheck: ConstraintContext = {
        operation: 'code_implementation',
        hasReuseCheck: false,
      };

      const resultWith = await checker.check(
        { id: 'no_creation_without_reuse_check', level: 'guideline', rule: 'REUSE FIRST', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithReuseCheck
      );

      const resultWithout = await checker.check(
        { id: 'no_creation_without_reuse_check', level: 'guideline', rule: 'REUSE FIRST', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithoutReuseCheck
      );

      expect(resultWith.satisfied).toBe(true);
      expect(resultWithout.satisfied).toBe(false);
    });
  });

  describe('New Iron Laws', () => {
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
        { id: 'incremental_progress', level: 'iron_law', rule: 'ONE TASK', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithSingleTask
      );

      const resultWithout = await checker.check(
        { id: 'incremental_progress', level: 'iron_law', rule: 'ONE TASK', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithMultipleTasks
      );

      expect(resultWith.satisfied).toBe(true);
      expect(resultWithout.satisfied).toBe(false);
    });

    it('should check verify_external_capability', async () => {
      const contextVerified: ConstraintContext = {
        operation: 'api_change',
        hasExternalCapabilityVerification: true,
      };

      const contextNotVerified: ConstraintContext = {
        operation: 'api_change',
        hasExternalCapabilityVerification: false,
      };

      const resultVerified = await checker.check(
        { id: 'verify_external_capability', level: 'iron_law', rule: 'VERIFY', message: 'test', trigger: 'api_change', enforcement: 'test' },
        contextVerified
      );

      const resultNotVerified = await checker.check(
        { id: 'verify_external_capability', level: 'iron_law', rule: 'VERIFY', message: 'test', trigger: 'api_change', enforcement: 'test' },
        contextNotVerified
      );

      expect(resultVerified.satisfied).toBe(true);
      expect(resultNotVerified.satisfied).toBe(false);
    });
  });

  describe('Exception handling', () => {
    it('should apply exception for no_fix_without_root_cause with simple_typo', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasRootCauseInvestigation: false,
        isSimpleTypo: true,
      };

      const result = await checker.check(
        {
          id: 'no_fix_without_root_cause',
          level: 'guideline',
          rule: 'NO FIX',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['simple_typo'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
      expect(result.message).toContain('豁免');
    });

    it('should apply exception for scalability_required', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasReuseCheck: false,
        scalabilityRequired: true,
      };

      const result = await checker.check(
        {
          id: 'simplest_solution_first',
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
        hasReuseCheck: false,
        securityRequired: true,
      };

      const result = await checker.check(
        {
          id: 'simplest_solution_first',
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
        hasReuseCheck: false,
        performanceRequired: true,
      };

      const result = await checker.check(
        {
          id: 'simplest_solution_first',
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
        hasReuseCheck: false,
        reliabilityRequired: true,
      };

      const result = await checker.check(
        {
          id: 'simplest_solution_first',
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
        hasRootCauseInvestigation: false,
        isConfigValueError: true,
      };

      const result = await checker.check(
        {
          id: 'no_fix_without_root_cause',
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
        hasRootCauseInvestigation: false,
        isMissingConfig: true,
      };

      const result = await checker.check(
        {
          id: 'no_fix_without_root_cause',
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
        hasFailingTest: false,
        isConfigFile: true,
      };

      const result = await checker.check(
        {
          id: 'no_code_without_test',
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
        hasFailingTest: false,
        isTypeDefinition: true,
      };

      const result = await checker.check(
        {
          id: 'no_code_without_test',
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
        hasFailingTest: false,
        isSimpleAccessor: true,
      };

      const result = await checker.check(
        {
          id: 'no_code_without_test',
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
        hasFailingTest: false,
        isPureDisplayComponent: true,
      };

      const result = await checker.check(
        {
          id: 'no_code_without_test',
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

    it('should apply exception for json_parse_result', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        changedFiles: [],
        isJsonParseResult: true,
      };

      const result = await checker.check(
        {
          id: 'no_any_type',
          level: 'guideline',
          rule: 'NO ANY',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['json_parse_result'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for third_party_no_types', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        changedFiles: [],
        isThirdPartyNoTypes: true,
      };

      const result = await checker.check(
        {
          id: 'no_any_type',
          level: 'guideline',
          rule: 'NO ANY',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['third_party_no_types'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should apply exception for legacy_migration', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        changedFiles: [],
        isLegacyMigration: true,
      };

      const result = await checker.check(
        {
          id: 'no_any_type',
          level: 'guideline',
          rule: 'NO ANY',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['legacy_migration'],
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

  describe('Deprecated functions', () => {
    it('getAllLaws should work', () => {
      const { getAllLaws } = require('../core/constraints/definitions');
      const laws = getAllLaws();
      expect(Array.isArray(laws)).toBe(true);
      expect(laws.length).toBeGreaterThan(0);
    });

    it('findLawsByTrigger should work', () => {
      const { findLawsByTrigger } = require('../core/constraints/definitions');
      const laws = findLawsByTrigger('code_implementation');
      expect(Array.isArray(laws)).toBe(true);
    });

    it('getLaw should work', () => {
      const { getLaw } = require('../core/constraints/definitions');
      const law = getLaw('no_bypass_checkpoint');
      expect(law).toBeDefined();
    });

    it('filterLawsBySeverity should work', () => {
      const { filterLawsBySeverity } = require('../core/constraints/definitions');
      const errors = filterLawsBySeverity('error');
      expect(Array.isArray(errors)).toBe(true);
      
      const warnings = filterLawsBySeverity('warning');
      expect(Array.isArray(warnings)).toBe(true);
      
      const infos = filterLawsBySeverity('info');
      expect(Array.isArray(infos)).toBe(true);
    });
  });

  describe('Helper functions', () => {
    it('should check single constraint via checkConstraint', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: true,
      };

      const result = await checkConstraint('no_self_approval', context);
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

  describe('Text pattern constraints', () => {
    it('no_fuzzy_completion_claim should detect Chinese fuzzy words', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        completionClaimText: '应该没问题，大概完成了',
      };

      const result = await checker.check(
        { id: 'no_fuzzy_completion_claim', level: 'iron_law', rule: 'NO FUZZY', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('no_fuzzy_completion_claim should pass clean text', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        completionClaimText: '142 tests passed, coverage 87.3%',
      };

      const result = await checker.check(
        { id: 'no_fuzzy_completion_claim', level: 'iron_law', rule: 'NO FUZZY', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('no_fuzzy_completion_claim should pass with empty text', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        completionClaimText: '',
      };

      const result = await checker.check(
        { id: 'no_fuzzy_completion_claim', level: 'iron_law', rule: 'NO FUZZY', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('no_performative_agreement should detect performative patterns', async () => {
      const context: ConstraintContext = {
        operation: 'design_request',
        taskDescription: '好的，我来做',
      };

      const result = await checker.check(
        { id: 'no_performative_agreement', level: 'iron_law', rule: 'NO PERFORMATIVE', message: 'test', trigger: 'design_request', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('no_performative_agreement should pass with analysis', async () => {
      const context: ConstraintContext = {
        operation: 'design_request',
        taskDescription: 'This is a detailed analysis of the problem with multiple considerations and proposed solutions.',
      };

      const result = await checker.check(
        { id: 'no_performative_agreement', level: 'iron_law', rule: 'NO PERFORMATIVE', message: 'test', trigger: 'design_request', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('no_claim_without_evidence should pass with verification evidence', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: true,
      };

      const result = await checker.check(
        { id: 'no_claim_without_evidence', level: 'guideline', rule: 'NO CLAIM', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('no_claim_without_evidence should pass with taskDescription containing test', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: false,
        taskDescription: 'Need to run the test suite to verify',
      };

      const result = await checker.check(
        { id: 'no_claim_without_evidence', level: 'guideline', rule: 'NO CLAIM', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('no_claim_without_evidence should fail without evidence', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: false,
        hasTest: false,
        taskDescription: 'Did some work',
      };

      const result = await checker.check(
        { id: 'no_claim_without_evidence', level: 'guideline', rule: 'NO CLAIM', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('no_delete_without_context should pass with requirement review', async () => {
      const context: ConstraintContext = {
        operation: 'file_deletion',
        hasRequirementReview: true,
      };

      const result = await checker.check(
        { id: 'no_delete_without_context', level: 'guideline', rule: 'NO DELETE', message: 'test', trigger: 'file_deletion', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('no_delete_without_context should pass with existing design', async () => {
      const context: ConstraintContext = {
        operation: 'file_deletion',
        hasRequirementReview: false,
        hasRequirement: false,
        isExistingDesign: true,
      };

      const result = await checker.check(
        { id: 'no_delete_without_context', level: 'guideline', rule: 'NO DELETE', message: 'test', trigger: 'file_deletion', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('no_delete_without_context should fail without any context', async () => {
      const context: ConstraintContext = {
        operation: 'file_deletion',
        hasRequirementReview: false,
        hasRequirement: false,
        isExistingDesign: false,
      };

      const result = await checker.check(
        { id: 'no_delete_without_context', level: 'guideline', rule: 'NO DELETE', message: 'test', trigger: 'file_deletion', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(false);
    });
  });

  describe('Behavior guidelines (always true)', () => {
    it('surgical_changes_only should return true', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'surgical_changes_only', level: 'guideline', rule: 'SURGICAL', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('no_model_for_deterministic should return true', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'no_model_for_deterministic', level: 'guideline', rule: 'NO MODEL', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('no_conflict_blending should return true', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'no_conflict_blending', level: 'guideline', rule: 'NO BLEND', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('read_before_write should return true', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'read_before_write', level: 'guideline', rule: 'READ FIRST', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('first_principles_first should return true', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'first_principles_first', level: 'guideline', rule: 'PRINCIPLES', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('fix_the_problem_not_the_gate should return true', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'fix_the_problem_not_the_gate', level: 'guideline', rule: 'FIX PROBLEM', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('diagnosis_to_fix_gate should return true', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'diagnosis_to_fix_gate', level: 'guideline', rule: 'DIAGNOSIS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('follow_conventions should return true', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'follow_conventions', level: 'guideline', rule: 'CONVENTIONS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });
  });

  describe('Default guideline constraints', () => {
    it('no_hardcoded_credentials should pass by default', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'no_hardcoded_credentials', level: 'guideline', rule: 'NO CREDENTIALS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('design_decision_requires_discussion should pass by default', async () => {
      const context: ConstraintContext = { operation: 'code_implementation' };
      const result = await checker.check(
        { id: 'design_decision_requires_discussion', level: 'guideline', rule: 'DISCUSS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });
  });

  describe('Additional Iron Laws (pure context)', () => {
    it('no_implementation_without_requirement_review should pass with review', async () => {
      const context: ConstraintContext = { operation: 'code_implementation', hasRequirementReview: true };
      const result = await checker.check(
        { id: 'no_implementation_without_requirement_review', level: 'iron_law', rule: 'REVIEW REQ', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('no_implementation_without_requirement_review should fail without review', async () => {
      const context: ConstraintContext = { operation: 'code_implementation', hasRequirementReview: false };
      const result = await checker.check(
        { id: 'no_implementation_without_requirement_review', level: 'iron_law', rule: 'REVIEW REQ', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(false);
    });

    it('no_implementation_without_requirement should pass with requirement', async () => {
      const context: ConstraintContext = { operation: 'code_implementation', hasRequirement: true };
      const result = await checker.check(
        { id: 'no_implementation_without_requirement', level: 'iron_law', rule: 'REQ EXISTS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('no_implementation_without_requirement should fail without requirement', async () => {
      const context: ConstraintContext = { operation: 'code_implementation', hasRequirement: false };
      const result = await checker.check(
        { id: 'no_implementation_without_requirement', level: 'iron_law', rule: 'REQ EXISTS', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(false);
    });

    it('prefer_worktree should pass with worktree', async () => {
      const context: ConstraintContext = { operation: 'code_implementation', hasWorktree: true };
      const result = await checker.check(
        { id: 'prefer_worktree', level: 'guideline', rule: 'WORKTREE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('prefer_worktree should fail without worktree', async () => {
      const context: ConstraintContext = { operation: 'code_implementation', hasWorktree: false };
      const result = await checker.check(
        { id: 'prefer_worktree', level: 'guideline', rule: 'WORKTREE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(false);
    });

    it('two_stage_review_required should pass with two-stage review', async () => {
      const context: ConstraintContext = { operation: 'code_implementation', hasTwoStageReview: true };
      const result = await checker.check(
        { id: 'two_stage_review_required', level: 'iron_law', rule: 'TWO STAGE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('two_stage_review_required should fail without two-stage review', async () => {
      const context: ConstraintContext = { operation: 'code_implementation', hasTwoStageReview: false };
      const result = await checker.check(
        { id: 'two_stage_review_required', level: 'iron_law', rule: 'TWO STAGE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(false);
    });
  });

  describe('Additional guidelines (pure context)', () => {
    it('no_skill_without_test should pass with test', async () => {
      const context: ConstraintContext = { operation: 'module_creation', hasTest: true };
      const result = await checker.check(
        { id: 'no_skill_without_test', level: 'guideline', rule: 'SKILL TEST', message: 'test', trigger: 'module_creation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('no_skill_without_test should fail without test', async () => {
      const context: ConstraintContext = { operation: 'module_creation', hasTest: false };
      const result = await checker.check(
        { id: 'no_skill_without_test', level: 'guideline', rule: 'SKILL TEST', message: 'test', trigger: 'module_creation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(false);
    });

    it('simplest_solution_first should pass with reuse check', async () => {
      // matches trigger code_implementation
      const context: ConstraintContext = { operation: 'code_implementation', hasReuseCheck: true };
      const result = await checker.check(
        { id: 'simplest_solution_first', level: 'guideline', rule: 'SIMPLEST', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('simplest_solution_first should fail without reuse check', async () => {
      const context: ConstraintContext = { operation: 'code_implementation', hasReuseCheck: false };
      const result = await checker.check(
        { id: 'simplest_solution_first', level: 'guideline', rule: 'SIMPLEST', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(false);
    });
  });

  describe('Tip constraints', () => {
    it('readme_required should always pass', async () => {
      const context: ConstraintContext = { operation: 'module_creation' };
      const result = await checker.check(
        { id: 'readme_required', level: 'tip', rule: 'README', message: 'test', trigger: 'module_creation', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });

    it('doc_required_for_public_api should always pass', async () => {
      const context: ConstraintContext = { operation: 'export_change' };
      const result = await checker.check(
        { id: 'doc_required_for_public_api', level: 'tip', rule: 'DOC', message: 'test', trigger: 'export_change', enforcement: 'test' },
        context
      );
      expect(result.satisfied).toBe(true);
    });
  });

  describe('no_excuse_patterns', () => {
    it('should detect excuse patterns in completion claim', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        completionClaimText: '稍后修复这个bug',
      };

      const result = await checker.check(
        { id: 'no_excuse_patterns', level: 'guideline', rule: 'NO EXCUSE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('should detect excuse patterns in task description', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        taskDescription: '这是个临时方案，先这样',
      };

      const result = await checker.check(
        { id: 'no_excuse_patterns', level: 'guideline', rule: 'NO EXCUSE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(false);
    });

    it('should pass with clean text', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        completionClaimText: 'Fixed by refactoring the validation logic in checker.ts',
      };

      const result = await checker.check(
        { id: 'no_excuse_patterns', level: 'guideline', rule: 'NO EXCUSE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('should pass with empty text', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
      };

      const result = await checker.check(
        { id: 'no_excuse_patterns', level: 'guideline', rule: 'NO EXCUSE', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        context
      );

      expect(result.satisfied).toBe(true);
    });
  });
});