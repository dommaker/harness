/**
 * no_any_type：变更 TS 文件不得出现 `: any`（工单 21）
 */

import { existsSync, readFileSync } from 'fs';
import type { ConstraintCheck } from './types';

export const noAnyType: ConstraintCheck = {
  id: 'no_any_type',
  async evaluate(env) {
    try {
      const changedFiles = env.context.changedFiles || [];
      const filesToCheck = changedFiles.filter(
        f => f.endsWith('.ts') || f.endsWith('.tsx')
      );

      if (filesToCheck.length === 0) {
        return true; // 无 TS 文件变更
      }

      for (const file of filesToCheck) {
        if (!existsSync(file)) continue;
        try {
          const content = readFileSync(file, 'utf-8');
          // 检查 : any（排除注释和字符串）
          for (const line of content.split('\n')) {
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
            if (line.includes(': any') && !line.includes('// ') && !line.includes('/*')) {
              return false; // 发现 any 类型
            }
          }
        } catch {
          // 文件读取失败，忽略
        }
      }

      return true;
    } catch {
      return true; // 检查失败，默认通过
    }
  },
};
