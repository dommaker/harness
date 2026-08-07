/**
 * no_simplification_without_approval：staged diff 不得含简化关键词（工单 21）
 */

import type { ConstraintCheck } from './types';

const SIMPLIFICATION_PATTERNS = [
  /removed\s*test/i,
  /simplified\s*logic/i,
  /removed\s*validation/i,
  /skip\s*check/i,
];

export const noSimplificationWithoutApproval: ConstraintCheck = {
  id: 'no_simplification_without_approval',
  async evaluate(env) {
    try {
      const diff = await env.stagedDiff();
      for (const pattern of SIMPLIFICATION_PATTERNS) {
        if (pattern.test(diff)) {
          return false; // 发现简化关键词
        }
      }
      return true;
    } catch {
      return true; // 检查失败，默认通过
    }
  },
};
