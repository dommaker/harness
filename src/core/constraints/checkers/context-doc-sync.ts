/**
 * context_doc_sync：关键目录必须有 CONTEXT.md（工单 21）
 *
 * ADR-0001 存在性探测：项目未配置 governance.context_files 约定
 * （未启用或无 required_dirs）时返回 'skip'，不计 pass/fail。
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { loadRawProjectConfig } from '../../project-config-loader';
import type { ConstraintCheck } from './types';

export const contextDocSync: ConstraintCheck = {
  id: 'context_doc_sync',
  async evaluate(env) {
    const projectPath = env.projectPath;
    try {
      const config = loadRawProjectConfig(projectPath) ?? {};
      const governance = config.governance as Record<string, unknown> | undefined;
      const contextFiles = governance?.context_files as Record<string, unknown> | undefined;

      if (!contextFiles?.enabled || !Array.isArray(contextFiles.required_dirs)) {
        return 'skip'; // 未配置 context_files 约定，跳过评估
      }

      const requiredDirs = contextFiles.required_dirs as string[];
      if (requiredDirs.length === 0) {
        return 'skip'; // 无目标目录，约定未生效
      }

      for (const dir of requiredDirs) {
        const contextPath = join(projectPath, dir, 'CONTEXT.md');
        if (!existsSync(contextPath)) {
          return false;
        }
      }

      return true;
    } catch {
      return 'skip'; // 配置不存在或解析失败 = 无法判定约定，跳过
    }
  },
};
