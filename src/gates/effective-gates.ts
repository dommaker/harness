/**
 * 生效门禁集（G1）：对齐 getEffectiveConstraints 的 config 裁剪模式
 *
 * 单一来源：注册表（默认 order）→ config.yml `gates.order` 声明式重排 →
 * `gates.<id>.enabled:false` 裁剪移除。
 *
 * 闭环：config.yml gates 配置引用了未注册的门禁 id → 抛错
 * （与注册表「引用未注册」同款闭环；gates 配置段为新增面，
 * 不存在历史残留配置，故不需静默忽略）。
 */

import type { Gate } from './types';
import { listRegisteredGates } from './registry';
import { loadRawProjectConfig } from '../core/project-config-loader';

/**
 * config.yml `gates` 段
 */
export interface GatesConfig {
  /** 声明式顺序（门禁 id 列表）；未列出的按默认顺序排后 */
  order?: string[];
  /** 每个门禁的启用开关（gates.<id>.enabled: false = 裁剪） */
  [gateId: string]: { enabled?: boolean } | string[] | undefined;
}

/**
 * 获取项目当前生效的门禁集（按 order 升序）
 *
 * @param projectRoot 项目根路径（缺省 process.cwd()）
 * @throws config.yml gates 段引用未注册门禁 id 时抛错
 */
export function getEffectiveGates(projectRoot: string = process.cwd()): Gate[] {
  const raw = loadRawProjectConfig(projectRoot);
  const config = raw?.gates as GatesConfig | undefined;
  const gates = listRegisteredGates();
  const known = new Set(gates.map(g => g.id));

  if (!config) {
    return sortByOrder(gates);
  }

  // ========================================
  // 闭环校验：引用未注册 → 抛错
  // ========================================
  const orderIds = Array.isArray(config.order) ? (config.order as string[]) : undefined;
  if (orderIds) {
    const seen = new Set<string>();
    for (const id of orderIds) {
      if (!known.has(id)) {
        throw new Error(
          `[harness] config.yml gates.order 引用了未注册的门禁 "${id}"。` +
          `可用门禁: ${[...known].join(', ')}。`
        );
      }
      if (seen.has(id)) {
        throw new Error(
          `[harness] config.yml gates.order 中门禁 "${id}" 重复。`
        );
      }
      seen.add(id);
    }
  }
  for (const key of Object.keys(config)) {
    if (key === 'order') continue;
    if (!known.has(key)) {
      throw new Error(
        `[harness] config.yml gates.${key} 引用了未注册的门禁。` +
        `可用门禁: ${[...known].join(', ')}。`
      );
    }
  }

  // ========================================
  // enabled 裁剪（与 getEffectiveConstraints 的 enabled:false 删除同效）
  // ========================================
  const disabled = new Set<string>();
  for (const gate of gates) {
    const entry = config[gate.id];
    if (
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      entry.enabled === false
    ) {
      disabled.add(gate.id);
    }
  }
  const effective = gates.filter(g => !disabled.has(g.id));

  // ========================================
  // order 重排：列出的按列表顺序，未列出的按默认顺序排后
  // ========================================
  if (orderIds) {
    const position = new Map(orderIds.map((id, i) => [id, i]));
    return effective.sort((a, b) => {
      const pa = position.has(a.id) ? position.get(a.id)! : orderIds.length + a.order;
      const pb = position.has(b.id) ? position.get(b.id)! : orderIds.length + b.order;
      return pa - pb;
    });
  }
  return sortByOrder(effective);
}

function sortByOrder(gates: Gate[]): Gate[] {
  return gates.sort((a, b) => a.order - b.order);
}
