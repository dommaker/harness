import {
  getAllConstraints,
  findConstraintsByTrigger,
  getConstraint,
  getLayeredConstraint,
  getSafetyConstraints,
  getQualityConstraints,
  getAllLaws,
  findLawsByTrigger,
  getLaw,
  IRON_LAWS,
  GUIDELINES,
} from '../definitions';

describe('definitions (backward-compatible API)', () => {
  describe('getAllConstraints', () => {
    it('返回所有约束', () => {
      const all = getAllConstraints();
      expect(all.length).toBeGreaterThan(0);
    });

    it('包含 safety 和 quality 约束', () => {
      const all = getAllConstraints();
      const ids = all.map(c => c.id);
      // 应包含来自 SAFETY_CONSTRAINTS 和 QUALITY_CONSTRAINTS 的约束
      expect(ids.length).toBeGreaterThanOrEqual(7 + 16);
    });

    it('每个约束都有必需字段', () => {
      const all = getAllConstraints();
      for (const c of all) {
        expect(c.id).toBeTruthy();
        expect(c.rule).toBeTruthy();
        expect(c.message).toBeTruthy();
        expect(c.level).toBeTruthy();
        expect(c.trigger).toBeTruthy();
        expect(c.enforcement).toBeTruthy();
      }
    });
  });

  describe('findConstraintsByTrigger', () => {
    it('按触发条件查找约束', () => {
      const results = findConstraintsByTrigger('code_implementation');
      expect(results.length).toBeGreaterThan(0);
      for (const c of results) {
        const triggers = Array.isArray(c.trigger) ? c.trigger : [c.trigger];
        expect(triggers).toContain('code_implementation');
      }
    });

    it('不存在的触发条件返回空数组', () => {
      const results = findConstraintsByTrigger('nonexistent_trigger' as any);
      expect(results).toHaveLength(0);
    });
  });

  describe('getConstraint', () => {
    it('按 ID 获取约束', () => {
      const all = getAllConstraints();
      const first = all[0];
      const found = getConstraint(first.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(first.id);
    });

    it('不存在的 ID 返回 undefined', () => {
      expect(getConstraint('nonexistent')).toBeUndefined();
    });
  });

  describe('getLayeredConstraint', () => {
    it('返回带分层信息的约束', () => {
      const all = getAllConstraints();
      const layered = getLayeredConstraint(all[0].id);
      expect(layered).toBeDefined();
      expect(layered!.layer).toBeDefined();
      expect(layered!.deprecationStatus).toBeDefined();
    });
  });

  describe('getSafetyConstraints / getQualityConstraints', () => {
    it('safety 约束 layer 为 safety', () => {
      const safety = getSafetyConstraints();
      expect(safety.length).toBe(7);
      for (const c of safety) {
        expect(c.layer).toBe('safety');
      }
    });

    it('quality 约束 layer 为 quality', () => {
      const quality = getQualityConstraints();
      expect(quality.length).toBe(16);
      for (const c of quality) {
        expect(c.layer).toBe('quality');
      }
    });
  });

  describe('向后兼容别名', () => {
    it('getAllLaws 等价于 getAllConstraints', () => {
      expect(getAllLaws()).toEqual(getAllConstraints());
    });

    it('findLawsByTrigger 等价于 findConstraintsByTrigger', () => {
      const trigger = 'code_implementation';
      expect(findLawsByTrigger(trigger)).toEqual(findConstraintsByTrigger(trigger));
    });

    it('getLaw 等价于 getConstraint', () => {
      const all = getAllConstraints();
      const id = all[0].id;
      expect(getLaw(id)).toEqual(getConstraint(id));
    });
  });

  describe('原始定义导出', () => {
    it('IRON_LAWS 是 SAFETY_CONSTRAINTS', () => {
      expect(IRON_LAWS).toBeDefined();
      expect(Object.keys(IRON_LAWS).length).toBe(7);
    });

    it('GUIDELINES 是 QUALITY_CONSTRAINTS', () => {
      expect(GUIDELINES).toBeDefined();
      expect(Object.keys(GUIDELINES).length).toBe(16);
    });
  });
});
