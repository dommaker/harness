/**
 * checker-as-guard 接线点（G1 / studio #129 随动）
 *
 * 把已注册的 ConstraintCheck 适配为统一 Gate，供守卫链（如 studio
 * runCompletionGuards）复用 runGates 的 deny 单调 / ask fail-closed 语义。
 *
 * env 经 buildCheckEnv(..., 'none') 构造（显式不接证据），语义见工厂 doc。
 */

import type { ConstraintCheck } from '../core/constraints/checkers';
import { buildCheckEnv } from '../core/constraints/checkers';
import type { Gate, GateContext, GateDecision } from './types';
import { decisionFromResult } from './decision';

/**
 * 将已注册 checker 适配为统一 Gate（checker-as-guard 接线点）
 *
 * 判定映射：false（违反）→ deny；true（满足）/ 'skip'（未评估）→ abstain。
 *
 * @param check 已注册的 ConstraintCheck（经 checkers 注册表取回）
 * @param order 门禁顺序（供 guard 链排序）
 */
export function createCheckerGate(check: ConstraintCheck, order = 0): Gate {
  return {
    id: check.id,
    order,
    async evaluate(ctx: GateContext): Promise<GateDecision> {
      const startTime = Date.now();
      const projectPath = ctx.projectPath || process.cwd();
      const env = buildCheckEnv({ operation: 'manual', projectPath }, 'none');
      const outcome = await check.evaluate(env);
      return decisionFromResult({
        gate: check.id,
        passed: outcome !== false,
        message:
          outcome === false
            ? `checker "${check.id}" 判定违规`
            : outcome === 'skip'
              ? `checker "${check.id}" 跳过（证据未接线）`
              : `checker "${check.id}" 通过`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      });
    },
  };
}
