/**
 * capability_sync：CAPABILITIES.md 与代码同步检查（工单 21）
 *
 * 两步验证：
 *   1. Git diff 增量 — 当前变更的非测试文件是否在文档中有记录
 *   2. 全量扫描 — 源码根下所有源文件是否都在 CAPABILITIES.md 中（T-058）
 *
 * 覆盖判定两步统一（isCoveredBy）：目录条目（以 / 结尾）前缀匹配，
 * 文件条目精确匹配或路径边界后缀匹配。module 模式下目录条目参与覆盖，
 * 未覆盖文件按源码根下第一级子目录聚合。
 *
 * 清单格式（计数行，mode=listing 或嗅探命中）无文件表可核对，直接放行；
 * 检查异常时 fail-open 但输出 console.warn 保留可观测性。
 *
 * ADR-0001 存在性探测：项目根无 CAPABILITIES.md（未采用该约定）时返回 'skip'，
 * 不计 pass/fail，避免在未采用约定的项目上全量误报。
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  aggregateToSourceSubdir,
  isCapabilityListingFormat,
  parseCapabilitiesEntries,
} from '../capabilities-parser';
import { getCapabilitiesMode } from '../../project-config-loader';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import type { ConstraintCheck } from './types';

/** markdown 表格分隔行（|------|------|）：区分「无表格的散文文档」与「有表格但零条目」 */
const TABLE_SEPARATOR_REGEX = /^\s*\|[\s:|-]+\|\s*$/m;

/**
 * 变更文件是否被条目覆盖
 *
 * 目录条目（以 / 结尾）前缀匹配；文件条目精确匹配或路径边界后缀匹配
 * （兼容 basename 条目，但拒绝 xfoo.ts 命中 foo.ts、docs/src/foo.tsx 命中 src/foo.ts
 * 这类 endsWith/includes 模糊匹配造成的碰撞）
 */
function isCoveredBy(entries: string[], changed: string): boolean {
  return entries.some((listed) =>
    listed.endsWith('/')
      ? changed.startsWith(listed)
      : changed === listed || changed.endsWith('/' + listed)
  );
}

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
      if (!existsSync(capabilitiesPath)) {
        // 检查是否有代码变更，无变更则跳过
        const diff = await env.stagedDiffNames();
        const changedCodeFiles = diff.split('\n').filter(
          (f: string) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')
        );
        return changedCodeFiles.length === 0;
      }

      const content = readFileSync(capabilitiesPath, 'utf-8');
      const capabilitiesMode = getCapabilitiesMode(projectPath);

      // 清单格式（计数行）没有文件表可核对，计数由 sync-docs 维护，直接放行
      if (capabilitiesMode === 'listing' || isCapabilityListingFormat(content)) {
        return true;
      }

      const listedFiles = parseCapabilitiesEntries(content, { secondColumnOnly: true });
      // module 模式下目录条目同样构成覆盖依据，与 step 2 判定对齐
      const entries =
        capabilitiesMode === 'module'
          ? parseCapabilitiesEntries(content, { includeDirs: true })
          : listedFiles;
      // 有表格但零条目 = 文档什么都没登记，不得直接放行；无表格的散文文档保持历史放行
      const hasTable = TABLE_SEPARATOR_REGEX.test(content);

      // ── Step 1: Git diff 增量检查 ──
      const diff = await env.stagedDiffNames();
      const changedCodeFiles = diff.split('\n').filter(
        (f: string) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')
      );
      const significantChanges = changedCodeFiles.filter(
        (f: string) => !f.includes('__tests__') && !f.includes('.test.') && !f.includes('.spec.')
      );

      // 每个变更文件都必须被覆盖（every；some 会让一个命中掩盖其余漏网）
      if (
        significantChanges.length > 0 &&
        (entries.length > 0 || hasTable) &&
        !significantChanges.every((changed: string) => isCoveredBy(entries, changed))
      ) {
        return false;
      }

      // ── Step 2: 全量源码根扫描（T-058 修复核心）──
      if (capabilitiesMode === 'module') {
        // module 模式：目录条目参与覆盖（isCoveredBy 统一判定）；
        // 未覆盖文件按源码根下第一级子目录聚合，任一组非空即失败
        if (entries.length > 0 || hasTable) {
          const uncoveredDirs = new Set<string>();
          const sourceRoots = detectSourceRoots(projectPath);
          for (const root of sourceRoots) {
            const srcDir = join(projectPath, root);
            if (existsSync(srcDir)) {
              for (const file of env.srcScan(root)) {
                if (!isCoveredBy(entries, file)) {
                  uncoveredDirs.add(aggregateToSourceSubdir(root, file));
                }
              }
            }
          }
          if (uncoveredDirs.size > 0) return false;
        }
      } else if (listedFiles.length > 0 || hasTable) {
        const sourceRoots = detectSourceRoots(projectPath);
        for (const root of sourceRoots) {
          const srcDir = join(projectPath, root);
          if (existsSync(srcDir)) {
            for (const file of env.srcScan(root)) {
              if (!isCoveredBy(listedFiles, file)) {
                return false;
              }
            }
          }
        }
      }

      return true;
    } catch (err) {
      // fail-open 语义保留，但必须可观测：静默吞错会让解析 bug 变成「永远通过」
      console.warn('[capability_sync] 检查执行异常，默认放行：', err);
      return true;
    }
  },
};
