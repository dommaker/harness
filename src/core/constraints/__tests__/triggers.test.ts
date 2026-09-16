/**
 * 约束 trigger 归一与匹配谓词测试（harness#105 语义单点）
 *
 * 用例自 `src/__tests__/exec.test.ts` 随迁（harness#137）：二者是约束域谓词，
 * 归位到 core/constraints 后测试跟着正本走。
 */

import { describe, it, expect } from '@jest/globals';
import { normalizeTriggers, matchesTrigger } from '../triggers';

describe('normalizeTriggers', () => {
  it('应该返回 fallback 当值为 null', () => {
    const result = normalizeTriggers(null, ['default']);
    expect(result).toEqual(['default']);
  });

  it('应该返回 fallback 当值为 undefined', () => {
    const result = normalizeTriggers(undefined, ['default']);
    expect(result).toEqual(['default']);
  });

  it('应该将单值包装为数组', () => {
    const result = normalizeTriggers('single');
    expect(result).toEqual(['single']);
  });

  it('应该直接返回数组', () => {
    const result = normalizeTriggers(['a', 'b']);
    expect(result).toEqual(['a', 'b']);
  });

  it('应该使用空数组作为默认 fallback', () => {
    const result = normalizeTriggers(undefined);
    expect(result).toEqual([]);
  });
});

describe('matchesTrigger', () => {
  it('单值 trigger 命中操作返回 true', () => {
    expect(matchesTrigger({ trigger: 'a' }, ['a'])).toBe(true);
  });

  it('单值 trigger 未命中返回 false', () => {
    expect(matchesTrigger({ trigger: 'a' }, ['b'])).toBe(false);
  });

  it('数组 trigger 任一命中即返回 true', () => {
    expect(matchesTrigger({ trigger: ['a', 'b'] }, ['b'])).toBe(true);
  });

  it('数组 trigger 全部未命中返回 false', () => {
    expect(matchesTrigger({ trigger: ['a', 'b'] }, ['c', 'd'])).toBe(false);
  });

  it('operations 中任一命中即返回 true', () => {
    expect(matchesTrigger({ trigger: 'a' }, ['x', 'a'])).toBe(true);
  });

  it('trigger 为 undefined 时不匹配任何操作', () => {
    expect(matchesTrigger({ trigger: undefined }, ['a'])).toBe(false);
  });

  it('trigger 为空数组时不匹配任何操作', () => {
    expect(matchesTrigger({ trigger: [] }, ['a'])).toBe(false);
  });

  it('operations 为空数组时返回 false', () => {
    expect(matchesTrigger({ trigger: 'a' }, [])).toBe(false);
  });
});
