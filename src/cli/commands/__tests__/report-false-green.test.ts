/**
 * report 假绿回归（架构评审候选1）
 *
 * 历史 bug：report 经 executeWithCollect 调 checkConstraints，checker 在首个
 * 铁律违规即 throw，handler 的 catch 丢弃 error.result 并合成空结果 ——
 * 铁律违规被报成 violations: [] / passed = 全量（假绿）。
 * 修复后 report 直调 checker.collectConstraints（不抛、全量收集），违规如实上报。
 *
 * fixture：CAPABILITIES.md 登记幽灵文件 → docs_freshness（file_modification
 * 触发域内唯一铁律）必违规。
 */

import { describe, it, expect } from '@jest/globals';
import { report } from '../report';
import { captureIO } from '../../command-contract';
import { createProjectFixture } from '../../../test-setup/project-fixture';

// 与 three-state-consistency.test.ts 相同的表格正本形状
const GHOST_CAPABILITIES =
  '# Capabilities\n\n' +
  '| 模块 | 文件 | 说明 |\n' +
  '|------|------|------|\n' +
  '| 遗魂 | src/gone.ts | 已删 |\n';

function parseJsonReport(output: string) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  return JSON.parse(output.slice(start, end + 1));
}

describe('report 铁律违规如实上报（假绿回归）', () => {
  it('docs_freshness 违规 → failed ≥ 1、violations 点名、passed < total', async () => {
    const root = createProjectFixture({
      name: 'report-false-green',
      files: { 'CAPABILITIES.md': GHOST_CAPABILITIES },
    });
    const io = captureIO();

    await report({ format: 'json', projectPath: root }, io);

    const data = parseJsonReport(io.outText());
    expect(data.constraints.failed).toBeGreaterThanOrEqual(1);
    expect(data.constraints.violations.map((v: { id: string }) => v.id)).toContain('docs_freshness');
    expect(data.constraints.passed).toBeLessThan(data.constraints.total);
  });
});
