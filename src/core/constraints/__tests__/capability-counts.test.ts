/**
 * 能力清单计数注入测试（架构评审 2026-09-02 · 候选9 / harness#88）
 *
 * capabilities-parser 属 core，此前**值导入** cli/commands/definitions 与
 * gates/definitions 来数命令数——core 向上的运行时依赖。现在计数所需的定义
 * 由调用方（cli 侧）注入，core 只消费最小形状（命令条目集合 + 门禁的 cli 字段）。
 *
 * 断言口径：计数由注入源推导，与宿主仓真实定义表无关。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IRON_LAWS, GUIDELINES } from '../definitions';
import {
  checkCapabilityCounts,
  updateCapabilityCounts,
  type CapabilityDefinitionSource,
} from '../capabilities-parser';

/** 3 条非门禁命令 + 4 条门禁（其中 2 条带 cli 元数据）→ CLI Commands = 5 */
const SOURCE: CapabilityDefinitionSource = {
  commands: [{}, {}, {}],
  gates: [{}, { cli: {} }, { cli: {} }, {}],
};

describe('能力清单计数（注入定义源，harness#88）', () => {
  let projectDir: string;

  beforeAll(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-capability-counts-'));
  });

  afterAll(() => {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function writeCapabilities(content: string): string {
    const dir = fs.mkdtempSync(path.join(projectDir, 'case-'));
    fs.writeFileSync(path.join(dir, 'CAPABILITIES.md'), content, 'utf-8');
    return dir;
  }

  describe('updateCapabilityCounts', () => {
    it('CLI Commands 计数 = 注入命令数 + 带 cli 的门禁数', () => {
      const out = updateCapabilityCounts('## CLI Commands (999)\n', SOURCE);
      expect(out).toContain('CLI Commands (5)');
    });

    it('Quality Gates 计数 = 注入门禁总数（不看 cli 字段）', () => {
      const out = updateCapabilityCounts('## Quality Gates (999)\n', SOURCE);
      expect(out).toContain('Quality Gates (4)');
    });

    it('Iron Laws / Guidelines 计数仍来自 core 自身定义表（同层，不注入）', () => {
      const out = updateCapabilityCounts('Iron Laws (999)\nGuidelines (999)\n', SOURCE);
      expect(out).toContain(`Iron Laws (${Object.keys(IRON_LAWS).length})`);
      expect(out).toContain(`Guidelines (${Object.keys(GUIDELINES).length})`);
    });

    it('不触碰文档中不存在的计数行', () => {
      const out = updateCapabilityCounts('# Harness Capabilities\n\n无计数行\n', SOURCE);
      expect(out).toBe('# Harness Capabilities\n\n无计数行\n');
    });

    it('同一注入源下写回幂等', () => {
      const once = updateCapabilityCounts('CLI Commands (0)\nQuality Gates (0)\n', SOURCE);
      expect(updateCapabilityCounts(once, SOURCE)).toBe(once);
    });
  });

  describe('checkCapabilityCounts', () => {
    it('计数与注入源一致 → match', () => {
      const dir = writeCapabilities('## CLI Commands (5)\n## Quality Gates (4)\n');
      expect(checkCapabilityCounts(dir, SOURCE)).toEqual({ match: true, mismatches: [] });
    });

    it('计数漂移 → match=false 并报出注入源的 actual', () => {
      const dir = writeCapabilities('## CLI Commands (999)\n## Quality Gates (4)\n');
      const { match, mismatches } = checkCapabilityCounts(dir, SOURCE);
      expect(match).toBe(false);
      expect(mismatches.join('\n')).toContain('CLI Commands: 文档 999 → 实际 5');
    });

    it('CAPABILITIES.md 不存在 → 跳过（无 mismatch）', () => {
      const dir = fs.mkdtempSync(path.join(projectDir, 'empty-'));
      expect(checkCapabilityCounts(dir, SOURCE)).toEqual({ match: true, mismatches: [] });
    });
  });
});
