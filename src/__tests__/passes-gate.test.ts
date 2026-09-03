/**
 * PassesGate 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PassesGate, createPassesGate } from '../core/validators/passes-gate';
import type { TaskTestResult } from '../types/passes-gate';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

describe('PassesGate', () => {
  const tempDir = join(process.cwd(), 'temp-test-passes-gate');
  let gate: PassesGate;

  beforeAll(() => {
    mkdirSync(tempDir, { recursive: true });
    
    // 创建简单的 package.json
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: { test: 'echo "1 passed"' },
    }));
    
    gate = createPassesGate({ enabled: true });
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('setPasses', () => {
    it('设置为 false 应该直接允许', async () => {
      const result = await gate.setPasses('task-1', false, tempDir);
      
      expect(result.allowed).toBe(true);
      expect(result.testResult?.passed).toBe(false);
    });

    it('设置为 true 应该运行测试', async () => {
      const result = await gate.setPasses('task-2', true, tempDir, {
        id: 'task-2',
      });
      
      // 测试命令是 echo "1 passed"，所以应该通过
      expect(result.allowed).toBe(true);
      expect(result.testResult?.command).toContain('npm test');
    });

    it('禁用时应该允许所有设置', async () => {
      const disabledGate = createPassesGate({ enabled: false });
      
      const result = await disabledGate.setPasses('task-3', true, tempDir);
      
      expect(result.allowed).toBe(true);
      expect(result.attempts).toBe(0);
    });
  });

  describe('runTests', () => {
    // 执行根由调用方传入（#95）：tempDir 的 package.json 测试命令是 echo，不再跑真实套件
    it('应该返回测试结果', async () => {
      const result = await gate.runTests(tempDir);

      expect(result.passed).toBe(true);
      expect(result.passedTests).toBe(1);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('detectTestCommand', () => {
    it('应该检测 npm test', async () => {
      // package.json 有 test script
      const result = await gate.setPasses('task-4', true, tempDir);
      
      expect(result.testResult?.command).toContain('npm');
    });
  });

  describe('checkTestFileChanges', () => {
    it('应该检测测试文件变更', async () => {
      // 无 git 变更时返回空数组
      const changes = await gate.checkTestFileChanges(tempDir);
      
      expect(Array.isArray(changes)).toBe(true);
    });
  });

  describe('扩展点支持', () => {
    it('应该能注册扩展', () => {
      gate.registerExtension('custom', {
        name: 'custom',
        run: async () => ({
          passed: true,
          command: 'custom-test',
          timestamp: new Date(),
        }),
      });
      
      const names = gate.getExtensionNames();
      expect(names).toContain('custom');
    });

    it('runAllTests 应该运行所有测试包括扩展', async () => {
      gate.registerExtension('puppeteer', {
        name: 'puppeteer',
        run: async () => ({
          passed: true,
          command: 'puppeteer-test',
          timestamp: new Date(),
        }),
      });
      
      const results = await gate.runAllTests(tempDir);
      
      expect(results.length).toBeGreaterThan(1);  // 单元测试 + puppeteer
      expect(results.some(r => r.type === 'puppeteer')).toBe(true);
    });

    it('checkAllPasses 应该返回综合结果', async () => {
      gate.registerExtension('passing-ext', {
        name: 'passing-ext',
        run: async () => ({
          passed: true,
          command: 'passing-test',
          timestamp: new Date(),
        }),
      });
      
      const result = await gate.checkAllPasses(tempDir);
      
      expect(result.passed).toBeDefined();
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.failedTypes)).toBe(true);
    });

    it('checkAllPasses 应该返回失败类型', async () => {
      const failingGate = createPassesGate({ enabled: true });
      failingGate.registerExtension('failing-ext', {
        name: 'failing-ext',
        run: async () => ({
          passed: false,
          command: 'failing-test',
          timestamp: new Date(),
        }),
      });
      
      const result = await failingGate.checkAllPasses(tempDir);
      
      expect(result.failedTypes).toContain('failing-ext');
    });

    it('扩展抛错应返回失败结果', async () => {
      const errorGate = createPassesGate({ enabled: true });
      errorGate.registerExtension('error-ext', {
        name: 'error-ext',
        run: async () => {
          throw new Error('Extension error');
        },
      });
      
      const results = await errorGate.runAllTests(tempDir);
      
      const errorResult = results.find(r => r.type === 'error-ext');
      expect(errorResult?.passed).toBe(false);
      expect(errorResult?.error).toContain('Extension error');
    });
  });

  describe('getTestResult', () => {
    it('应该返回已存储的测试结果', async () => {
      const result = await gate.setPasses('stored-task', true, tempDir);
      
      if (result.allowed && result.testResult) {
        const stored = gate.getTestResult('stored-task');
        expect(stored).toBeDefined();
        expect(stored?.command).toContain('npm');
      }
    });

    it('未存储任务应返回 undefined', () => {
      const stored = gate.getTestResult('nonexistent-task');
      expect(stored).toBeUndefined();
    });
  });

  describe('测试失败重试', () => {
    it('测试失败后应重试', async () => {
      const retryDir = join(process.cwd(), 'temp-test-retry');
      mkdirSync(retryDir, { recursive: true });
      
      writeFileSync(join(retryDir, 'package.json'), JSON.stringify({
        name: 'retry-project',
        scripts: { test: 'exit 1' },  // 总是失败
      }));
      
      const retryGate = createPassesGate({
        enabled: true,
        maxRetries: 1,
        retryDelay: 100,
      });
      
      const result = await retryGate.setPasses('retry-task', true, retryDir);
      
      expect(result.allowed).toBe(false);
      expect(result.attempts).toBeGreaterThan(1);
      expect(result.error).toBeDefined();
      
      rmSync(retryDir, { recursive: true, force: true });
    });
  });

  /**
   * #94 裁决 B：harness 核心判定不管覆盖率 —— 从 stdout 抠覆盖率的 regex 路
   * （extractCoverage → TaskTestResult.coverage）整体删除，结果面不再有 coverage 字段。
   */
  describe('覆盖率取数路删除（harness#94）', () => {
    const covDir = join(process.cwd(), 'temp-test-no-coverage-field');

    beforeAll(() => {
      mkdirSync(covDir, { recursive: true });

      // 输出里放一份 jest 覆盖率表：删除前 extractCoverage 会从中抠出 80.5 填进结果字段
      writeFileSync(join(covDir, 'package.json'), JSON.stringify({
        name: 'coverage-project',
        scripts: { test: 'echo "All files | 80.50 | 70.21 | 83.33 | 79.59 |"' },
      }));
    });

    afterAll(() => {
      try {
        rmSync(covDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('setPasses 结果不带 coverage 字段', async () => {
      const covGate = createPassesGate({ enabled: true, requireEvidence: false });

      const result = await covGate.setPasses('cov-task', true, covDir);

      expect(result.testResult?.passed).toBe(true);
      expect(result.testResult).not.toHaveProperty('coverage');
    });

    it('TaskTestResult 公开类型面不再接受 coverage 字段', () => {
      const testResult: TaskTestResult = {
        passed: true,
        command: 'npm test',
        // @ts-expect-error coverage 随 harness#94 删除，类型面不接受该字段
        coverage: 85,
      };

      expect(testResult.passed).toBe(true);
    });
  });
});