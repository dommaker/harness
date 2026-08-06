/**
 * Tests for standard.ts — applyPreset, getPreset
 *
 * Pure logic, no I/O — tests preset selection and constraint filtering.
 */

import { applyPreset, getPreset } from '../standard';

describe('getPreset', () => {
  it('returns strict preset', () => {
    const preset = getPreset('strict');
    expect(preset.name).toBe('strict');
    expect(preset.ironLaws).toBeNull();
    expect(preset.guidelines).toBeNull();
    expect(preset.tips).toBeNull();
  });

  it('returns standard preset', () => {
    const preset = getPreset('standard');
    expect(preset.name).toBe('standard');
  });

  it('returns relaxed preset', () => {
    const preset = getPreset('relaxed');
    expect(preset.name).toBe('relaxed');
    expect(preset.ironLaws).toHaveLength(3);
    expect(preset.guidelines).toHaveLength(2);
    expect(preset.tips).toEqual([]);
  });

  it('defaults to standard for unknown preset name', () => {
    const preset = getPreset('unknown' as any);
    expect(preset.name).toBe('standard');
  });
});

describe('applyPreset with string preset names', () => {
  it('strict enables all iron laws and guidelines', () => {
    const config = applyPreset('strict');
    expect(config.ironLaws).toBeDefined();
    expect(Object.keys(config.ironLaws).length).toBeGreaterThan(0);
    expect(config.guidelines).toBeDefined();
    expect(Object.keys(config.guidelines).length).toBeGreaterThan(0);
    expect(config.disabled).toEqual([]);
  });

  it('relaxed enables only specific constraints', () => {
    const config = applyPreset('relaxed');
    expect(config.ironLaws).toBeDefined();
    expect(config.ironLaws.no_self_approval).toBeDefined();
    expect(Object.keys(config.tips).length).toBe(0);
    expect(config.disabled.length).toBeGreaterThan(0);
  });
});

describe('applyPreset with PresetConfig object', () => {
  it('filters iron laws when ids are provided', () => {
    const config = applyPreset({
      name: 'custom',
      ironLaws: ['no_self_approval', 'no_completion_without_verification'],
      guidelines: null,
      tips: null,
    });
    expect(Object.keys(config.ironLaws)).toHaveLength(2);
    expect(config.ironLaws.no_self_approval).toBeDefined();
    expect(config.ironLaws.no_fix_without_root_cause).toBeUndefined();
  });

  it('includes all guidelines when null', () => {
    const config = applyPreset({
      name: 'custom',
      ironLaws: null,
      guidelines: null,
      tips: [],
    });
    expect(Object.keys(config.guidelines).length).toBeGreaterThan(0);
    expect(Object.keys(config.tips).length).toBe(0);
  });

  it('creates disabled list for omitted constraints', () => {
    const config = applyPreset({
      name: 'custom',
      ironLaws: [],
      guidelines: [],
      tips: [],
    });
    expect(config.disabled.length).toBeGreaterThan(0);
  });
});
