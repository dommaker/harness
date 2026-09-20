/**
 * 约束定义（薄聚合层）
 *
 * severity 显式模型（ADR-0029，取代 ADR-0001 三层命名）：
 * 全部内置约束 kind='check'，severity 写死在定义上（error / warning），
 * 纯文本提示层（prompts.ts）已随文本注入层关停整体删除。
 *
 * 工单 20：字面量定义按 severity 分组放 ./definitions/{iron-laws,guidelines}.ts；
 * 本文件保持原路径做薄聚合（studio rule-scanner 按此路径解析，P0 #8）。
 */

import type { Constraint, ConstraintTrigger } from '../../types/constraint';
import { ERROR_CONSTRAINTS } from './definitions/iron-laws';
import { WARNING_CONSTRAINTS } from './definitions/guidelines';

/** 全部内置约束（check 层全量，severity 在条目上） */
export const CONSTRAINTS: Record<string, Constraint> = {
  ...ERROR_CONSTRAINTS,
  ...WARNING_CONSTRAINTS,
};

// ========================================
// 辅助函数
// ========================================

/**
 * 获取所有约束（check 全量，带 kind/severity）
 */
export function getAllConstraints(): Constraint[] {
  return Object.values(CONSTRAINTS);
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
  return CONSTRAINTS[id];
}
