/**
 * ConstraintRegistry 测试
 */

import { ConstraintRegistry } from '../registry';
import { SAFETY_CONSTRAINTS, getSafetyConstraints } from '../safety';
import { QUALITY_CONSTRAINTS, getQualityConstraints } from '../quality';

describe('ConstraintRegistry', () => {
  let registry: ConstraintRegistry;

  beforeEach(() => {
    registry = new ConstraintRegistry();
  });

  describe('get', () => {
    it('应该获取安全层约束', () => {
      const constraint = registry.get('no_bypass_checkpoint');
      expect(constraint).toBeDefined();
      expect(constraint?.layer).toBe('safety');
      expect(constraint?.permanent).toBe(true);
    });

    it('应该获取质量层约束', () => {
      const constraint = registry.get('no_any_type');
      expect(constraint).toBeDefined();
      expect(constraint?.layer).toBe('quality');
    });

    it('应该返回 undefined 对于不存在的约束', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('应该返回所有约束', () => {
      const all = registry.getAll();
      expect(all.length).toBe(
        Object.keys(SAFETY_CONSTRAINTS).length + Object.keys(QUALITY_CONSTRAINTS).length,
      );
    });
  });

  describe('getByLayer', () => {
    it('应该按层过滤', () => {
      const safety = registry.getByLayer('safety');
      const quality = registry.getByLayer('quality');

      expect(safety.every(c => c.layer === 'safety')).toBe(true);
      expect(quality.every(c => c.layer === 'quality')).toBe(true);
      expect(safety.length).toBe(Object.keys(SAFETY_CONSTRAINTS).length);
    });
  });

  describe('getByStatus', () => {
    it('应该按退化状态过滤', () => {
      const active = registry.getByStatus('active');
      expect(active.length).toBe(registry.getAll().length);

      const deprecated = registry.getByStatus('deprecated');
      expect(deprecated.length).toBe(0);
    });
  });

  describe('getByTrigger', () => {
    it('应该按触发条件查找', () => {
      const constraints = registry.getByTrigger('code_implementation');
      expect(constraints.length).toBeGreaterThan(0);
      expect(constraints.every(c => {
        const triggers = Array.isArray(c.trigger) ? c.trigger : [c.trigger];
        return triggers.includes('code_implementation');
      })).toBe(true);
    });
  });

  describe('getDeprecationCandidates', () => {
    it('应该返回拦截率低于阈值的约束', () => {
      const rates = new Map<string, number>();
      rates.set('no_any_type', 3); // 低于 threshold 8
      rates.set('simplest_solution_first', 10); // 高于 threshold 8

      const candidates = registry.getDeprecationCandidates(rates);
      expect(candidates.some(c => c.id === 'no_any_type')).toBe(true);
      expect(candidates.some(c => c.id === 'simplest_solution_first')).toBe(false);
    });

    it('应该跳过安全层约束', () => {
      const rates = new Map<string, number>();
      rates.set('no_bypass_checkpoint', 0);

      const candidates = registry.getDeprecationCandidates(rates);
      expect(candidates.length).toBe(0);
    });

    it('应该跳过已计划退化的约束', () => {
      // 使用 scheduleDeprecation 设置状态，避免直接修改共享对象
      registry.scheduleDeprecation('no_any_type', {
        targetLevel: 'tip',
        reason: 'test',
        rollbackable: true,
      });

      const rates = new Map<string, number>();
      rates.set('no_any_type', 3);

      const candidates = registry.getDeprecationCandidates(rates);
      expect(candidates.some(c => c.id === 'no_any_type')).toBe(false);
    });
  });

  describe('degrade', () => {
    it('应该降低约束级别', () => {
      const result = registry.degrade('no_any_type');
      expect(result).toBe(true);

      const constraint = registry.get('no_any_type');
      expect(constraint?.level).toBe('tip');
      expect(constraint?.deprecationStatus).toBe('deprecated');
    });

    it('不应该退化安全层约束', () => {
      const result = registry.degrade('no_bypass_checkpoint');
      expect(result).toBe(false);
    });

    it('不应该退化非 active 约束', () => {
      registry.degrade('no_any_type');
      // 已经 degraded
      const result = registry.degrade('no_any_type');
      expect(result).toBe(false);
    });
  });

  describe('rollback', () => {
    it('应该回滚可回滚的退化', () => {
      registry.degrade('no_any_type');
      const result = registry.rollback('no_any_type', 'guideline');
      expect(result).toBe(true);

      const constraint = registry.get('no_any_type');
      expect(constraint?.level).toBe('guideline');
      expect(constraint?.deprecationStatus).toBe('active');
    });

    it('不应该回滚不可回滚的退化', () => {
      // no_code_without_test 的 rollbackable = false
      registry.degrade('no_code_without_test');
      const result = registry.rollback('no_code_without_test', 'guideline');
      expect(result).toBe(false);
    });

    it('不应该回滚不存在的约束', () => {
      const result = registry.rollback('nonexistent', 'guideline');
      expect(result).toBe(false);
    });
  });

  describe('scheduleDeprecation', () => {
    it('应该为质量层约束安排退化', () => {
      const result = registry.scheduleDeprecation('no_skill_without_test', {
        targetLevel: 'tip',
        reason: '测试能力提升',
        rollbackable: true,
      });
      expect(result).toBe(true);

      const constraint = registry.get('no_skill_without_test');
      expect(constraint?.deprecationStatus).toBe('scheduled');
    });

    it('不应该为安全层约束安排退化', () => {
      const result = registry.scheduleDeprecation('no_bypass_checkpoint', {
        targetLevel: 'tip',
        reason: 'test',
        rollbackable: true,
      });
      expect(result).toBe(false);
    });
  });

  describe('getLayerStats', () => {
    it('应该返回层统计', () => {
      const stats = registry.getLayerStats();
      expect(stats.length).toBe(2);

      const safetyStats = stats.find(s => s.layer === 'safety')!;
      expect(safetyStats.totalConstraints).toBe(Object.keys(SAFETY_CONSTRAINTS).length);
      expect(safetyStats.active).toBe(safetyStats.totalConstraints);

      const qualityStats = stats.find(s => s.layer === 'quality')!;
      expect(qualityStats.totalConstraints).toBe(Object.keys(QUALITY_CONSTRAINTS).length);
    });
  });

  describe('toLegacyConstraints', () => {
    it('应该转换为旧格式', () => {
      const legacy = registry.toLegacyConstraints();
      expect(legacy.length).toBe(registry.getAll().length);
      expect(legacy[0]).toHaveProperty('id');
      expect(legacy[0]).toHaveProperty('rule');
      expect(legacy[0]).toHaveProperty('level');
      // 不包含 layer 和 deprecationStatus
      expect(legacy[0]).not.toHaveProperty('layer');
      expect(legacy[0]).not.toHaveProperty('deprecationStatus');
    });
  });

  describe('register / remove', () => {
    it('应该注册自定义约束', () => {
      registry.register({
        id: 'custom',
        rule: 'CUSTOM',
        message: '自定义约束',
        level: 'guideline',
        trigger: 'code_implementation',
        enforcement: 'custom-check',
        layer: 'quality',
        deprecationStatus: 'active',
      });

      expect(registry.get('custom')).toBeDefined();
    });

    it('应该移除约束', () => {
      registry.register({
        id: 'temp',
        rule: 'TEMP',
        message: '临时',
        level: 'tip',
        trigger: 'commit',
        enforcement: 'temp',
        layer: 'quality',
        deprecationStatus: 'active',
      });

      expect(registry.remove('temp')).toBe(true);
      expect(registry.get('temp')).toBeUndefined();
    });
  });
});

describe('getSafetyConstraints', () => {
  it('应该返回安全层约束数组', () => {
    const constraints = getSafetyConstraints();
    expect(constraints.length).toBe(Object.keys(SAFETY_CONSTRAINTS).length);
    expect(constraints.every(c => c.layer === 'safety')).toBe(true);
  });
});

describe('getQualityConstraints', () => {
  it('应该返回质量层约束数组', () => {
    const constraints = getQualityConstraints();
    expect(constraints.length).toBe(Object.keys(QUALITY_CONSTRAINTS).length);
    expect(constraints.every(c => c.layer === 'quality')).toBe(true);
  });
});
