/**
 * context_doc_sync：关键目录必须有 CONTEXT.md（工单 21）
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
        return true; // 未配置，跳过
      }

      const requiredDirs = contextFiles.required_dirs as string[];
      for (const dir of requiredDirs) {
        const contextPath = join(projectPath, dir, 'CONTEXT.md');
        if (!existsSync(contextPath)) {
          return false;
        }
      }

      return true;
    } catch {
      return true; // 配置不存在或解析失败，跳过
    }
  },
};
