/**
 * no_test_simplification：检查 staged diff 是否删除了测试（工单 21）
 *
 * 输入契约（harness#182）：声明 needs.stagedDiff——git 取证失败（非 git 仓库 /
 * 超 maxBuffer）时编排层产出带原因的 skipped，不再对空 diff 假 pass
 * （「检查器失效 ≠ 对象合规」）。catch 兜底只服务绕过编排层的直接 evaluate。
 */

import type { ConstraintCheck } from './types';

// m 标志必需：真实 diff 首行恒为 `diff --git`，缺 m 则 ^ 永不命中删除行（checker 静默失效）
const DELETED_TEST_PATTERNS = [
  /^-\s*(test|it|describe)\s*\(/m, // 删除 test/it/describe
  /^-\s*expect\s*\(/m,              // 删除 expect
  /^-\s*\/\/\s*test/m,              // 删除注释的 test
];

export const noTestSimplification: ConstraintCheck = {
  id: 'no_test_simplification',
  needs: { evidence: ['stagedDiff'] },
  async evaluate(env) {
    try {
      const diff = await env.stagedDiff();
      for (const pattern of DELETED_TEST_PATTERNS) {
        if (pattern.test(diff)) {
          return false; // 发现删除测试
        }
      }
      return true;
    } catch (err) {
      // 输入不可得 = 未评估（fail-open 但不假 pass）：原因进结果面与 trace，可统计
      const reason = err instanceof Error ? err.message : String(err);
      return { skip: true, reason: `staged diff 取证失败：${reason}` };
    }
  },
};
