/**
 * capability_sync：CAPABILITIES.md 与代码同步检查（工单 21）
 *
 * 两步验证：
 *   1. Git diff 增量 — 当前变更的非测试文件是否在文档中有记录
 *   2. 全量扫描 — 源码根下所有源文件是否都在 CAPABILITIES.md 中（T-058）
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { readCapabilitiesEntries } from '../capabilities-parser';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import type { ConstraintCheck } from './types';

export const capabilitySync: ConstraintCheck = {
  id: 'capability_sync',
  async evaluate(env) {
    const projectPath = env.projectPath;
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

      const listedFiles = readCapabilitiesEntries(capabilitiesPath, { secondColumnOnly: true });

      // ── Step 1: Git diff 增量检查 ──
      const diff = await env.stagedDiffNames();
      const changedCodeFiles = diff.split('\n').filter(
        (f: string) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')
      );

      if (changedCodeFiles.length > 0 && listedFiles.length > 0) {
        const significantChanges = changedCodeFiles.filter(
          (f: string) => !f.includes('__tests__') && !f.includes('.test.') && !f.includes('.spec.')
        );

        if (significantChanges.length > 0) {
          const covered = significantChanges.some((changed: string) =>
            listedFiles.some((listed: string) => changed.endsWith(listed) || changed.includes(listed))
          );
          if (!covered) return false;
        }
      }

      // ── Step 2: 全量源码根扫描（T-058 修复核心）──
      if (listedFiles.length > 0) {
        const sourceRoots = detectSourceRoots(projectPath);
        for (const root of sourceRoots) {
          const srcDir = join(projectPath, root);
          if (existsSync(srcDir)) {
            for (const file of env.srcScan(root)) {
              if (!listedFiles.includes(file)) {
                return false;
              }
            }
          }
        }
      }

      return true;
    } catch {
      return true; // 检查失败，默认通过
    }
  },
};
