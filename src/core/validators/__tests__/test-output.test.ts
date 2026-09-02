/**
 * test-output 表驱动旁测（架构评审候选1 / #80，ADR-0012）
 *
 * 三个 runner 输出解析器的唯一测试面：真实 stdout 样本进、判定值出。
 * 迁移前 extractCoverage / extractFailures / parseTestOutput 是 PassesGate 与
 * SpecAcceptanceGate 的 private 方法，分支覆盖率 0%——passes-gate.test.ts 里只剩
 * toBeInstanceOf 占位断言，acceptance.test.ts 要写 6 份近重复 exec mock 才碰得到分支。
 *
 * 断言钉的是**迁移前的既有行为**（ADR-0012 硬门槛：行为零变更）。标 ⚠ 的行是已知的
 * 粗糙判定，原样钉住不代表认可：分歧的裁决归 #93（两门禁判定依据不一致）/
 * #94（覆盖率取数归属），本票不改语义。
 */

import { describe, it, expect } from '@jest/globals';
import { extractCoverage, extractFailures, parseTestOutput } from '../test-output';

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

/** nyc / istanbul 文本摘要 */
const NYC_COV = `=============================== Coverage summary ===============================
Statements   : 80.5% ( 100/124 )
Branches     : 70.21% ( 33/47 )
Functions    : 83.33% ( 15/18 )
Lines        : 79.59% ( 98/124 )
================================================================================
`;

/** 注释声称的 pytest-cov 形状：TOTAL 后紧跟两个数（stmts、cover%） */
const PYTEST_COV_TWO_COL = `---------- coverage: platform linux, python 3.11.9-final-0 ----------
Name              Total     Cover
---------------------------------
src/app.py           34       94%
TOTAL              1234       80%
`;

/** pytest-cov 默认四列（Stmts / Miss / Cover / Missing）实测形状 */
const PYTEST_COV_DEFAULT = `---------- coverage: platform linux, python 3.11.9-final-0 ----------
Name                 Stmts   Miss  Cover   Missing
--------------------------------------------------
src/app.py              34      2    94%   12-13
--------------------------------------------------
TOTAL                  340     68    80%

2 passed in 0.41s
`;

const MOCHA_PLAIN = `  2 passing (11ms)
  1 failing
`;

/** 三处关键字都在位、但数值位置不是数字 */
const MALFORMED_COV = `All files       |    -    |    -    |    -    |    -    |
Statements   : n/a ( 0/0 )
TOTAL  abc  %
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
// extractCoverage
// ========================================

type CoverageCase = { name: string; output: string; expected: number | undefined };

const COVERAGE_CASES: CoverageCase[] = [
  { name: 'jest 文本表 → 80.5', output: JEST_COV, expected: 80.5 },
  { name: 'istanbul/nyc 摘要 → 80.5', output: NYC_COV, expected: 80.5 },
  { name: 'pytest-cov 两列形状 → 80（整数）', output: PYTEST_COV_TWO_COL, expected: 80 },
  { name: 'jest 与 nyc 同现 → jest 分支优先（分支顺序）', output: `${JEST_COV}\n${NYC_COV}`, expected: 80.5 },
  { name: '无匹配：mocha 纯输出 → undefined', output: MOCHA_PLAIN, expected: undefined },
  {
    name: '⚠ pytest-cov 默认四列表 → undefined（TOTAL 行中间多一个 Miss 列，正则只吃两段数字）',
    output: PYTEST_COV_DEFAULT,
    expected: undefined,
  },
  { name: '畸形：三处关键字在位但值非数字 → undefined', output: MALFORMED_COV, expected: undefined },
  { name: '无匹配：空字符串 → undefined', output: '', expected: undefined },
];

describe('extractCoverage', () => {
  for (const c of COVERAGE_CASES) {
    it(c.name, () => {
      expect(extractCoverage(c.output)).toBe(c.expected);
    });
  }
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
// parseTestOutput
// ========================================

type VerdictCase = { name: string; output: string; expected: boolean };

const VERDICT_CASES: VerdictCase[] = [
  { name: 'playwright 全过 → true', output: PW_PASS, expected: true },
  { name: 'playwright 有失败 → false', output: PW_FAIL, expected: false },
  { name: 'jest 全绿汇总（含 passed 字样 → 进 Playwright 分支）→ true', output: JEST_SUITES_PASS, expected: true },
  { name: 'jest Test Suites: N failed（含 passed 字样 → 进 Playwright 分支）→ false', output: JEST_SUITES_FAIL, expected: false },
  { name: 'jest 全失败（无 passed 字样 → 进 Jest 分支）→ false', output: JEST_ALL_FAILED, expected: false },
  { name: '通用 PASS 行 → true', output: GENERIC_PASS, expected: true },
  { name: '通用 PASS + FAIL 混合 → false', output: GENERIC_MIXED, expected: false },
  {
    name: '⚠ 全绿但测试名含 FAIL → 被反转成 false（子串兜底，#93）',
    output: GENERIC_FAIL_IN_TEST_NAME,
    expected: false,
  },
  {
    name: '⚠ jest 零失败但无 "passed" 字样 → false（能进 Jest 分支就说明该 includes 恒 false）',
    output: JEST_SUITES_NO_PASSED_WORD,
    expected: false,
  },
  { name: '⚠ 零测试也判过："0 passed" → true', output: '  0 passed (1.0s)\n', expected: true },
  { name: '⚠ 畸形："X passed X failed" 无数字前缀 → true（failed 计数正则落空）', output: '  X passed X failed\n', expected: true },
  { name: '无匹配：仅表格分隔线 → false', output: '----------|---------|\n', expected: false },
  { name: '无匹配：空字符串 → false', output: '', expected: false },
];

describe('parseTestOutput', () => {
  for (const c of VERDICT_CASES) {
    it(c.name, () => {
      expect(parseTestOutput(c.output)).toBe(c.expected);
    });
  }
});
