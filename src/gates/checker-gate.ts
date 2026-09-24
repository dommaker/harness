/**
 * checker-as-guard 接线点（G1 / studio #129 随动）
 *
 * 把已注册的 ConstraintCheck 适配为统一 Gate，供守卫链（如 studio
 * runCompletionGuards）复用 runGates 的 deny 单调 / ask fail-closed 语义。
 *
 * env 经 buildCheckEnv(..., 'none') 构造（显式不接证据），语义见工厂 doc；
 * `ctx.runEnv` 传入即与本 run 其余消费方共用同一份上行数据读取（ADR-0023）。
 */

import type { ConstraintCheck } from '../core/constraints/checkers';
import { buildCheckEnv, normalizeCheckOutcome, degradeForMissingInputs } from '../core/constraints/checkers';
import type { Gate, GateContext, GateDecision } from './types';
import { gateResult } from './types';
import { decisionFromResult } from './decision';

/**
 * 将已注册 checker 适配为统一 Gate（checker-as-guard 接线点）
 *
 * 判定映射：violated（false 或 CheckDetail.pass=false）→ deny；
 * 满足 / skip（未评估）→ abstain。违规证据随理由带出。
 *
 * 输入契约（harness#182）：env 显式不接证据（'none'），声明了 git 证据需求的
 * checker 在此输入必缺——与编排层同一降级路径（带原因的 skipped → abstain），
 * 不再让 checker 对空证据假评估。
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
      const env = buildCheckEnv({ operation: 'manual', projectPath }, 'none', ctx.runEnv);
      const degraded = degradeForMissingInputs(check, env);
      const outcome = degraded
        ? normalizeCheckOutcome(degraded)
        : normalizeCheckOutcome(await check.evaluate(env));
      const evidence = outcome.evidence.map((e) => `\n  - ${e}`).join('');
      const reason = outcome.skipped
        ? `checker "${check.id}" 跳过（${outcome.skipReason ?? '证据未接线'}）`
        : outcome.satisfied
          ? `checker "${check.id}" 通过`
          : `checker "${check.id}" 判定违规${evidence}`;
      return decisionFromResult(gateResult(check.id, outcome.satisfied, reason, startTime));
    },
  };
}
