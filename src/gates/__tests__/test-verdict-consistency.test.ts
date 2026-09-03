/**
 * 两门禁判「过没过」的一致性（#93，ADR-0014）
 *
 * PassesGate 的 runTest 与 SpecAcceptanceGate 的 e2e 分支过去判定依据不同：前者成功分支
 * 只看退出码（exit 0 即过，输出里的 ✕ 清单不参与），后者只看 stdout 文本（裸 includes('FAIL')
 * 兜底能被测试名字反转）。同一份 runner 输出可以一处判过、另一处判不过。
 *
 * 裁决后两者从同一判定入口出结果，本文件从两个门禁的**公开面**（PassesGate.runTests() /
 * SpecAcceptanceGate.check()）喂同一份样本 + 同一个退出码，断言结论一致且等于裁决值。
 * 判定矩阵本身（各 runner 家族、畸形输入、allowPartialPass）见
 * core/validators/__tests__/test-output.test.ts。
 *
 * 落点在 gates/ 不选 core/：单向分层禁止 src/core/** 值导入 gates/（#88，ADR-0012 落点理由同源）。
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { PassesGate } from '../../core/validators/passes-gate';
import { SpecAcceptanceGate } from '../acceptance';

jest.mock('child_process', () => ({ exec: jest.fn() }));
jest.mock('fs/promises');

const mockExec = exec as unknown as jest.Mock;
const mockFs = fs as unknown as jest.Mocked<typeof fs>;

// ========================================
// runner 输出样本
// ========================================

/** jest verbose 失败清单：✕ 用例名 + 结构化汇总行，全在 stdout 里 */
const JEST_FAILED_CASES = `FAIL src/app.test.ts
  App
    ✕ renders title (23 ms)
    ✓ renders subtitle (5 ms)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 passed, 2 total
`;

/** jest 非 verbose：没有 ✕ 行，只有汇总行说失败了 */
const JEST_SUMMARY_ONLY_FAILURE = `Test Suites: 2 failed, 2 total
Tests:       3 failed, 3 total
`;

/**
 * 全绿输出，但通过的用例名里带大写 FAIL 字样。
 * 不带汇总行 / 无 "passed" 字样 —— 这正是旧 acceptance 落到裸 includes('FAIL') 兜底那一支的形状。
 */
const JEST_GREEN_WITH_FAIL_IN_NAME = `PASS src/a.test.js
  App
    ✓ FAIL 时应该重试 (3 ms)
`;

/** jest 全绿 */
const JEST_GREEN = `PASS src/a.test.js
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
`;

type Sample = { name: string; exitCode: number; output: string; expected: boolean };

const SAMPLES: Sample[] = [
  { name: 'exit 0 + jest ✕ 失败清单', exitCode: 0, output: JEST_FAILED_CASES, expected: false },
  { name: 'exit 0 + jest 汇总行只有 failed', exitCode: 0, output: JEST_SUMMARY_ONLY_FAILURE, expected: false },
  { name: 'exit 0 + 全绿但用例名含 FAIL', exitCode: 0, output: JEST_GREEN_WITH_FAIL_IN_NAME, expected: true },
  { name: 'exit 0 + jest 全绿', exitCode: 0, output: JEST_GREEN, expected: true },
  { name: 'exit 1 + 全绿文本（文本不赦免非零退出）', exitCode: 1, output: JEST_GREEN, expected: false },
];

// ========================================
// 两个门禁的公开面
// ========================================

/** 退出结果：数字 = 退出码；'killed' = 超时/信号杀掉，reject 的 error 上没有数字退出码 */
type ExitResult = number | 'killed';
type VerdictSample = { exitCode: ExitResult; output: string };

/** 同一份样本 + 同一退出结果喂给 exec mock：0 → resolve，其余 → reject */
function stubRunner(exitCode: ExitResult, stdout: string): void {
  mockExec.mockImplementationOnce((...args: unknown[]) => {
    const callback = args[2] as (err: unknown, res?: unknown) => void;
    if (exitCode === 0) {
      callback(null, { stdout, stderr: '' });
      return;
    }
    const error = Object.assign(
      new Error(exitCode === 'killed' ? 'test timed out after 120000ms' : 'Command failed: npm test'),
      { stdout, stderr: '', ...(exitCode === 'killed' ? {} : { code: exitCode }) },
    );
    callback(error);
  });
}

async function verdictFromPassesGate(sample: VerdictSample): Promise<boolean> {
  stubRunner(sample.exitCode, sample.output);
  const gate = new PassesGate({ testCommand: 'npm test', requireEvidence: false });
  return (await gate.runTests()).passed;
}

async function verdictFromAcceptance(sample: VerdictSample): Promise<boolean> {
  mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: 验收条件
        e2e_test: tests/example.spec.ts
`);
  stubRunner(sample.exitCode, sample.output);
  const gate = new SpecAcceptanceGate();
  const result = await gate.check({ projectPath: '/test/project', taskId: 'TASK-001' });
  return result.passed;
}

describe('两门禁对同一份 runner 输出给出同一结论', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  for (const sample of SAMPLES) {
    it(`${sample.name} → 同判「${sample.expected ? '过' : '不过'}」`, async () => {
      const fromPassesGate = await verdictFromPassesGate(sample);
      const fromAcceptance = await verdictFromAcceptance(sample);

      expect({ fromPassesGate, fromAcceptance }).toEqual({
        fromPassesGate: sample.expected,
        fromAcceptance: sample.expected,
      });
      expect(fromAcceptance).toBe(fromPassesGate);
    });
  }

  it('runner 被超时杀掉（无数字退出码）→ 同判「不过」', async () => {
    const sample: VerdictSample = { exitCode: 'killed', output: JEST_GREEN };

    expect(await verdictFromPassesGate(sample)).toBe(false);
    expect(await verdictFromAcceptance(sample)).toBe(false);
  });
});
