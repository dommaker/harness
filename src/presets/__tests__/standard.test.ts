/**
 * presets 纯数据测试
 *
 * 预设只保留数据（ADR-0029：键按 severity 命名；筛选逻辑统一在 mergeConstraints），
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
      expect(STRICT_PRESET.errors).toBeNull();
      expect(STRICT_PRESET.warnings).toBeNull();
    });
  });

  describe('STANDARD_PRESET', () => {
    it('应该启用所有约束', () => {
      expect(STANDARD_PRESET.name).toBe('standard');
      expect(STANDARD_PRESET.errors).toBeNull();
      expect(STANDARD_PRESET.warnings).toBeNull();
    });
  });

  describe('RELAXED_PRESET', () => {
    it('应该只启用核心约束', () => {
      expect(RELAXED_PRESET.name).toBe('relaxed');
      expect(RELAXED_PRESET.errors).toHaveLength(1);
      expect(RELAXED_PRESET.warnings).toHaveLength(1);
    });

    it('应该包含 no_completion_without_verification', () => {
      expect(RELAXED_PRESET.errors).toContain('no_completion_without_verification');
    });

    it('应该包含 no_hardcoded_credentials', () => {
      expect(RELAXED_PRESET.warnings).toContain('no_hardcoded_credentials');
    });
  });

  describe('PRESETS_BY_NAME', () => {
    it('strict 是 standard 的别名（同为全部启用）', () => {
      expect(PRESETS_BY_NAME['strict']?.errors).toBeNull();
      expect(PRESETS_BY_NAME['strict']?.warnings).toBeNull();
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
