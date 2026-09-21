/**
 * studio#602 / E1 飞轮修复：usage-report 数据层公共导出守门。
 *
 * 背景：buildConstraintsUsageReport / diagnoseRetireCandidates 自 0.17.0 起存在于
 * core/constraints/usage-report，但未从包公共入口导出（exports map 的 ./core 亦不含），
 * studio E1 (a) 链路（约束退役候选 → 进化提案）无法消费。本测试钉住公共导出面，
 * 防回归「加了实现忘加导出」。
 */
import * as harness from '../index';

describe('usage-report public exports (studio#602)', () => {
  it('buildConstraintsUsageReport / diagnoseRetireCandidates 从包根导出', () => {
    expect(typeof (harness as Record<string, unknown>).buildConstraintsUsageReport).toBe('function');
    expect(typeof (harness as Record<string, unknown>).diagnoseRetireCandidates).toBe('function');
  });

  it('CANDIDATE_KIND_LABEL 覆盖全部候选种类', () => {
    const label = (harness as Record<string, unknown>).CANDIDATE_KIND_LABEL as Record<string, string>;
    expect(Object.keys(label).sort()).toEqual(['high_noise', 'unevaluable', 'zero_intercept', 'zero_trigger']);
  });
});
