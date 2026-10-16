/**
 * 覆盖率取数正本（重构班次 3 Phase 3）
 *
 * json-summary 报告读取 + 校验的唯一实现（原 `gates/performance` 与
 * `cli/commands/passes-gate` 各一份）。「损坏 ≠ 缺失」：读失败 / JSON 损坏 /
 * 缺 `total.lines.pct` 数值一律抛出（fail-loud），不兜成 0%——0% 是「查过了」
 * 的结论，不是「没查到」的占位（原 cli 侧 `|| 0` 伪装随本正本消除）。
 * 失败如何处置（fail / warning 降级）归调用方口径。
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 读 `coverage/coverage-summary.json` 的 lines.pct；报告缺失/损坏/字段缺失抛出
 */
export async function readCoverageSummaryPct(projectPath: string): Promise<number> {
  const coveragePath = path.join(projectPath, 'coverage', 'coverage-summary.json');
  const content = await fs.readFile(coveragePath, 'utf-8');
  const summary: unknown = JSON.parse(content);
  const total = typeof summary === 'object' && summary !== null
    ? (summary as { total?: { lines?: { pct?: unknown } } }).total
    : undefined;
  const pct = total?.lines?.pct;
  if (typeof pct !== 'number') {
    throw new Error(`覆盖率报告缺少 total.lines.pct 数值字段: ${coveragePath}`);
  }
  return pct;
}
