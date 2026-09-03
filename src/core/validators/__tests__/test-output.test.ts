/**
 * test-output 表驱动旁测（架构评审候选1 / #80 → ADR-0012；判定口径 #93 → ADR-0014；
 * 覆盖率取数路删除 #94）
 *
 * runner 输出解读口的唯一测试面：真实 stdout 样本进、判定值出。
 * 迁移前 extractCoverage / extractFailures / parseTestOutput 是 PassesGate 与
 * SpecAcceptanceGate 的 private 方法，分支覆盖率 0%——passes-gate.test.ts 里只剩
 * toBeInstanceOf 占位断言，acceptance.test.ts 要写 6 份近重复 exec mock 才碰得到分支。
 *
 * extractFailures 的期望值钉的是**迁移前的既有行为**（ADR-0012 硬门槛：行为零变更），
 * 标 ⚠ 的行是已知的粗糙解析，原样钉住不代表认可。
 *
 * judgeTestRun 是 #93 裁决后的**判定唯一入口**（退出码为主 + 文本交叉否决），取代
 * 原 parseTestOutput（纯文本判定，可被测试名里的 FAIL 反转）；两门禁消费同一函数的
 * 一致性用例在 gates/__tests__/test-verdict-consistency.test.ts。
 *
 * extractCoverage 曾在此有 8 条表驱动用例，#94 裁决 B（harness 核心判定不管覆盖率）
 * 连同函数一起删除，只剩下面那条导出面守卫钉住「不再导出」。
 */

import { describe, it, expect } from '@jest/globals';
import { extractFailures, judgeTestRun } from '../test-output';

// ========================================
// 真实输出样本（各 runner 家族的原始 stdout）
// ========================================

/** jest --coverage：文本表 + 汇总行 */
const JEST_COV = `PASS src/app.test.ts
----------------|---------|----------|---------|---------|-------------------
File            | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------|---------|----------|---------|---------|-------------------
All files       |   80.50 |    70.21 |   83.33 |   79.59 |
 app.ts         |   80.50 |    70.21 |   83.33 |   79.59 | 12-13
----------------|---------|----------|---------|---------|-------------------
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
`;

const MOCHA_PLAIN = `  2 passing (11ms)
  1 failing
`;

/** jest verbose 失败清单 */
const JEST_FAILURES = `FAIL src/app.test.ts
  App
    ✕ renders title (23 ms)
    ✓ renders subtitle (5 ms)
    ✕ handles click (12 ms)

Test Suites: 1 failed, 1 total
Tests:       2 failed, 1 passed, 3 total
`;

/** jest 失败详情带堆栈行 */
const JEST_FAILURES_WITH_STACK = `FAIL src/app.test.ts
  App
    ✕ renders title (23 ms)

  ● App › renders title

    expect(received).toBe(expected)

      at Object.<anonymous> (src/app.test.ts:12:15)

Test Suites: 1 failed, 1 total
`;

/** mocha 单行形状：编号 + 套件 + 标题同行，末尾带冒号（正则认的形状） */
const MOCHA_ONE_LINE = `  1) Account "should open":
     AssertionError: expected false to be true

  2) Account "should close":
     Error: timeout of 2000ms exceeded
`;

/** mocha 10 spec reporter 实际形状：编号行与标题行分两行 */
const MOCHA_TWO_LINE = `  1) Account
       should open:
     AssertionError: expected false to be true

  2) Account
       should close:
     Error: timeout of 2000ms exceeded
`;

const MOCHA_TWO_LINE_WITH_STACK = `  1) Account
       should open:
     AssertionError: expected false to be true
      at Context.<anonymous> (test/account.test.js:14:16)
      at processImmediate (node:internal/timers:476:21)

  2) Account
       should close:
     Error: timeout of 2000ms exceeded
`;

const PYTEST_FAILURES = `FAILED tests/test_app.py::TestLogin::test_empty_password - AssertionError: 400 != 200
FAILED tests/test_app.py::test_logout - assert False
2 failed, 5 passed in 0.88s
`;

const GO_FAILURES = `=== RUN   TestLogin
--- FAIL: TestLogin (0.00s)
    app_test.go:24: expected 200, got 401
=== RUN   TestLogout
--- FAIL: TestLogout (0.01s)
FAIL
exit status 1
FAIL    example.com/app    0.014s
`;

const PW_PASS = `Running 3 tests using 1 worker

  ✓  1 example.spec.ts:5:5 › should have title (1.2s)
  ✓  2 example.spec.ts:8:5 › should navigate (0.6s)
  ✓  3 example.spec.ts:12:5 › should submit (0.3s)

  3 passed (2.1s)
`;

