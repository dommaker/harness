/**
 * 门禁决策构造（G1）
 *
 * GateResult（报告结构）→ GateDecision（三态决策）的映射点。
 */

import type { GateDecision, GateDecisionStatus, GateResult } from './types';

/**
 * 从报告结构构造决策。
 *
 * status 缺省由 `result.passed` 推导：true → 'abstain'（放行），
 * false → 'deny'（阻断）。'ask' 只能显式指定（枚举预留，暂无实现）。
 *
 * 返回值浅冻结（Object.freeze）：决策不可变是 deny 单调语义的接口契约——
 * 下游门禁不得改写上游决策，deny 不可被改回 allow。
 */
export function decisionFromResult(
  result: GateResult,
  status?: GateDecisionStatus
): GateDecision {
  const decision: GateDecision = {
    status: status ?? (result.passed ? 'abstain' : 'deny'),
    result: Object.freeze({ ...result }),
  };
  return Object.freeze(decision);
}
