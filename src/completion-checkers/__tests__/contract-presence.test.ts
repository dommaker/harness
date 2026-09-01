/**
 * verifyContractPresence 测试（契约标记缺失 / 无表项 skip）
 */

import { verifyContractPresence } from '../contract-presence';

describe('verifyContractPresence', () => {
  it('无表项类型 → skip（不算违规）', () => {
    const result = verifyContractPresence('review', {}, { contracts: [] });
    expect(result.verdict).toBe('skip');
    expect(result.detail).toContain('无 contracts 表项');
  });

  it('contracts 缺省（未配置）→ skip', () => {
    expect(verifyContractPresence('review', { reviewReport: {} }).verdict).toBe('skip');
  });

  it('review 在场（reviewReport 已解析）→ pass', () => {
    const result = verifyContractPresence(
      'review',
      { reviewReport: { verdict: 'pass' } },
      { contracts: ['review'] },
    );
    expect(result.verdict).toBe('pass');
  });

  it.each([undefined, null])('review 契约标记缺失（reviewReport=%s）→ violation', (reviewReport) => {
    const result = verifyContractPresence('review', { reviewReport }, { contracts: ['review'] });
    expect(result.verdict).toBe('violation');
    expect(result.detail).toContain('契约标记缺失');
  });

  it('类型在清单内但无判定方法注册 → violation（配置与代码失配）', () => {
    const result = verifyContractPresence('unknown-type', {}, { contracts: ['unknown-type'] });
    expect(result.verdict).toBe('violation');
    expect(result.detail).toContain('无判定方法注册');
  });

  it('checker 关闭 → skip', () => {
    expect(
      verifyContractPresence('review', {}, { contracts: ['review'], checkers: { contractPresence: false } }).verdict,
    ).toBe('skip');
  });
});
