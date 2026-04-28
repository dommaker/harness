/**
 * ArchitectureConstraintEngine 测试
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ArchitectureConstraintEngine, loadArchitectureRules, runArchitectureCheck } from '../architecture/constraint-engine';
import type { ArchitectureRule, ArchitectureContext } from '../architecture/constraint-engine';
import * as fs from 'fs';
import * as path from 'path';

describe('ArchitectureConstraintEngine', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-arch');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

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

    it('多个 pattern 应该全部检测', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'no-forbidden',
          type: 'forbidden-pattern',
          patterns: ['test', 'spec', 'mock'],
          severity: 'error',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['src/test.ts', 'src/spec.ts', 'src/mock.ts', 'src/ok.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.violations.length).toBe(3);
    });

    it('大小写不敏感匹配', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'no-test',
          type: 'forbidden-pattern',
          patterns: ['TEST'],
          severity: 'error',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['src/TestFile.ts', 'src/testfile.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.violations.length).toBe(2);
    });

    it('glob 模式 **/ 匹配任意前缀', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'no-test-anywhere',
          type: 'forbidden-pattern',
          patterns: ['test'],
          scope: '**/core/**',
          severity: 'error',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['packages/lib/core/test.ts', 'src/core/test.ts', 'src/test.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      // **/core/** 应该匹配 packages/lib/core/ 和 src/core/
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });

    it('空 patterns 不应该报错', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'empty-patterns',
          type: 'forbidden-pattern',
          patterns: [],
          severity: 'error',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['src/any.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.violations.length).toBe(0);
    });

    it('自定义 message 应该出现在 violation', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'custom-msg',
          type: 'forbidden-pattern',
          patterns: ['test'],
          message: '自定义错误消息',
          severity: 'error',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['src/test.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.violations[0].message).toBe('自定义错误消息');
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

    it('正好等于阈值应该通过', async () => {
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
        files: Array(10).fill('file.ts'),
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.violations.length).toBe(0);
    });

    it('默认阈值应该是 3', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'default-threshold',
          type: 'file-count',
          severity: 'warning',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: Array(5).fill('file.ts'),
        diff: '',
      };

      const result = await engine.check(context);

      // 默认阈值 3，5 个文件应该触发
      expect(result.violations.length).toBe(1);
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

  describe('unknown 规则类型', () => {
    it('应该忽略未知类型', async () => {
      const rules: ArchitectureRule[] = [
        {
          id: 'unknown-type',
          type: 'custom' as any,
          severity: 'error',
        },
      ];

      const engine = new ArchitectureConstraintEngine(rules);
      const context: ArchitectureContext = {
        files: ['any.ts'],
        diff: '',
      };

      const result = await engine.check(context);

      expect(result.violations.length).toBe(0);
    });
  });

  describe('PR context', () => {
    it('应该支持 PR 上下文', async () => {
      const engine = new ArchitectureConstraintEngine([]);
      const context: ArchitectureContext = {
        files: ['file.ts'],
        diff: 'diff content',
        pr: {
          number: 123,
          changedFiles: 5,
          additions: 100,
          deletions: 50,
        },
      };

      const result = await engine.check(context);

      expect(result).toBeDefined();
    });
  });

  describe('loadArchitectureRules', () => {
    it('应该加载 JSON 配置', async () => {
      const configPath = path.join(tempDir, 'rules.json');
      fs.writeFileSync(configPath, JSON.stringify({
        rules: [
          { id: 'rule1', type: 'file-count', threshold: 10 },
        ],
      }));

      const rules = await loadArchitectureRules(configPath);

      expect(rules.length).toBe(1);
      expect(rules[0].id).toBe('rule1');
    });

    it('应该加载 YAML 配置', async () => {
      const configPath = path.join(tempDir, 'rules.yml');
      fs.writeFileSync(configPath, `
rules:
  - id: yaml-rule
    type: forbidden-pattern
    patterns:
      - test
      - spec
    severity: error
    message: YAML 规则测试
`);

      const rules = await loadArchitectureRules(configPath);

      expect(rules.length).toBe(1);
      expect(rules[0].id).toBe('yaml-rule');
      expect(rules[0].patterns?.length).toBe(2);
    });

    it('YAML threshold 应该解析为数字', async () => {
      const configPath = path.join(tempDir, 'rules.yml');
      fs.writeFileSync(configPath, `
rules:
  - id: threshold-rule
    type: file-count
    threshold: 15
`);

      const rules = await loadArchitectureRules(configPath);

      expect(rules[0].threshold).toBe(15);
    });

    it('YAML severity 应该解析为字符串', async () => {
      const configPath = path.join(tempDir, 'rules.yml');
      fs.writeFileSync(configPath, `
rules:
  - id: severity-rule
    type: file-count
    severity: warning
`);

      const rules = await loadArchitectureRules(configPath);

      expect(rules[0].severity).toBe('warning');
    });

    it('空文件应该返回空数组', async () => {
      const configPath = path.join(tempDir, 'empty.yml');
      fs.writeFileSync(configPath, '');

      const rules = await loadArchitectureRules(configPath);

      expect(rules).toEqual([]);
    });

    it('无 rules 字段应该返回空数组', async () => {
      const configPath = path.join(tempDir, 'no-rules.yml');
      fs.writeFileSync(configPath, 'other: value');

      const rules = await loadArchitectureRules(configPath);

      expect(rules).toEqual([]);
    });
  });

  describe('runArchitectureCheck', () => {
    it('应该运行完整检查', async () => {
      const configPath = path.join(tempDir, 'rules.json');
      fs.writeFileSync(configPath, JSON.stringify({
        rules: [
          { id: 'rule1', type: 'file-count', threshold: 10 },
        ],
      }));

      const result = await runArchitectureCheck(configPath, {
        files: Array(5).fill('file.ts'),
        diff: '',
      });

      expect(result).toBeDefined();
      expect(result.passed).toBe(true);
    });
  });
});
