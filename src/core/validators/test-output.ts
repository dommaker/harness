/**
 * 测试产物解读——从 runner 的 stdout 读出「过了没 / 哪些失败」（ADR-0012，判定口径 ADR-0014）
 *
 * 纯函数，字符串进、值出，不做 IO、不跑进程。此前解析器分别 private 关在
 * core/validators/passes-gate.ts（extractCoverage / extractFailures）与
 * gates/acceptance.ts（parseTestOutput）体内：两处只有 jest 一个家族共同识别，用的信号
 * 还不同（`✕` 行 vs `Test Suites:` 汇总行），同一份输出能在一处看出失败、在另一处看不出。
 *
 * 本模块是包内模块，不进 src/index.ts 导出面（对齐 ADR-0009 capabilities-reconcile /
 * ADR-0011 injection-writer 先例）。
 *
 * #93 裁决（ADR-0014）：判定依据统一为「退出码为主 + 文本交叉否决」，收在 judgeTestRun
 * 一处，两个门禁都只从它取结论——原 parseTestOutput（纯文本判定）删除。
 *
 * #94 裁决 B（ADR-0015）：本模块不读覆盖率。extractCoverage 与其唯一产出
 * （TaskTestResult.coverage）已删除——harness 核心判定不管覆盖率执法，判覆盖率的
 * 两处（`harness passes-gate --coverage`、performance 门禁）各自读 json-summary。
 *
 * extractFailures 的正则、分支顺序、返回形状逐字迁移自 ADR-0012；仍保持原样的已知粗糙处：
 * - 一次跑完收集所有失败（首个失败即定的编排）→ #93 范围外，另票
 *
 * PR #117 实发修正（2026-09-08）：四个 runner 正则由「可跨行」收紧为行首锚定/行内匹配。
 * 原 mocha 正则 /\d+\)\s+(.+?):/g 的 \s+ 跨行——绿色运行的 console 噪音里一行以
 * 数字+")"结尾（stack 帧 checker.ts:213:23)、init 日志 (v1.3.0)）、下一行含 ":"，
 * 就被误捕为失败用例，governance 门禁对全绿 npm test 输出误判 24 条失败（exit 0 遭
 * judgeTestRun 文本否决）。jest ✕ / pytest FAILED / go --- FAIL: 的 \s+ 同理收紧。
 */

/**
 * 从输出中提取失败信息
 */
export function extractFailures(output: string): string[] {
  const failures: string[] = [];

  // Jest 格式（✕ 与用例名同行；\s 不跨行，防把下一行日志/堆栈捕进来）
  const jestMatches = output.matchAll(/✕[ \t]+([^\n]+?)[ \t]+\(/g);
  for (const match of jestMatches) {
    if (match[1]) failures.push(match[1]);
  }

  // Mocha 格式（行首锚定：「N) 标题:」必须是一行的开头形状；
  // 旧写法不锚行首且 \s+ 跨行，绿输出的 console 噪音会被误判——见文件头 PR #117 段）
  const mochaMatches = output.matchAll(/^[ \t]*\d+\)[ \t]+([^\n]+?):/gm);
  for (const match of mochaMatches) {
    if (match[1]) failures.push(match[1]);
  }

  // pytest 格式
  const pytestMatches = output.matchAll(/FAILED[ \t]+([^\n]+?)::/g);
  for (const match of pytestMatches) {
    if (match[1]) failures.push(match[1]);
  }

  // Go test 格式
  const goMatches = output.matchAll(/--- FAIL:[ \t]+([^\n]+?)[ \t]+\(/g);
  for (const match of goMatches) {
    if (match[1]) failures.push(match[1]);
  }

  return failures;
}

/**
 * 判定结果：过了没，以及文本里读出的失败用例名
 */
export interface TestRunVerdict {
  passed: boolean;
  /** 用例级失败名（判负时的可定位线索；退出码非零时也照常带出） */
  failures: string[];
}

/**
 * 行首锚定的结构化失败信号（ADR-0014）
 *
 * 只认 runner 自己打的汇总/套件行，不认子串：旧 `output.includes('FAIL')` 兜底会被通过的
 * 用例名（`✓ FAIL 时应该重试`）或含 FAIL 的目录名反转成判负。
 * - 套件行 `FAIL src/a.test.ts`（pytest 的 `FAILED x::`、go 的 `--- FAIL:` 行首不是 FAIL，
 *   由 extractFailures 认）
 * - 计数汇总行：jest `Test Suites: 2 failed, ...` / `Tests: 2 failed, ...`，
 *   playwright / mocha / pytest 的 `  1 failed` / `  1 failing` / `2 failed, 5 passed in 0.88s`。
 *   计数为 0 是全过（`Test Suites: 0 failed, 2 total`），不构成信号
 */
const SUITE_FAILURE_LINE = /^FAIL\b.*$/m;
const SUMMARY_FAILURE_COUNTS: RegExp[] = [
  /^(?:Test Suites|Suites|Tests):\s+(\d+)\s+failed\b/m,
  /^\s*(\d+)\s+(?:failed|failing)\b/m,
];

function hasStructuredFailure(output: string): boolean {
  if (SUITE_FAILURE_LINE.test(output)) return true;

  return SUMMARY_FAILURE_COUNTS.some(pattern => {
    const match = pattern.exec(output);
    return match !== null && Number(match[1]) > 0;
  });
}

/**
 * 判一次测试跑动的结论：退出码为主 + 文本交叉否决（#93，ADR-0014）
 *
 * - 退出码非零 → 判负，文本救不回来
 * - 退出码为零但文本有结构化失败信号 → 判负（runner 退出码撒谎的兜底）
 * - 退出码为零且无失败信号 → 判过；「没跑出测试」不在此判定的否决范围内（另票）
 *
 * `allowPartialPass` 的落点是**文本否决**这一维（部分通过 = 允许个别用例失败但命令本身过了）；
 * 它不赦免非零退出码。
 */
export function judgeTestRun(input: {
  /** 测试命令的退出码（0 = runner 自己说过了） */
  exitCode: number;
  /** runner 的 stdout + stderr 合并文本 */
  output: string;
  /** 允许部分通过：文本失败信号不否决零退出码，缺省 false */
  allowPartialPass?: boolean;
}): TestRunVerdict {
  const failures = extractFailures(input.output);

  if (input.exitCode !== 0) {
    return { passed: false, failures };
  }
  if (input.allowPartialPass) {
    return { passed: true, failures };
  }

  const vetoed = failures.length > 0 || hasStructuredFailure(input.output);

  return { passed: !vetoed, failures };
}
