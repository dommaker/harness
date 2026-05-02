/**
 * 约束注册表
 *
 * 基于 core/constraints/definitions 构建，附加分层和退化元数据。
 * 分层规则：iron_law → safety（永久），guideline/tip → quality（可退化）
 */

import type { Constraint, ConstraintLevel, ConstraintTrigger } from '../types/constraint';
import type { LayeredConstraint, ConstraintLayer, DeprecationStatus, LayerStats, DeprecationSchedule } from './types';
import { IRON_LAWS, GUIDELINES, TIPS } from '../core/constraints/definitions';

function toLayered(constraint: Constraint): LayeredConstraint {
  const layer: ConstraintLayer = constraint.level === 'iron_law' ? 'safety' : 'quality';
  return {
    ...constraint,
    layer,
    deprecationStatus: 'active' as DeprecationStatus,
    permanent: layer === 'safety',
    deprecationSchedule: layer === 'quality' ? {
      targetLevel: (constraint.level === 'guideline' ? 'tip' : 'info') as ConstraintLevel,
      reason: '自动退化：拦截率持续低于阈值',
      rollbackable: true,
    } : undefined,
  };
}

export class ConstraintRegistry {
  private constraints: Map<string, LayeredConstraint>;

  constructor() {
    this.constraints = new Map();
    const all = { ...IRON_LAWS, ...GUIDELINES, ...TIPS };
    for (const [id, constraint] of Object.entries(all)) {
      this.constraints.set(id, toLayered(constraint));
    }
  }

  get(id: string): LayeredConstraint | undefined {
    return this.constraints.get(id);
  }

  getAll(): LayeredConstraint[] {
    return Array.from(this.constraints.values());
  }

  getByLayer(layer: ConstraintLayer): LayeredConstraint[] {
    return this.getAll().filter(c => c.layer === layer);
  }

  getByStatus(status: DeprecationStatus): LayeredConstraint[] {
    return this.getAll().filter(c => c.deprecationStatus === status);
  }

  getByTrigger(trigger: ConstraintTrigger): LayeredConstraint[] {
    return this.getAll().filter(c => {
      const triggers = Array.isArray(c.trigger) ? c.trigger : [c.trigger];
      return triggers.includes(trigger);
    });
  }

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

  degrade(id: string): boolean {
    const constraint = this.constraints.get(id);
    if (!constraint || !constraint.deprecationSchedule) return false;
    if (constraint.deprecationStatus !== 'active') return false;
    constraint.level = constraint.deprecationSchedule.targetLevel;
    constraint.deprecationStatus = 'deprecated';
    return true;
  }

  rollback(id: string, originalLevel: ConstraintLevel): boolean {
    const constraint = this.constraints.get(id);
    if (!constraint) return false;
    if (!constraint.deprecationSchedule?.rollbackable) return false;
    constraint.level = originalLevel;
    constraint.deprecationStatus = 'active';
    return true;
  }

  scheduleDeprecation(id: string, schedule: DeprecationSchedule): boolean {
    const constraint = this.constraints.get(id);
    if (!constraint || constraint.layer !== 'quality') return false;
    constraint.deprecationSchedule = schedule;
    constraint.deprecationStatus = 'scheduled';
    return true;
  }

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

  register(constraint: LayeredConstraint): void {
    this.constraints.set(constraint.id, constraint);
  }

  remove(id: string): boolean {
    return this.constraints.delete(id);
  }
}
