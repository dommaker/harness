/**
 * ConstraintRegistry 测试
 */

import { ConstraintRegistry } from '../registry';
import { IRON_LAWS, GUIDELINES, TIPS } from '../../core/constraints/definitions';

const SAFETY_COUNT = Object.keys(IRON_LAWS).length;       // 7
const QUALITY_COUNT = Object.keys(GUIDELINES).length + Object.keys(TIPS).length; // 13

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
      expect(constraint?.permanent).toBe(false); // 所有层级均可退化
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
      expect(all.length).toBe(SAFETY_COUNT + QUALITY_COUNT);
    });
  });

  describe('getByLayer', () => {
    it('应该按层过滤', () => {
      const safety = registry.getByLayer('safety');
      const quality = registry.getByLayer('quality');

      expect(safety.every(c => c.layer === 'safety')).toBe(true);
      expect(quality.every(c => c.layer === 'quality')).toBe(true);
      expect(safety.length).toBe(SAFETY_COUNT);
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

  describe('degrade', () => {
    it('应该降低约束级别', () => {
      const result = registry.degrade('no_any_type');
      expect(result).toBe(true);

      const constraint = registry.get('no_any_type');
      expect(constraint?.level).toBe('tip');
      expect(constraint?.deprecationStatus).toBe('deprecated');
    });

    it('安全层约束也可以退化（Iron Law <5% 高阈值）', () => {
      const result = registry.degrade('no_bypass_checkpoint');
      expect(result).toBe(true);
    });

    it('不应该退化非 active 约束', () => {
      registry.degrade('no_any_type');
      const result = registry.degrade('no_any_type');
      expect(result).toBe(false);
    });
  });

  describe('rollback', () => {
    it('应该回滚退化', () => {
      registry.degrade('no_any_type');
      const result = registry.rollback('no_any_type', 'guideline');
      expect(result).toBe(true);

      const constraint = registry.get('no_any_type');
      expect(constraint?.level).toBe('guideline');
      expect(constraint?.deprecationStatus).toBe('active');
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
      expect(safetyStats.totalConstraints).toBe(SAFETY_COUNT);
      expect(safetyStats.active).toBe(safetyStats.totalConstraints);

      const qualityStats = stats.find(s => s.layer === 'quality')!;
      expect(qualityStats.totalConstraints).toBe(QUALITY_COUNT);
    });
  });

  describe('toLegacyConstraints', () => {
    it('应该转换为旧格式', () => {
      const legacy = registry.toLegacyConstraints();
      expect(legacy.length).toBe(registry.getAll().length);
      expect(legacy[0]).toHaveProperty('id');
      expect(legacy[0]).toHaveProperty('rule');
      expect(legacy[0]).toHaveProperty('level');
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
