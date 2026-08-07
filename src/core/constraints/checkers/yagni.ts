/**
 * yagni_check：过度设计信号 — 只有一个实现的 interface/abstract class（工单 21）
 *
 * 主要由 promptInjection 驱动，这里是辅助检查。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConstraintCheck } from './types';

export const yagniCheck: ConstraintCheck = {
  id: 'yagni_check',
  async evaluate(env) {
    const projectPath = env.projectPath;
    const changedFiles = env.context.changedFiles;

    // 无上下文时默认通过（主要由 promptInjection 驱动）
    if (!projectPath || !changedFiles || changedFiles.length === 0) return true;

    try {
      for (const file of changedFiles) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;

        const filePath = path.join(projectPath, file);
        if (!fs.existsSync(filePath)) continue;

        const content = fs.readFileSync(filePath, 'utf-8');

        // 检查是否有 export interface/abstract class
        const hasInterface = /export\s+(?:default\s+)?interface\s+(\w+)/g;
        const hasAbstract = /export\s+(?:default\s+)?abstract\s+class\s+(\w+)/g;

        const interfaces = [...content.matchAll(hasInterface)].map(m => m[1]);
        const abstracts = [...content.matchAll(hasAbstract)].map(m => m[1]);

        const exportedTypes = [...interfaces, ...abstracts];

        for (const typeName of exportedTypes) {
          // 检查同一个 typeName 的 implements/extends 出现次数
          const implPattern = new RegExp(`(?:implements|extends)\\s+${typeName}\\b`, 'g');
          // 简化版：只在 changedFiles 中搜索
          let implCount = 0;
          for (const f of changedFiles) {
            if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
            const fp = path.join(projectPath, f);
            if (!fs.existsSync(fp)) continue;
            const fc = fs.readFileSync(fp, 'utf-8');
            const matches = fc.match(implPattern);
            if (matches) implCount += matches.length;
          }

          // 只有一个实现者 → YAGNI 违规
          if (implCount <= 1) {
            return false;
          }
        }
      }
    } catch {
      // 文件读取失败，默认通过
      return true;
    }

    return true;
  },
};
