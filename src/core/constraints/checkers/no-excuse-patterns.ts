/**
 * no_excuse_patterns：完成声明不得包含借口模式（工单 21）
 */

import type { ConstraintCheck } from './types';

const EXCUSE_PATTERNS = [
  /稍后修复/,
  /小问题/,
  /不影响功能/,
  /以后再说/,
  /先这样/,
  /临时方案/,
  /暂时这样/,
];

export const noExcusePatterns: ConstraintCheck = {
  id: 'no_excuse_patterns',
  evaluate(env) {
    const text = env.context.completionClaimText || env.context.taskDescription || '';
    if (!text) return true;
    return !EXCUSE_PATTERNS.some(p => p.test(text));
  },
};
