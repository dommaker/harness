/**
 * 门禁决策构造测试（G1：报告 → 三态决策映射 + 浅冻结契约）
 */

import { decisionFromResult } from '../decision';
import type { GateDecisionStatus, GateResult } from '../types';

function fakeResult(passed: boolean): GateResult {
  return {
    gate: 'probe',
    passed,
    message: 'probe',
    timestamp: new Date().toISOString(),
  };
}

describe('decisionFromResult', () => {
  it('status 缺省由 passed 推导：true → abstain，false → deny', () => {
    expect(decisionFromResult(fakeResult(true)).status).toBe('abstain');
    expect(decisionFromResult(fakeResult(false)).status).toBe('deny');
  });

  it('ask 只能显式指定（枚举预留，fail-closed 语义见 gates/CONTEXT.md）', () => {
    expect(decisionFromResult(fakeResult(true), 'ask').status).toBe('ask');
  });

  it('决策浅冻结：改写 status 抛错（不可变是 deny 单调语义的接口契约）', () => {
    const decision = decisionFromResult(fakeResult(false));
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.result)).toBe(true);
    expect(() => {
      (decision as { status: GateDecisionStatus }).status = 'abstain';
    }).toThrow(TypeError);
  });
});
