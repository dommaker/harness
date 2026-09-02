/**
 * 测试产物解读——从 runner 的 stdout 读出「过了没 / 哪些失败 / 覆盖率」（ADR-0012）
 *
 * 纯函数，字符串进、值出，不做 IO、不跑进程。此前三个解析器分别 private 关在
 * core/validators/passes-gate.ts（extractCoverage / extractFailures）与
 * gates/acceptance.ts（parseTestOutput）体内：两处只有 jest 一个家族共同识别，用的信号
 * 还不同（`✕` 行 vs `Test Suites:` 汇总行），同一份输出能在一处看出失败、在另一处看不出。
 * 收口后「加一个 runner 家族 = 改一处」。
 *
 * 本模块是包内模块，不进 src/index.ts 导出面（对齐 ADR-0009 capabilities-reconcile /
 * ADR-0011 injection-writer 先例）。
 *
 * 已知不一致**保持原样**（迁移时正则、分支顺序、返回形状逐字未动），裁决在别处：
 * - 两门禁判定依据不一致（本函数只看文本、passes-gate 成功分支只看退出码）→ #93
 * - extractCoverage 无判定消费方，CLI --coverage 另走 json-summary → #94
 */

/**
 * 从输出中提取覆盖率
 */
export function extractCoverage(output: string): number | undefined {
  // Jest 格式: All files | 80.5 | 70.2 | ...
  const jestMatch = output.match(/All files[|\s]+(\d+\.?\d*)/);
  if (jestMatch?.[1]) {
    return parseFloat(jestMatch[1]);
  }

  // Istanbul/nyc 格式: Statements   : 80.5% ( 100/124 )
  const istanbulMatch = output.match(/Statements\s*:\s*(\d+\.?\d*)%/);
  if (istanbulMatch?.[1]) {
    return parseFloat(istanbulMatch[1]);
  }

  // pytest-cov 格式: TOTAL  1234  80%
  const pytestMatch = output.match(/TOTAL\s+\d+\s+(\d+)%/);
  if (pytestMatch?.[1]) {
    return parseInt(pytestMatch[1], 10);
  }

  return undefined;
}

/**
 * 从输出中提取失败信息
 */
export function extractFailures(output: string): string[] {
  const failures: string[] = [];

  // Jest 格式
  const jestMatches = output.matchAll(/✕\s+(.+?)\s+\(/g);
  for (const match of jestMatches) {
    if (match[1]) failures.push(match[1]);
  }

  // Mocha 格式
  const mochaMatches = output.matchAll(/\d+\)\s+(.+?):/g);
  for (const match of mochaMatches) {
    if (match[1]) failures.push(match[1]);
  }

  // pytest 格式
  const pytestMatches = output.matchAll(/FAILED\s+(.+?)::/g);
  for (const match of pytestMatches) {
    if (match[1]) failures.push(match[1]);
  }

  // Go test 格式
  const goMatches = output.matchAll(/--- FAIL:\s+(.+?)\s+\(/g);
  for (const match of goMatches) {
    if (match[1]) failures.push(match[1]);
  }

  return failures;
}

/**
 * 解析测试输出判断是否通过
 */
export function parseTestOutput(output: string): boolean {
  // Playwright 格式
  if (output.includes('passed')) {
    // 检查是否有失败
    const failedMatch = output.match(/(\d+)\s+failed/);
    if (failedMatch && parseInt(failedMatch[1]) > 0) {
      return false;
    }
    return true;
  }

  // Jest 格式
  if (output.includes('Test Suites:')) {
    const match = output.match(/Test Suites:\s+(\d+)\s+failed/);
    if (match && parseInt(match[1]) > 0) {
      return false;
    }
    return output.includes('passed');
  }

  // 通用格式
  return output.includes('PASS') && !output.includes('FAIL');
}
