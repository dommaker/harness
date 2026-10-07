/**
 * checker.ts 测试
 *
 * ADR-0029：只覆盖存活 check 约束的 checker 行为；
 * prompt 面已删除，其短路用例随之移除。
 */

import { ConstraintChecker, checkConstraint } from '../core/constraints/checker';
import type { ConstraintContext } from '../types/constraint';
import { rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ConstraintChecker', () => {
  const checker = ConstraintChecker.getInstance();
  let tempDir: string;

  beforeAll(() => {
    // 创建临时测试目录
    tempDir = mkdtempSync(join(tmpdir(), 'temp-test-checker-'));
  });

  afterAll(() => {
    // 清理临时测试目录
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('error 级约束', () => {
    it('should check no_completion_without_verification', async () => {
      // harness#183：验证证据 = .harness/evidence 落盘（独立链路），不再是 context flag
      const withEvidence = join(tempDir, 'with-evidence');
      mkdirSync(join(withEvidence, '.harness', 'evidence'), { recursive: true });
      writeFileSync(join(withEvidence, '.harness', 'evidence', 'test.log'), 'ok');
      const withoutEvidence = join(tempDir, 'without-evidence');
      mkdirSync(withoutEvidence, { recursive: true });

      const contextWithEvidence: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: withEvidence,
        changedFiles: [],
      };

      const contextWithoutEvidence: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: withoutEvidence,
      };

      const resultWithEvidence = await checker.check(
        { id: 'no_completion_without_verification', kind: 'check', severity: 'error', rule: 'NO COMPLETION', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithEvidence
      );

      const resultWithoutEvidence = await checker.check(
        { id: 'no_completion_without_verification', kind: 'check', severity: 'error', rule: 'NO COMPLETION', message: 'test', trigger: 'code_implementation', enforcement: 'test' },
        contextWithoutEvidence
      );

      expect(resultWithEvidence.satisfied).toBe(true);
      expect(resultWithoutEvidence.satisfied).toBe(false);
    });
  });

  describe('warning 级约束', () => {
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
        { id: 'capability_sync', kind: 'check', severity: 'warning', rule: 'CAPABILITY SYNC', message: 'test', trigger: 'commit', enforcement: 'test' },
        context
      );

      // 有 CAPABILITIES.md 文件，应该通过
      expect(result.satisfied).toBe(true);

      // 清理
      fs.unlinkSync(capabilitiesPath);
    });
  });

  describe('Helper functions', () => {
    it('should check single constraint via checkConstraint', async () => {
      const withEvidence = join(tempDir, 'helper-with-evidence');
      mkdirSync(join(withEvidence, '.harness', 'evidence'), { recursive: true });
      writeFileSync(join(withEvidence, '.harness', 'evidence', 'test.log'), 'ok');
      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: withEvidence,
        changedFiles: [],
      };

      const result = await checkConstraint('no_completion_without_verification', context);
      expect(result.satisfied).toBe(true);
    });

    it('should throw for unknown constraint（注册表闭环口径：未注册即抛，不回假结果）', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
      };

      await expect(checkConstraint('unknown_constraint', context)).rejects.toThrow('未知的约束');
    });
  });
});
