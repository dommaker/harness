/**
 * PassesGate 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PassesGate, createPassesGate, detectTestCommand } from '../core/validators/passes-gate';
import type { TaskTestResult } from '../types/passes-gate';
import { createProjectFixture } from '../test-setup/project-fixture';
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

  // 探测正本行为钉住（架构评审 A2：CLI/core 双版收口后的统一语义，
  // 此前 e2e 优先级、echo 排除、兜底均无测试钉住）
  describe('detectTestCommand 正本（统一探测顺序）', () => {
    const detectDir = join(process.cwd(), 'temp-test-detect-command');

    const writePkg = (dir: string, scripts: Record<string, string>) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'detect-case', scripts }));
    };

    afterAll(() => {
      try {
        rmSync(detectDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('test:ci 与 test 同存时优先 test:ci', async () => {
      const dir = join(detectDir, 'ci-over-test');
      writePkg(dir, { test: 'jest', 'test:ci': 'jest --ci' });

      expect(await detectTestCommand(dir)).toBe('npm run test:ci');
    });

    it('echo 占位脚本不算 test，同存 e2e 时落到 e2e', async () => {
      const dir = join(detectDir, 'echo-placeholder');
      writePkg(dir, { test: 'echo "Error: no test specified"', 'test:e2e': 'playwright test' });

      expect(await detectTestCommand(dir)).toBe('npm run test:e2e');
    });

    it('仅有 echo 占位且无其他标记时返回 undefined', async () => {
      const dir = join(detectDir, 'echo-only');
      writePkg(dir, { test: 'echo "Error: no test specified"' });

      expect(await detectTestCommand(dir)).toBeUndefined();
    });

    it('无 test/test:ci 时 test:e2e 命中，无 e2e 时 test:coverage 命中', async () => {
      const e2eDir = join(detectDir, 'e2e-only');
      writePkg(e2eDir, { 'test:e2e': 'vitest e2e', 'test:coverage': 'vitest --coverage' });
      expect(await detectTestCommand(e2eDir)).toBe('npm run test:e2e');

      const covDir = join(detectDir, 'coverage-only');
      writePkg(covDir, { 'test:coverage': 'vitest --coverage' });
      expect(await detectTestCommand(covDir)).toBe('npm run test:coverage');
    });

    it('Python 标记 pyproject.toml 或 pytest.ini 任一命中', async () => {
      const pyprojectDir = join(detectDir, 'py-pyproject');
      mkdirSync(pyprojectDir, { recursive: true });
      writeFileSync(join(pyprojectDir, 'pyproject.toml'), '[project]\nname = "x"\n');
      expect(await detectTestCommand(pyprojectDir)).toBe('pytest');

      const pytestIniDir = join(detectDir, 'py-pytest-ini');
      mkdirSync(pytestIniDir, { recursive: true });
      writeFileSync(join(pytestIniDir, 'pytest.ini'), '[pytest]\n');
      expect(await detectTestCommand(pytestIniDir)).toBe('pytest');
    });

    it('go.mod 命中 go test，无任何标记返回 undefined', async () => {
      const goDir = join(detectDir, 'go-mod');
      mkdirSync(goDir, { recursive: true });
      writeFileSync(join(goDir, 'go.mod'), 'module example.com/x\n');
      expect(await detectTestCommand(goDir)).toBe('go test ./...');

      const emptyDir = join(detectDir, 'empty');
      mkdirSync(emptyDir, { recursive: true });
      expect(await detectTestCommand(emptyDir)).toBeUndefined();
    });

    it('探测失败时 runTests 与 setPasses 双路径 fail-closed', async () => {
      const emptyDir = join(detectDir, 'fail-closed');
      mkdirSync(emptyDir, { recursive: true });

      const runResult = await gate.runTests(emptyDir);
      expect(runResult.passed).toBe(false);
      expect(runResult.message).toBe('未检测到测试命令');

      const setResult = await gate.setPasses('task-nocmd', true, emptyDir);
      expect(setResult.allowed).toBe(false);
      expect(setResult.testResult?.passed).toBe(false);
      expect(setResult.testResult?.output).toBe('未检测到测试命令');
    });
  });

  describe('checkTestFileChanges', () => {
    it('应该检测测试文件变更', async () => {
      // 无 git 变更时返回空数组
      const changes = await gate.checkTestFileChanges(tempDir);
      
      expect(Array.isArray(changes)).toBe(true);
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
    // 临时根走 createProjectFixture 正本（tmpdir，mkdtemp 劫持统一回收），不建在仓内
    const covDir = createProjectFixture({
      name: 'pg-no-coverage',
      files: {
        // 输出里放一份 jest 覆盖率表：删除前 extractCoverage 会从中抠出 80.5 填进结果字段
        'package.json': JSON.stringify({
          name: 'coverage-project',
          scripts: { test: 'echo "All files | 80.50 | 70.21 | 83.33 | 79.59 |"' },
        }),
      },
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