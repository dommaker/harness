/**
 * 门禁执行器（G1）
 *
 * 按声明式 order 依次 evaluate，聚合语义：
 * - deny 单调：deny 一旦出现即不可被下游 abstain 改回 allow（接口契约）
 * - ask fail-closed：ask 枚举预留、无实现 → 聚合按 deny 计
 * - 决策对象浅冻结：下游不得改写上游决策
 */

import type { Gate, GateContext, GateDecision } from './types';

/**
 * 一次门禁链执行的聚合结果
 */
export interface GateRunResult {
  /** 聚合状态：任一 deny（或 ask fail-closed）→ 'deny'；否则 'abstain' */
  status: 'deny' | 'abstain';
  /** 按执行顺序的全部决策（浅冻结） */
  decisions: GateDecision[];
  /** 显式 deny 的决策（单调不可逆） */
  denied: GateDecision[];
  /** ask 决策（fail-closed 已计入聚合 deny，此处单独列出供报告） */
  asked: GateDecision[];
}

/**
 * 依次执行门禁链（按 order 升序，稳定排序）
 *
 * @param gates 参与执行的门禁（通常来自 getEffectiveGates）
 * @param ctx 门禁上下文
 */
export async function runGates(
  gates: readonly Gate[],
  ctx: GateContext
): Promise<GateRunResult> {
  const ordered = [...gates].sort((a, b) => a.order - b.order);
  const decisions: GateDecision[] = [];
  const denied: GateDecision[] = [];
  const asked: GateDecision[] = [];

  for (const gate of ordered) {
    const decision = Object.freeze(await gate.evaluate(ctx));
    decisions.push(decision);
    if (decision.status === 'deny') {
      denied.push(decision);
    } else if (decision.status === 'ask') {
      asked.push(decision);
    }
  }

  // 单调语义：deny 一旦出现，后续 abstain 不得改回 allow；
  // ask 无实现 → fail-closed = deny。
  const status: GateRunResult['status'] =
    denied.length > 0 || asked.length > 0 ? 'deny' : 'abstain';

  return { status, decisions, denied, asked };
}
