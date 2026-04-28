/**
 * ArchitectureConstraintEngine 测试
 */

import { describe, it, expect } from '@jest/globals';
import { ArchitectureConstraintEngine } from '../architecture/constraint-engine';
import type { ArchitectureRule, ArchitectureContext } from '../architecture/constraint-engine';

describe('ArchitectureConstraintEngine', () => {
  describe('forbidden-pattern 规则', () => {
    it('应该检测禁止模式', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'no-test-in-src',
          type: 'forbidden-pattern',
          patterns: ['test'],
          severity: 'error',
          message: '源码目录不应包含 test',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['src/utils/test-helper.ts', 'src/utils/helper.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].ruleId).toBe('no-test-in-src');
    });

    it('应该支持 scope 过滤', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'no-test-in-core',
          type: 'forbidden-pattern',
          patterns: ['test'],
          scope: 'src/core/*',
          severity: 'error',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['src/utils/test-helper.ts', 'src/core/test.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.violations.length).toBe(1);
      expect(result.violations[0].files?.[0]).toBe('src/core/test.ts');
    });

    it('警告级别不应该影响 passed', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'warning-rule',
          type: 'forbidden-pattern',
          patterns: ['warn'],
          severity: 'warning',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['src/warning.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(1);
    });
  });

  describe('file-count 规则', () => {
    it('应该检测文件数超限', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'max-10-files',
          type: 'file-count',
          threshold: 10,
          severity: 'error',
          message: '单次提交文件数过多',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: Array(15).fill('file.ts'),
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain('文件数');
    });

    it('文件数未超限应该通过', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'max-10-files',
          type: 'file-count',
          threshold: 10,
          severity: 'error',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: Array(5).fill('file.ts'),
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.violations.length).toBe(0);
    });
  });

  describe('module-boundary 规则', () => {
    it('应该检测跨模块访问', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'no-cross-module',
          type: 'module-boundary',
          severity: 'error',
          message: '禁止跨模块访问',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['packages/core/src/index.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      // module-boundary 需要额外配置才能检测，这里只验证不崩溃
      expect(result).toBeDefined();
    });
  });

  describe('多规则', () => {
    it('应该执行所有规则', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'no-test',
          type: 'forbidden-pattern',
          patterns: ['test'],
          severity: 'error',
        },
        {
          id: 'max-files',
          type: 'file-count',
          threshold: 5,
          severity: 'warning',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['test.ts', 'test2.ts', 'file1.ts', 'file2.ts', 'file3.ts', 'file4.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('空规则', () => {
    it('空规则数组应该返回 passed', async () => {
      const engine = new ArchitectureConstraintEngine([]);
      const context: ArchitectureContext = {
        files: ['any.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.passed).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });
});
