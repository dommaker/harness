/**
 * gates/coverage — readCoverageSummaryPct 取数正本测试（重构班次 3 Phase 3）
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCoverageSummaryPct } from '../coverage';

function fixtureWithSummary(content: string | undefined): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-coverage-'));
  if (content !== undefined) {
    fs.mkdirSync(path.join(root, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(root, 'coverage', 'coverage-summary.json'), content);
  }
  return root;
}

describe('readCoverageSummaryPct', () => {
  it('合法报告 → total.lines.pct 数值', async () => {
    const root = fixtureWithSummary(JSON.stringify({ total: { lines: { pct: 82.5 } } }));
    await expect(readCoverageSummaryPct(root)).resolves.toBe(82.5);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('报告缺失 → 抛 ENOENT（处置归调用方）', async () => {
    const root = fixtureWithSummary(undefined);
    await expect(readCoverageSummaryPct(root)).rejects.toMatchObject({ code: 'ENOENT' });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('JSON 损坏 → 抛出（fail-loud，不兜 0%）', async () => {
    const root = fixtureWithSummary('{ broken');
    await expect(readCoverageSummaryPct(root)).rejects.toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('字段缺失（total.lines.pct 非数值）→ 抛出并点名缺口（原 || 0 伪装消除）', async () => {
    for (const bad of ['{}', '{"total":{}}', '{"total":{"lines":{"pct":"82"}}}']) {
      const root = fixtureWithSummary(bad);
      await expect(readCoverageSummaryPct(root)).rejects.toThrow(/缺少 total\.lines\.pct/);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
