/**
 * presets 纯数据测试
 *
 * 预设只保留数据（ADR-0001：筛选逻辑统一在 mergeConstraints），
 * 这里锁定数据形状与 strict→standard 别名语义。
 */

import {
  STRICT_PRESET,
  STANDARD_PRESET,
  RELAXED_PRESET,
  PRESETS_BY_NAME,
} from '../standard';

describe('预设数据', () => {
  describe('STRICT_PRESET', () => {
    it('应该启用所有约束', () => {
      expect(STRICT_PRESET.name).toBe('strict');
      expect(STRICT_PRESET.ironLaws).toBeNull();
      expect(STRICT_PRESET.guidelines).toBeNull();
      expect(STRICT_PRESET.prompts).toBeNull();
    });
  });

  describe('STANDARD_PRESET', () => {
    it('应该启用所有约束', () => {
      expect(STANDARD_PRESET.name).toBe('standard');
      expect(STANDARD_PRESET.ironLaws).toBeNull();
      expect(STANDARD_PRESET.guidelines).toBeNull();
      expect(STANDARD_PRESET.prompts).toBeNull();
    });
  });

  describe('RELAXED_PRESET', () => {
    it('应该只启用核心约束', () => {
      expect(RELAXED_PRESET.name).toBe('relaxed');
      expect(RELAXED_PRESET.ironLaws).toHaveLength(3);
      expect(RELAXED_PRESET.guidelines).toHaveLength(2);
      expect(RELAXED_PRESET.prompts).toEqual([]);
    });

    it('应该包含 no_completion_without_verification', () => {
      expect(RELAXED_PRESET.ironLaws).toContain('no_completion_without_verification');
    });

    it('应该包含 no_bypass_checkpoint', () => {
      expect(RELAXED_PRESET.guidelines).toContain('no_bypass_checkpoint');
    });
  });

  describe('PRESETS_BY_NAME', () => {
    it('strict 是 standard 的别名（同为全部启用）', () => {
      expect(PRESETS_BY_NAME['strict']?.ironLaws).toBeNull();
      expect(PRESETS_BY_NAME['strict']?.guidelines).toBeNull();
      expect(PRESETS_BY_NAME['strict']?.prompts).toBeNull();
    });

    it('三个预设名均可解析', () => {
      expect(PRESETS_BY_NAME['strict']).toBe(STRICT_PRESET);
      expect(PRESETS_BY_NAME['standard']).toBe(STANDARD_PRESET);
      expect(PRESETS_BY_NAME['relaxed']).toBe(RELAXED_PRESET);
    });

    it('未知预设名不在表中（由 mergeConstraints 回落 standard）', () => {
      expect(PRESETS_BY_NAME['unknown']).toBeUndefined();
    });
  });
});
