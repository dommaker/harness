/**
 * presets 测试
 */

import { describe, it, expect } from '@jest/globals';
import { STRICT_PRESET, STANDARD_PRESET, RELAXED_PRESET, getPreset } from '../presets/standard';

describe('Presets', () => {
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
      expect(RELAXED_PRESET.ironLaws).not.toBeNull();
      expect(RELAXED_PRESET.guidelines).not.toBeNull();
      expect(RELAXED_PRESET.prompts).toEqual([]);
    });

    it('应该包含 no_completion_without_verification', () => {
      expect(RELAXED_PRESET.ironLaws).toContain('no_completion_without_verification');
    });

    it('应该包含 no_bypass_checkpoint', () => {
      expect(RELAXED_PRESET.guidelines).toContain('no_bypass_checkpoint');
    });
  });

  describe('getPreset', () => {
    it('应该返回 strict 预设', () => {
      const preset = getPreset('strict');
      expect(preset.name).toBe('strict');
    });

    it('应该返回 standard 预设', () => {
      const preset = getPreset('standard');
      expect(preset.name).toBe('standard');
    });

    it('应该返回 relaxed 预设', () => {
      const preset = getPreset('relaxed');
      expect(preset.name).toBe('relaxed');
    });

    it('未知预设应该返回 standard', () => {
      const preset = getPreset('unknown');
      expect(preset.name).toBe('standard');
    });
  });
});