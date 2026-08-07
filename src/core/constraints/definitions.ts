/**
 * 约束定义（薄聚合层）
 *
 * 三层约束体系：
 * - IRON_LAWS：绝对禁止，无例外
 * - GUIDELINES：优先建议，有例外
 * - TIPS：信息性提示
 *
 * 工单 20：字面量定义按层拆至 ./definitions/{iron-laws,guidelines,tips}.ts；
 * 本文件保持原路径与原导出面不变（studio rule-scanner 按此路径解析，P0 #8）。
 */

import type { Constraint, ConstraintTrigger } from '../../types/constraint';
import { IRON_LAWS } from './definitions/iron-laws';
import { GUIDELINES } from './definitions/guidelines';
import { TIPS } from './definitions/tips';

export { IRON_LAWS, GUIDELINES, TIPS };

// ========================================
// 辅助函数
// ========================================

/**
 * 获取所有约束（三层合并）
 */
export function getAllConstraints(): Constraint[] {
  return [
    ...Object.values(IRON_LAWS),
    ...Object.values(GUIDELINES),
    ...Object.values(TIPS),
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
  return IRON_LAWS[id] || GUIDELINES[id] || TIPS[id];
}
