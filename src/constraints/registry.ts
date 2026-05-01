/**
 * 约束注册表
 *
 * 统一管理安全层和质量层约束，提供分层查询、退化管理
 */

import type { Constraint, ConstraintLevel, ConstraintTrigger } from '../types/constraint';
import type { LayeredConstraint, ConstraintLayer, DeprecationStatus, LayerStats, DeprecationSchedule } from './types';
import { SAFETY_CONSTRAINTS } from './safety';
import { QUALITY_CONSTRAINTS } from './quality';

export class ConstraintRegistry {
  private constraints: Map<string, LayeredConstraint>;

  constructor() {
    this.constraints = new Map();
    // 注册安全层约束（克隆避免修改静态定义）
    for (const [id, constraint] of Object.entries(SAFETY_CONSTRAINTS)) {
      this.constraints.set(id, {
        ...constraint,
        deprecationSchedule: constraint.deprecationSchedule
          ? { ...constraint.deprecationSchedule }
          : undefined,
      });
    }
    // 注册质量层约束
    for (const [id, constraint] of Object.entries(QUALITY_CONSTRAINTS)) {
      this.constraints.set(id, {
        ...constraint,
        deprecationSchedule: constraint.deprecationSchedule
          ? { ...constraint.deprecationSchedule }
          : undefined,
      });
    }
  }

  /**
   * 获取约束（兼容旧 API）
   */
  get(id: string): LayeredConstraint | undefined {
    return this.constraints.get(id);
  }

  /**
   * 获取所有约束
   */
  getAll(): LayeredConstraint[] {
    return Array.from(this.constraints.values());
  }

  /**
   * 按层获取约束
   */
  getByLayer(layer: ConstraintLayer): LayeredConstraint[] {
    return this.getAll().filter(c => c.layer === layer);
  }

  /**
   * 按退化状态获取约束
   */
  getByStatus(status: DeprecationStatus): LayeredConstraint[] {
    return this.getAll().filter(c => c.deprecationStatus === status);
  }

  /**
   * 按触发条件查找约束
   */
  getByTrigger(trigger: ConstraintTrigger): LayeredConstraint[] {
    return this.getAll().filter(c => {
      const triggers = Array.isArray(c.trigger) ? c.trigger : [c.trigger];
      return triggers.includes(trigger);
    });
  }

  /**
   * 获取退化候选（拦截率低于阈值的约束）
   */
  getDeprecationCandidates(interceptRates: Map<string, number>): LayeredConstraint[] {
    return this.getAll().filter(c => {
      if (c.layer !== 'quality' || !c.deprecationSchedule) return false;
      if (c.deprecationStatus !== 'active') return false;
      const threshold = c.deprecationSchedule.interceptRateThreshold;
      if (threshold === undefined) return false;
      const rate = interceptRates.get(c.id);
      return rate !== undefined && rate < threshold;
    });
  }

  /**
   * 执行退化：降低约束级别
   */
  degrade(id: string): boolean {
    const constraint = this.constraints.get(id);
    if (!constraint || !constraint.deprecationSchedule) return false;
    if (constraint.deprecationStatus !== 'active') return false;

    constraint.level = constraint.deprecationSchedule.targetLevel;
    constraint.deprecationStatus = 'deprecated';
    return true;
  }

  /**
   * 回滚退化
   */
  rollback(id: string, originalLevel: ConstraintLevel): boolean {
    const constraint = this.constraints.get(id);
    if (!constraint) return false;
    if (!constraint.deprecationSchedule?.rollbackable) return false;

    constraint.level = originalLevel;
    constraint.deprecationStatus = 'active';
    return true;
  }

  /**
   * 标记为计划退化
   */
  scheduleDeprecation(id: string, schedule: DeprecationSchedule): boolean {
    const constraint = this.constraints.get(id);
    if (!constraint || constraint.layer !== 'quality') return false;

    constraint.deprecationSchedule = schedule;
    constraint.deprecationStatus = 'scheduled';
    return true;
  }

  /**
   * 获取层统计
   */
  getLayerStats(): LayerStats[] {
    const layers: ConstraintLayer[] = ['safety', 'quality'];
    return layers.map(layer => {
      const constraints = this.getByLayer(layer);
      return {
        layer,
        totalConstraints: constraints.length,
        active: constraints.filter(c => c.deprecationStatus === 'active').length,
        scheduled: constraints.filter(c => c.deprecationStatus === 'scheduled').length,
        deprecated: constraints.filter(c => c.deprecationStatus === 'deprecated').length,
        removed: constraints.filter(c => c.deprecationStatus === 'removed').length,
      };
    });
  }

  /**
   * 转换为旧格式 Constraint（兼容）
   */
  toLegacyConstraints(): Constraint[] {
    return this.getAll().map(c => ({
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
   * 注册自定义约束
   */
  register(constraint: LayeredConstraint): void {
    this.constraints.set(constraint.id, constraint);
  }

  /**
   * 移除约束
   */
  remove(id: string): boolean {
    return this.constraints.delete(id);
  }
}
