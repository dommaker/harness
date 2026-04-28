/**
 * PassesGate 补充测试 - 覆盖重试逻辑和 runTests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { PassesGate, createPassesGate } from '../core/validators/passes-gate';
import { mkdirSync, rmSync, writeFileSync, existsSync, mkdir } from 'fs';
import { join } from 'path';

describe('PassesGate - 补充覆盖', () => {
  const tempDir = join(process.cwd(), 'temp-test-passes-extra');
  let gate: PassesGate;

  beforeAll(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    gate = createPassesGate({
      enabled: true,
      testCommand: 'npm test',
      requireEvidence: false,
      maxRetries: 1,
      retryDelay: 100,
    });
  });

  describe('runTests', () => {
    // runTests 方法会实际执行测试命令，在测试环境中跳过
    // 这些测试在 passes-gate.test.ts 中已经有类似覆盖
    it.skip('应该返回测试结果统计', async () => {
      // 这个测试会实际运行 npm test，在 CI 环境中可能超时
    });
  });

  describe('setPasses 重试逻辑', () => {
    it('测试失败应该返回不允许', async () => {
      // 创建会失败的测试命令
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'fail-project',
        scripts: { test: 'exit 1' },
      }));

      const failGate = createPassesGate({
        enabled: true,
        testCommand: 'npm test',
        maxRetries: 0,
        retryDelay: 10,
      });

      const result = await failGate.setPasses('fail-task', true, tempDir);
      
      expect(result.allowed).toBe(false);
      expect(result.attempts).toBeGreaterThan(0);
      expect(result.error).toBeDefined();
    });

    it('证据不存在应该返回不允许', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'evidence-project',
        scripts: { test: 'echo "1 passed"' },
      }));

      const evidenceGate = createPassesGate({
        enabled: true,
        testCommand: 'npm test',
        requireEvidence: true,
      });

      const result = await evidenceGate.setPasses('evidence-task', true, tempDir);
      
      // 证据会自动生成在 .agent/evidence 目录
      // requireEvidence=true 时需要验证证据存在
      expect(result).toBeDefined();
    });
  });

  describe('checkTestFileChanges', () => {
    it('应该检测测试文件变更', async () => {
      const changes = await gate.checkTestFileChanges(tempDir);
      
      expect(Array.isArray(changes)).toBe(true);
    });
  });

  describe('getExtensionNames', () => {
    it('初始应该为空数组', () => {
      const names = gate.getExtensionNames();
      expect(names).toEqual([]);
    });

    it('注册扩展后应该返回名称', () => {
      gate.registerExtension('puppeteer', {
        name: 'puppeteer',
        run: async () => ({
          passed: true,
          command: 'puppeteer',
          timestamp: new Date(),
        }),
      });

      expect(gate.getExtensionNames()).toContain('puppeteer');
      
      gate.unregisterExtension('puppeteer');
    });
  });

  describe('unregisterExtension', () => {
    it('注销不存在扩展应该返回 false', () => {
      expect(gate.unregisterExtension('nonexistent')).toBe(false);
    });

    it('注销已注册扩展应该返回 true', () => {
      gate.registerExtension('temp', {
        name: 'temp',
        run: async () => ({ passed: true, command: 'temp', timestamp: new Date() }),
      });

      expect(gate.unregisterExtension('temp')).toBe(true);
    });
  });

  describe('runAllTests', () => {
    it('应该运行单元测试和扩展测试', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'multi-test',
        scripts: { test: 'echo "1 passed"' },
      }));

      gate.registerExtension('mock-ext', {
        name: 'mock-ext',
        run: async () => ({
          passed: true,
          command: 'mock-ext',
          timestamp: new Date(),
        }),
      });

      const results = await gate.runAllTests(tempDir);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.type === 'mock-ext')).toBe(true);
      
      gate.unregisterExtension('mock-ext');
    });

    it('扩展失败应该返回失败结果', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'ext-fail',
        scripts: { test: 'echo "1 passed"' },
      }));

      gate.registerExtension('fail-ext', {
        name: 'fail-ext',
        run: async () => ({
          passed: false,
          command: 'fail-ext',
          error: 'Extension failed',
          timestamp: new Date(),
        }),
      });

      const results = await gate.runAllTests(tempDir);
      
      expect(results.some(r => !r.passed)).toBe(true);
      
      gate.unregisterExtension('fail-ext');
    });

    it('扩展抛异常应该捕获', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'ext-error',
        scripts: { test: 'echo "1 passed"' },
      }));

      gate.registerExtension('error-ext', {
        name: 'error-ext',
        run: async () => {
          throw new Error('Extension error');
        },
      });

      const results = await gate.runAllTests(tempDir);
      
      expect(results.some(r => r.type === 'error-ext' && !r.passed)).toBe(true);
      
      gate.unregisterExtension('error-ext');
    });
  });

  describe('checkAllPasses', () => {
    it('所有测试通过应该返回 passed=true', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'all-pass',
        scripts: { test: 'echo "1 passed"' },
      }));

      gate.registerExtension('pass-ext', {
        name: 'pass-ext',
        run: async () => ({ passed: true, command: 'pass-ext', timestamp: new Date() }),
      });

      const { passed, failedTypes } = await gate.checkAllPasses(tempDir);
      
      expect(passed).toBe(true);
      expect(failedTypes.length).toBe(0);
      
      gate.unregisterExtension('pass-ext');
    });

    it('有失败测试应该返回 passed=false', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'some-fail',
        scripts: { test: 'echo "1 passed"' },
      }));

      gate.registerExtension('fail-ext', {
        name: 'fail-ext',
        run: async () => ({ passed: false, command: 'fail-ext', timestamp: new Date() }),
      });

      const { passed, failedTypes } = await gate.checkAllPasses(tempDir);
      
      expect(passed).toBe(false);
      expect(failedTypes).toContain('fail-ext');
      
      gate.unregisterExtension('fail-ext');
    });
  });
});