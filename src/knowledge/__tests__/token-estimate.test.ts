/**
 * token 估算尺子测试（正本 `knowledge/token-estimate.ts`）
 *
 * 钉三件事：① 换算规则本身（CJK 2 token/字、其余 0.25 token/字、向上取整）；
 * ② `KnowledgeQuery.estimateTokens` 委托同一实现（不长出第二把尺子，harness#197）；
 * ③ 码点边界按注释声明的范围走（Ext A / Unified / 兼容表意三段）。
 */

import { describe, it, expect } from '@jest/globals';
import { estimateTokens } from '../token-estimate';
import { KnowledgeQuery } from '../query';
import type { KnowledgeStore } from '../store';

describe('estimateTokens', () => {
  it('空串为 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('纯 ASCII：0.25 token/字，4 字 = 1 token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2); // 1.25 → ceil 2
  });

  it('纯中文：2 token/字', () => {
    expect(estimateTokens('知识引擎')).toBe(8);
  });

  it('混排按逐字累加（旧「含中文即整串除 1.5」的口径不成立）', () => {
    // 2 汉字 = 4 token + 4 ASCII = 1 token → ceil(5) = 5
    expect(estimateTokens('知识abcd')).toBe(5);
  });

  it('码点边界：三段 CJK 范围内外逐点核对', () => {
    expect(estimateTokens('㐀')).toBe(2); // U+3400 Ext A 起
    expect(estimateTokens('䶿')).toBe(2); // U+4DBF  Ext A 止
    expect(estimateTokens('一')).toBe(2); // U+4E00  Unified 起
    expect(estimateTokens('鿿')).toBe(2); // U+9FFF  Unified 止
    expect(estimateTokens('豈')).toBe(2); // U+F900  兼容表意起
    expect(estimateTokens('﫿')).toBe(2); // U+FAFF  兼容表意止
    expect(estimateTokens('㏿')).toBe(1); // U+33FF  范围外 → 0.25/字 → ceil 1
  });

  it('非 BMP 字符（代理对）按一个码点计，不拆成两个 0.25', () => {
    // 旧正则版用 text.length 会把 emoji 数成 2 字符；for...of 按码点走
    expect(estimateTokens('😀')).toBe(1); // 1 码点 × 0.25 → ceil 1
  });

  it('KnowledgeQuery.estimateTokens 委托同一实现（同一把尺子）', () => {
    const query = new KnowledgeQuery({} as unknown as KnowledgeStore);
    for (const text of ['', 'abcd', '知识引擎', '知识abcd', '㐀䶿一鿿豈﫿']) {
      expect(query.estimateTokens(text)).toBe(estimateTokens(text));
    }
  });
});
