/**
 * context_doc_sync：关键目录必须有 CONTEXT.md（工单 21）
 *
 * ADR-0001 存在性探测 + context_files 三态统一口径（工单 84）：
 * 未配置 / enabled 但无目标（required_dirs 缺失或空）→ 一律 'skip'，
 * 不计 pass/fail，与 docs_freshness 同构；判定只走 resolveContextFiles
 * 访问器，不做 governance 手写钻取。
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { resolveContextFiles } from '../../project-config-loader';
import type { ConstraintCheck } from './types';

export const contextDocSync: ConstraintCheck = {
  id: 'context_doc_sync',
  async evaluate(env) {
    const projectPath = env.projectPath;
    const resolution = resolveContextFiles(projectPath);
    if (resolution.state !== 'enabled') {
      return 'skip'; // 未配置或约定已立但无目标，跳过评估
    }

    for (const dir of resolution.dirs) {
      const contextPath = join(projectPath, dir, 'CONTEXT.md');
      if (!existsSync(contextPath)) {
        return false;
      }
    }

    return true;
  },
};
