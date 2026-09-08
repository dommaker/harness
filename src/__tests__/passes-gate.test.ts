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

  describe('runTests', () => {
    // 执行根由调用方传入（#95）：tempDir 的 package.json 测试命令是 echo，不再跑真实套件
    it('应该返回测试结果', async () => {
      const result = await gate.runTests(tempDir);

      expect(result.passed).toBe(true);
      expect(result.passedTests).toBe(1);
      expect(result.duration).toBeGreaterThanOrEqual(0);
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

    it('探测失败时 runTests fail-closed', async () => {
      const emptyDir = join(detectDir, 'fail-closed');
      mkdirSync(emptyDir, { recursive: true });

      const runResult = await gate.runTests(emptyDir);
      expect(runResult.passed).toBe(false);
      expect(runResult.message).toBe('未检测到测试命令');
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

    it('runTests 结果不带 coverage 字段', async () => {
      const covGate = createPassesGate({ enabled: true, requireEvidence: false });

      const result = await covGate.runTests(covDir);

      expect(result.passed).toBe(true);
      expect(result).not.toHaveProperty('coverage');
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