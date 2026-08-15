/**
 * checker-as-guard 接线点（G1 / studio #129 随动）
 *
 * 把已注册的 ConstraintCheck 适配为统一 Gate，供守卫链（如 studio
 * runCompletionGuards）复用 runGates 的 deny 单调 / ask fail-closed 语义。
 *
 * 证据语义：本接线点构造的 CheckEnv 不带 git staged diff / 源码扫描证据
 * （stagedDiff 空、srcScan 空）——证据 flag 未接线的 checker 按契约返回
 * 'skip'（不阻断，映射为 abstain）；纯上下文判断的 checker 照常判定。
 * studio 侧若需 git 证据，在 #129 接线时扩展 CheckEnv 构造。
 */

import type { CheckEnv, ConstraintCheck } from '../core/constraints/checkers';
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
      const env: CheckEnv = {
        context: { operation: 'manual', projectPath },
        projectPath,
        stagedDiff: async () => '',
        stagedDiffNames: async () => '',
        srcScan: () => [],
      };
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
