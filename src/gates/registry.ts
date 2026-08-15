/**
 * 门禁注册表（G1：复制 checker 的「定义即注册 + 构建期闭环」模式）
 *
 * 模块加载期双向校验（任一不满足即抛错，拒绝静默缺失）：
 * - 定义无实现 → 抛错（definitions.ts 有定义但 registry 未注册实现）
 * - 实现无定义 → 抛错（registry 注册了实现但 definitions.ts 无定义）
 * - 重复 id → 抛错
 *
 * 引用未注册（getGate / config.yml gates 配置引用）同样抛错——
 * 与 checker 注册表闭环同款故障类「定义了但没登记」由机制消灭。
 */

import type { Gate } from './types';
import { GATE_DEFINITIONS, type GateDefinition } from './definitions';
import { ReviewGate } from './review';
import { SecurityGate } from './security';
import { PerformanceGate } from './performance';
import { ContractGate } from './contract';
import { SpecAcceptanceGate } from './acceptance';
import { CommandGate } from './command';

const IMPLEMENTATIONS: Gate[] = [
  new SpecAcceptanceGate(),
  new CommandGate(),
  new ContractGate(),
  new PerformanceGate(),
  new ReviewGate(),
  new SecurityGate(),
];

// ========================================
// 注册表闭环校验（加载期）
// ========================================

assertGateRegistryClosed(GATE_DEFINITIONS, IMPLEMENTATIONS);

// 默认 order 以定义表为准（config.yml gates.order 在生效集层覆盖，不改注册表单例）
for (const def of GATE_DEFINITIONS) {
  IMPLEMENTATIONS.find(g => g.id === def.id)!.order = def.order;
}

const registry = new Map<string, Gate>(IMPLEMENTATIONS.map(g => [g.id, g]));

/**
 * 注册表闭环双向校验（加载期调用；测试用坏输入验证两个失败方向）
 *
 * @throws 定义无实现 / 实现无定义 / 重复 id 时抛错
 */
export function assertGateRegistryClosed(
  definitions: readonly GateDefinition[],
  implementations: readonly Gate[]
): void {
  const implIds = new Map<string, Gate>();
  for (const impl of implementations) {
    if (implIds.has(impl.id)) {
      throw new Error(
        `[harness] 门禁注册表闭环校验失败：门禁 "${impl.id}" 重复注册。`
      );
    }
    implIds.set(impl.id, impl);
  }

  for (const def of definitions) {
    if (!implIds.has(def.id)) {
      throw new Error(
        `[harness] 门禁注册表闭环校验失败：门禁定义 "${def.id}" 未注册实现。` +
        `请在 src/gates/ 中实现并注册，或删除该定义。`
      );
    }
  }

  for (const impl of implementations) {
    if (!definitions.some(d => d.id === impl.id)) {
      throw new Error(
        `[harness] 门禁注册表闭环校验失败：门禁实现 "${impl.id}" 没有对应定义。` +
        `请在 src/gates/definitions.ts 中补齐定义，或移除该实现。`
      );
    }
  }
}

/**
 * 按 id 查找已注册门禁实现；未注册抛错（闭环，拒绝静默缺失）
 */
export function getGate(id: string): Gate {
  const gate = registry.get(id);
  if (!gate) {
    throw new Error(
      `[harness] 门禁 "${id}" 未注册（注册表闭环）。可用门禁: ${[...registry.keys()].join(', ')}。`
    );
  }
  return gate;
}

/**
 * 全部已注册门禁（返回副本，调用方可安全排序/过滤）
 */
export function listRegisteredGates(): Gate[] {
  return [...registry.values()];
}

/**
 * 已注册门禁数量（诊断/测试用）
 */
export function registeredGateCount(): number {
  return registry.size;
}
