/**
 * 约束定义（薄聚合层）
 *
 * kind 二元模型（ADR-0001）：
 * - IRON_LAWS / GUIDELINES：check 层，必须带真实 checker（注册表闭环）
 * - PROMPTS：prompt 层，纯文本注入，不占检查位
 * - TIPS：已退役，导出空表仅为在途消费者（capabilities-syncer）编译兼容，
 *   后续阶段随其改造一并删除
 *
 * 工单 20：字面量定义按层拆至 ./definitions/{iron-laws,guidelines,prompts}.ts；
 * 本文件保持原路径做薄聚合（studio rule-scanner 按此路径解析，P0 #8）。
 */

import type { Constraint, ConstraintTrigger } from '../../types/constraint';
import { IRON_LAWS } from './definitions/iron-laws';
import { GUIDELINES } from './definitions/guidelines';
import { PROMPTS } from './definitions/prompts';

/**
 * @deprecated TIPS 已退役（ADR-0001），恒为空表。
 * 仅为在途 capabilities-syncer 编译兼容保留，后续阶段删除。
 */
export const TIPS: Record<string, Constraint> = {};

export { IRON_LAWS, GUIDELINES, PROMPTS };

// ========================================
// 辅助函数
// ========================================

/**
 * 获取所有约束（check + prompt 全量，带 kind）
 */
export function getAllConstraints(): Constraint[] {
  return [
    ...Object.values(IRON_LAWS),
    ...Object.values(GUIDELINES),
    ...Object.values(PROMPTS),
  ];
}

/**
 * 根据触发条件查找适用的约束
 */
export function findConstraintsByTrigger(trigger: ConstraintTrigger): Constraint[] {
  return getAllConstraints().filter(constraint => {
    const triggers = Array.isArray(constraint.trigger) ? constraint.trigger : [constraint.trigger];
    return triggers.includes(trigger);
  });
}

/**
 * 根据 ID 获取约束
 */
export function getConstraint(id: string): Constraint | undefined {
  return IRON_LAWS[id] || GUIDELINES[id] || PROMPTS[id];
}
