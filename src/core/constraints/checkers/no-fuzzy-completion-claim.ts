/**
 * no_fuzzy_completion_claim：完成声明不得包含模糊词（工单 21）
 */

import type { ConstraintCheck } from './types';

const FUZZY_PATTERNS = [
  /应该没问题/,
  /应该可以/,
  /大概/,
  /可能/,
  /好像/,
  /似乎/,
  /差不多/,
  /基本完成/,
  /大部分/,
  // audit-learned (2026-05-18): unverified completion claims
  /我记得删[过掉]了/,
  /之前说删了/,
  /已删除.*但/,
  /大部分实现/,
  /大部分完成/,
  /已修复.*但/,
];

export const noFuzzyCompletionClaim: ConstraintCheck = {
  id: 'no_fuzzy_completion_claim',
  evaluate(env) {
    const text = env.context.completionClaimText || '';
    if (!text) return true; // 没有文本时默认通过（由其他检查覆盖）
    return !FUZZY_PATTERNS.some(p => p.test(text));
  },
};
