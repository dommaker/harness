/**
 * runTests 的计数解析（2026-09-30）
 *
 * 判负时若输出里读不到失败计数，`failedTests` 给 null 而不是写死 1。旧写法把「命令没跑成」
 * （进程被杀 / 输出溢出 / 无汇总行）显示成「1 个用例失败」，实发一次把人引去查并不存在的红用例。
 * 这里跑真子进程（快、无 I/O 依赖），钉住三态：读到数值 / 判负读不到 / 判过无失败。
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassesGate } from '../passes-gate';

describe('PassesGate.runTests 的失败计数', () => {
  // runTest 会把证据落到 workDir/.harness/evidence —— 用临时目录，不污染本仓（既有 runTests
  // 用例正因这层 I/O 被跳过，本组要钉的恰是 exec 之后的计数，绕不开真子进程）
  let workDir: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'passes-gate-counts-'));
    fs.mkdirSync(path.join(workDir, '.harness'), { recursive: true });
  });

  afterAll(() => { fs.rmSync(workDir, { recursive: true, force: true }); });

  const gate = (testCommand: string) => new PassesGate({ testCommand });

  it('输出里有失败计数 → 如实取数', async () => {
    const result = await gate(`sh -c 'echo "Tests: 3 passed, 1 failed, 4 total"; exit 1'`).runTests(workDir);

    expect(result.passed).toBe(false);
    expect(result.failedTests).toBe(1);
    expect(result.passedTests).toBe(3);
    expect(result.totalTests).toBe(4);
  });

  it('判负但输出无失败计数行 → failedTests 为 null，不编造成 1', async () => {
    const result = await gate(`sh -c 'echo some noise; exit 3'`).runTests(workDir);

    expect(result.passed).toBe(false);
    expect(result.failedTests).toBeNull();
    expect(result.totalTests).toBe(0);
  });

  it('判过且无失败字样 → failedTests 为 0（null 只留给「判负且读不到」）', async () => {
    const result = await gate(`sh -c 'echo all good; exit 0'`).runTests(workDir);

    expect(result.passed).toBe(true);
    expect(result.failedTests).toBe(0);
  });
});
