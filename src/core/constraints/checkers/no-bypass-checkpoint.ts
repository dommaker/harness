/**
 * no_bypass_checkpoint：检查变更文件内容是否有 skip/bypass 关键词（工单 21）
 */

import { existsSync, readFileSync } from 'fs';
import type { ConstraintCheck } from './types';

const BYPASS_PATTERNS = [
  /\.skip\(/,            // Jest/Vitest skip
  /\.bypass\s*=/,        // bypass flag
  /skip:\s*true/,        // skip option
  /bypass\s*checkpoint/, // explicit bypass
  /\/\/\s*skip/,         // comment skip
];

export const noBypassCheckpoint: ConstraintCheck = {
  id: 'no_bypass_checkpoint',
  async evaluate(env) {
    const changedFiles = env.context.changedFiles || [];
    if (changedFiles.length === 0) {
      return true; // 无变更文件，默认通过
    }

    for (const file of changedFiles) {
      if (!existsSync(file)) continue;
      try {
        const content = readFileSync(file, 'utf-8');
        for (const pattern of BYPASS_PATTERNS) {
          if (pattern.test(content)) {
            return false; // 发现 bypass 关键词
          }
        }
      } catch {
        // 文件读取失败，忽略
      }
    }

    return true;
  },
};