const PW_FAIL = `Running 3 tests using 1 worker

  ✓  1 example.spec.ts:5:5 › should have title (1.2s)
  ✘  2 example.spec.ts:10:5 › should fail (0.9s)
  ✓  3 example.spec.ts:12:5 › should submit (0.3s)


  1) example.spec.ts:10:5 › should fail ─────────────────────────────

    Error: expect(received).toBe(expected)

  1 failed
    example.spec.ts:10:5 › should fail
  2 passed (3.1s)
`;

const JEST_SUITES_PASS = `Test Suites: 5 passed, 5 total
Tests:       42 passed, 42 total
`;

const JEST_SUITES_FAIL = `Test Suites: 2 failed, 3 passed, 5 total
`;

/** 零套件通过时 jest 的汇总形状（只有 failed/total，无 "passed" 字样 → 走 Jest 分支） */
const JEST_ALL_FAILED = `Test Suites: 2 failed, 2 total
Tests:       3 failed, 3 total
`;

/** jest 汇总行零失败，但输出里没有 "passed" 字样（截断/过滤后的形状） */
const JEST_SUITES_NO_PASSED_WORD = `Test Suites: 0 failed, 2 total
`;

const GENERIC_PASS = `PASS src/a.test.js
PASS src/b.test.js
`;

const GENERIC_MIXED = `PASS src/a.test.js
FAIL src/b.test.js
`;

/** 全绿输出，但通过的测试标题里带大写 FAIL 字样 */
const GENERIC_FAIL_IN_TEST_NAME = `PASS src/a.test.js
  ✓ does not FAIL here (3 ms)
`;

// ========================================
// 模块导出面（harness#94 裁决 B：extractCoverage 已删除）
// ========================================

describe('test-output 导出面', () => {
  it('运行时只有 extractFailures 与 judgeTestRun，不含 extractCoverage', async () => {
    const mod = await import('../test-output');
    expect(Object.keys(mod).sort()).toEqual(['extractFailures', 'judgeTestRun']);
  });
});

// ========================================
// extractFailures
// ========================================

type FailuresCase = { name: string; output: string; expected: string[] };

const FAILURES_CASES: FailuresCase[] = [
  { name: 'jest ✕ 行 → 两个用例名', output: JEST_FAILURES, expected: ['renders title', 'handles click'] },
  {
    name: '⚠ jest 带堆栈行 → 未锚定行首的 mocha 正则跨行误捕 "Test Suites"',
    output: JEST_FAILURES_WITH_STACK,
    expected: ['renders title', 'Test Suites'],
  },
  {
    name: 'mocha 单行形状 → 套件 + 标题',
    output: MOCHA_ONE_LINE,
    expected: ['Account "should open"', 'Account "should close"'],
  },
  { name: '⚠ mocha 10 两行形状 → 识别不到任何失败', output: MOCHA_TWO_LINE, expected: [] },
  {
    name: '⚠ mocha 两行 + 堆栈 → 捕到的是堆栈帧而非测试名',
    output: MOCHA_TWO_LINE_WITH_STACK,
    expected: ['at processImmediate (node'],
  },
  {
    name: '⚠ pytest 节点 id 在首个 :: 前截断 → 同文件多条失败重复且丢测试名',
    output: PYTEST_FAILURES,
    expected: ['tests/test_app.py', 'tests/test_app.py'],
  },
  { name: 'go test --- FAIL: → 函数名', output: GO_FAILURES, expected: ['TestLogin', 'TestLogout'] },
  { name: '无匹配：全绿 jest 输出 → []', output: JEST_COV, expected: [] },
  { name: '无匹配：空字符串 → []', output: '', expected: [] },
];

describe('extractFailures', () => {
  for (const c of FAILURES_CASES) {
    it(c.name, () => {
      expect(extractFailures(c.output)).toEqual(c.expected);
    });
  }
});

// ========================================
// judgeTestRun — 判定唯一入口（ADR-0014 / #93）
// ========================================

type JudgeCase = {
  name: string;
  exitCode: number;
  output: string;
  allowPartialPass?: boolean;
  expected: boolean;
};

