/**
 * 约束分层类型定义
 *
 * 在原有 Constraint 基础上增加分层和退化元数据
 */

import type { Constraint, ConstraintLevel } from '../types/constraint';

/** 约束分层 */
export type ConstraintLayer = 'safety' | 'quality';

/** 退化状态 */
export type DeprecationStatus = 'active' | 'scheduled' | 'deprecated' | 'removed';

/** 退化计划 */
export interface DeprecationSchedule {
  /** 目标级别（当前 → 目标） */
  targetLevel: ConstraintLevel;
  /** 触发条件：拦截率低于此值时触发退化 */
  interceptRateThreshold?: number;
  /** 计划退化日期 */
  scheduledDate?: string;
  /** 退化原因 */
  reason: string;
  /** 是否可回滚 */
  rollbackable: boolean;
}

/** 带分层元数据的约束 */
export interface LayeredConstraint extends Constraint {
  /** 所属层 */
  layer: ConstraintLayer;
  /** 退化状态 */
  deprecationStatus: DeprecationStatus;
  /** 退化计划（所有层均有，iron_law 高阈值，guideline/tip 低阈值） */
  deprecationSchedule?: DeprecationSchedule;
  /** 是否永久保留（false = 所有层均可退化，区别仅在于阈值） */
  permanent?: boolean;
}

/** 约束拦截统计 */
export interface ConstraintStats {
  constraintId: string;
  triggerCount: number;
  passCount: number;
  interceptCount: number;
  interceptRate: number;
  lastTriggered?: string;
}

/** 约束层统计汇总 */
export interface LayerStats {
  layer: ConstraintLayer;
  totalConstraints: number;
  active: number;
  scheduled: number;
  deprecated: number;
  removed: number;
}
