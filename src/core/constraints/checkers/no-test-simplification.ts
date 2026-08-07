/**
 * no_test_simplification：检查 staged diff 是否删除了测试（工单 21）
 */

import type { ConstraintCheck } from './types';

const DELETED_TEST_PATTERNS = [
  /^-\s*(test|it|describe)\s*\(/, // 删除 test/it/describe
  /^-\s*expect\s*\(/,              // 删除 expect
  /^-\s*\/\/\s*test/,              // 删除注释的 test
];

export const noTestSimplification: ConstraintCheck = {
  id: 'no_test_simplification',
  async evaluate(env) {
    try {
      const diff = await env.stagedDiff();
      for (const pattern of DELETED_TEST_PATTERNS) {
        if (pattern.test(diff)) {
          return false; // 发现删除测试
        }
      }
      return true;
    } catch {
      return true; // git 命令失败，默认通过
    }
  },
};
