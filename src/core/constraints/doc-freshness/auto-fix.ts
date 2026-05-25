/**
 * FreshnessAutoFix — 文档新鲜度自动修复
 *
 * 根据 FreshnessRunner 检查结果修复文档中的过期计数。
 * 只负责安全的 regex 替换，不处理结构性修复（如 doc_dir_check）。
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { DocRegexCountCheck } from '../../../types/project-config';
import type { FreshnessCheckResult } from './runner';

/**
 * 文档新鲜度自动修复器
 */
export class FreshnessAutoFix {
  /**
   * 根据检查结果修复文档
   * @returns 是否成功修复
   */
  fix(
    check: DocRegexCountCheck,
    result: FreshnessCheckResult,
    projectPath: string
  ): boolean {
    switch (check.type) {
      case 'doc_regex_count':
        return this.fixDocRegexCount(check, result, projectPath);
      default:
        // doc_dir_check / context_docs 的自动修复不在 MVP 范围内
        return false;
    }
  }

  /**
   * 修复 doc_regex_count：更新文档中的计数
   */
  private fixDocRegexCount(
    check: DocRegexCountCheck,
    result: FreshnessCheckResult,
    projectPath: string
  ): boolean {
    try {
      const docPath = join(projectPath, check.doc);
      if (!existsSync(docPath)) return false;

      const detail = result.detail;
      if (!detail || detail.actualCount === undefined) return false;

      const actualCount = detail.actualCount as number;

      const content = readFileSync(docPath, 'utf-8');
      const countRegex = new RegExp(check.pattern);

      if (!countRegex.test(content)) return false;

      // regex 替换：保留原捕获组结构，只替换 (\d+) 部分
      // 策略：匹配完整正则，然后用实际值替换第一个捕获组
      const updated = content.replace(countRegex, (match, ...groups) => {
        return match.replace(groups[0], String(actualCount));
      });

      writeFileSync(docPath, updated, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
}
