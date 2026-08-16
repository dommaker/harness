/**
 * contract-presence：通用契约在场引擎（Q5 定稿）
 *
 * - 按 yml contracts 类型清单查表：类型不在清单内 = skip（不算违规）
 * - 类型 → 判定方法的映射是代码不是配置（CONTRACT_JUDGMENTS）；
 *   首个活跃条目 review → context.reviewReport 在场（studio agent-loop 已解析字段，不重复解析）
 * - 类型在清单内但无判定方法注册 = violation（暴露配置与代码失配）
 */

import type { CompletionCheckersConfig, ContractPresenceContext, ContractPresenceResult } from './types';

/** 类型 → 判定方法映射（代码，不是配置）。新增契约类型 = 在此加一条 + 测试 */
const CONTRACT_JUDGMENTS: Record<string, (context: ContractPresenceContext) => boolean> = {
  review: (context) => context.reviewReport != null,
};

/** 契约在场判定 */
export function verifyContractPresence(
  type: string,
  context: ContractPresenceContext,
  config: CompletionCheckersConfig = {},
): ContractPresenceResult {
  if (config.enabled === false || config.checkers?.contractPresence === false) {
    return { checker: 'contract-presence', verdict: 'skip', detail: 'checker 已禁用' };
  }
  if (!(config.contracts ?? []).includes(type)) {
    return { checker: 'contract-presence', verdict: 'skip', detail: `类型 ${type} 无 contracts 表项` };
  }
  const judge = CONTRACT_JUDGMENTS[type];
  if (!judge) {
    return {
      checker: 'contract-presence',
      verdict: 'violation',
      detail: `类型 ${type} 已在 contracts 声明但无判定方法注册（配置与代码失配）`,
    };
  }
  return judge(context)
    ? { checker: 'contract-presence', verdict: 'pass' }
    : { checker: 'contract-presence', verdict: 'violation', detail: `类型 ${type} 契约标记缺失` };
}