const JUDGE_CASES: JudgeCase[] = [
  // ── 退出码为主：文本不能把非零退出救成 pass ──
  { name: 'exit 1 + 全绿 jest 输出 → false（文本不赦免非零退出）', exitCode: 1, output: JEST_COV, expected: false },
  { name: 'exit 1 + 空输出 → false', exitCode: 1, output: '', expected: false },
  {
    name: 'exit 2 + allowPartialPass → false（部分通过不碰退出码这一维）',
    exitCode: 2,
    output: JEST_COV,
    allowPartialPass: true,
    expected: false,
  },
  // ── 后果1：exit 0 但输出印着失败 → 文本交叉否决 ──
  { name: 'exit 0 + jest ✕ 用例清单 → false', exitCode: 0, output: JEST_FAILURES, expected: false },
  { name: 'exit 0 + jest 带堆栈失败清单 → false', exitCode: 0, output: JEST_FAILURES_WITH_STACK, expected: false },
  {
    name: 'exit 0 + 只有 jest 汇总行（无 ✕ 行，非 verbose）→ false（统一用结构化汇总行）',
    exitCode: 0,
    output: JEST_ALL_FAILED,
    expected: false,
  },
  {
    name: 'exit 0 + jest 汇总行有 failed 也有 passed → false',
    exitCode: 0,
    output: JEST_SUITES_FAIL,
    expected: false,
  },
  { name: 'exit 0 + 套件级 FAIL 行 → false', exitCode: 0, output: GENERIC_MIXED, expected: false },
  { name: 'exit 0 + mocha 汇总行 1 failing → false', exitCode: 0, output: MOCHA_PLAIN, expected: false },
  { name: 'exit 0 + pytest FAILED 行 → false', exitCode: 0, output: PYTEST_FAILURES, expected: false },
  { name: 'exit 0 + go --- FAIL: 行 → false', exitCode: 0, output: GO_FAILURES, expected: false },
  { name: 'exit 0 + playwright 失败汇总 → false', exitCode: 0, output: PW_FAIL, expected: false },
  // ── 后果2：裸 includes(FAIL) 兜底弃用后不再误伤 ──
  {
    name: 'exit 0 + 全绿但通过的用例名里带大写 FAIL → true（旧兜底子串反转已修）',
    exitCode: 0,
    output: GENERIC_FAIL_IN_TEST_NAME,
    expected: true,
  },
  {
    name: 'exit 0 + 路径含大写 FAIL 目录名 → true（子串兜底已弃用）',
    exitCode: 0,
    output: 'PASS src/fixtures/FAIL/app.test.js\nTests:       3 passed, 3 total\n',
    expected: true,
  },
  // ── 全绿样本 ──
  { name: 'exit 0 + jest 全绿带覆盖率表 → true', exitCode: 0, output: JEST_COV, expected: true },
  { name: 'exit 0 + jest 全绿汇总行 → true', exitCode: 0, output: JEST_SUITES_PASS, expected: true },
  {
    name: 'exit 0 + jest 零失败但无 "passed" 字样 → true（旧判定要求该字样，误伤）',
    exitCode: 0,
    output: JEST_SUITES_NO_PASSED_WORD,
    expected: true,
  },
  { name: 'exit 0 + playwright 全过 → true', exitCode: 0, output: PW_PASS, expected: true },
  { name: 'exit 0 + 通用 PASS 行 → true', exitCode: 0, output: GENERIC_PASS, expected: true },
  // ── allowPartialPass 的新位置：只作用于文本否决这一维 ──
  {
    name: 'exit 0 + jest ✕ 清单 + allowPartialPass → true（部分通过 = 放弃文本否决）',
    exitCode: 0,
    output: JEST_FAILURES,
    allowPartialPass: true,
    expected: true,
  },
  // ── 退出码权威的边界：文本否决只管「看出失败」，不管「没跑出测试」 ──
  {
    name: '⚠ exit 0 + 空输出 → true（零测试识别不属本判定，另票）',
    exitCode: 0,
    output: '',
    expected: true,
  },
  {
    name: '⚠ exit 0 + 零测试汇总 "0 passed" → true（同上）',
    exitCode: 0,
    output: '  0 passed (1.0s)\n',
    expected: true,
  },
  {
    name: '⚠ exit 0 + 畸形 "X passed X failed"（计数位非数字）→ true（同上：无结构化失败信号）',
    exitCode: 0,
    output: '  X passed X failed\n',
    expected: true,
  },
  { name: 'exit 0 + 仅覆盖率表格分隔线 → true（无失败信号）', exitCode: 0, output: '----------|---------|\n', expected: true },
];

describe('judgeTestRun', () => {
  for (const c of JUDGE_CASES) {
    it(c.name, () => {
      expect(judgeTestRun({ exitCode: c.exitCode, output: c.output, allowPartialPass: c.allowPartialPass })).toEqual(
        expect.objectContaining({ passed: c.expected }),
      );
    });
  }

  it('allowPartialPass 缺省 = false（否决默认生效）', () => {
    expect(judgeTestRun({ exitCode: 0, output: JEST_FAILURES }).passed).toBe(false);
  });

  it('否决时 failures 带出用例名（判负有据）', () => {
    expect(judgeTestRun({ exitCode: 0, output: JEST_FAILURES }).failures).toEqual(['renders title', 'handles click']);
  });

  it('全绿时 failures 为空数组', () => {
    expect(judgeTestRun({ exitCode: 0, output: GENERIC_FAIL_IN_TEST_NAME }).failures).toEqual([]);
  });

  it('非零退出时仍带出文本里的失败名（供上层拼错误信息）', () => {
    expect(judgeTestRun({ exitCode: 1, output: GO_FAILURES }).failures).toEqual(['TestLogin', 'TestLogout']);
  });
});
