/**
 * capability_sync：CAPABILITIES.md 与代码同步检查（工单 21）
 *
 * 两步验证：
 *   1. Git diff 增量 — 当前变更的非测试文件是否在文档中有记录
 *   2. 全量扫描 — 源码根下所有源文件是否都在 CAPABILITIES.md 中（T-058）
 *
 * 覆盖/漏登判定不在本文件实现，统一走 capabilities-reconcile（ADR-0009）：
 * 目录条目（以 / 结尾）前缀匹配，文件条目精确匹配或路径边界后缀匹配；
 * module 模式下目录条目参与覆盖，未覆盖文件按源码根下第一级子目录聚合。
 *
 * 清单格式（计数行，mode=listing 或嗅探命中）无文件表可核对，直接放行；
 * 「有表格但零条目」不得放行，无表格的散文文档保持历史放行；
 * 检查异常时 fail-open 但输出 console.warn 保留可观测性。
 *
 * ADR-0001 存在性探测：项目根无 CAPABILITIES.md（未采用该约定）时返回 'skip'，
 * 不计 pass/fail，避免在未采用约定的项目上全量误报。
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { isCapabilityListingFormat } from '../capabilities-parser';
import { getCapabilitiesMode } from '../../project-config-loader';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import { reconcileCapabilities, significantCodeChanges } from '../capabilities-reconcile';
import type { ConstraintCheck } from './types';

export const capabilitySync: ConstraintCheck = {
  id: 'capability_sync',
  async evaluate(env) {
    const projectPath = env.projectPath;
    // ADR-0001 存在性探测：项目未采用 CAPABILITIES.md 约定 → skip（不计 pass/fail）
    if (!existsSync(join(projectPath, 'CAPABILITIES.md'))) {
      return 'skip';
    }
    try {
      const capabilitiesPath = join(projectPath, 'CAPABILITIES.md');
      const content = readFileSync(capabilitiesPath, 'utf-8');
      const capabilitiesMode = getCapabilitiesMode(projectPath);

      // 清单格式（计数行）没有文件表可核对，计数由 sync-docs 维护，直接放行
      if (capabilitiesMode === 'listing' || isCapabilityListingFormat(content)) {
        return true;
      }

      const sourceRoots = detectSourceRoots(projectPath);
      const population: string[] = [];
      for (const root of sourceRoots) {
        if (existsSync(join(projectPath, root))) {
          population.push(...env.srcScan(root));
        }
      }

      const diffNames = (await env.stagedDiffNames()).split('\n').filter(Boolean);
      const verdict = reconcileCapabilities({
        content,
        populationFiles: population,
        changedFiles: significantCodeChanges(diffNames),
        sourceRoots,
      });

      // 零条目门槛：有表格但什么都没登记时不得直接放行
      const gateOpen = verdict.coverageEntries.length === 0 && !verdict.hasTable;
      if (gateOpen) return true;

      // ── Step 1: Git diff 增量检查（每个变更文件都必须被覆盖）──
      if (verdict.uncoveredChanges.length > 0) return false;

      // ── Step 2: 全量源码根扫描（T-058 修复核心）──
      if (capabilitiesMode === 'module') {
        if (verdict.uncoveredDirs.length > 0) return false;
      } else if (verdict.uncoveredFiles.length > 0) {
        return false;
      }

      return true;
    } catch (err) {
      // fail-open 语义保留，但必须可观测：静默吞错会让解析 bug 变成「永远通过」
      console.warn('[capability_sync] 检查执行异常，默认放行：', err);
      return true;
    }
  },
};
