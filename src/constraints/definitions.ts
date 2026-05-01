/**
 * 约束兼容入口
 *
 * 向后兼容旧 API，内部委托给 ConstraintRegistry
 */

import { ConstraintRegistry } from './registry';
import { SAFETY_CONSTRAINTS } from './safety';
import { QUALITY_CONSTRAINTS } from './quality';
import type { Constraint, ConstraintTrigger } from '../types/constraint';
import type { LayeredConstraint } from './types';

// 全局注册表实例
const registry = new ConstraintRegistry();

/**
 * 获取所有约束（兼容旧 API）
 */
export function getAllConstraints(): Constraint[] {
  return registry.toLegacyConstraints();
}

/**
 * 按触发条件查找约束（兼容旧 API）
 */
export function findConstraintsByTrigger(trigger: ConstraintTrigger): Constraint[] {
  return registry.getByTrigger(trigger).map(c => ({
    id: c.id,
    rule: c.rule,
    message: c.message,
    level: c.level,
    trigger: c.trigger,
    enforcement: c.enforcement,
    description: c.description,
    enabled: c.enabled,
    exceptions: c.exceptions,
  }));
}

/**
 * 根据 ID 获取约束（兼容旧 API）
 */
export function getConstraint(id: string): Constraint | undefined {
  return registry.get(id);
}

/**
 * 获取带分层信息的约束
 */
export function getLayeredConstraint(id: string): LayeredConstraint | undefined {
  return registry.get(id);
}

/**
 * 获取安全层约束
 */
export function getSafetyConstraints(): LayeredConstraint[] {
  return registry.getByLayer('safety');
}

/**
 * 获取质量层约束
 */
export function getQualityConstraints(): LayeredConstraint[] {
  return registry.getByLayer('quality');
}

// 导出兼容函数
export { getAllConstraints as getAllLaws };
export { findConstraintsByTrigger as findLawsByTrigger };
export { getConstraint as getLaw };

// 导出原始定义（向后兼容）
export { SAFETY_CONSTRAINTS as IRON_LAWS };
export { QUALITY_CONSTRAINTS as GUIDELINES };
