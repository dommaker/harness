/**
 * 门禁执行器测试（G1：deny 单调 + ask fail-closed + order 排序）
 */

import { runGates } from '../runner';
import { decisionFromResult } from '../decision';
import type { Gate, GateContext, GateDecisionStatus } from '../types';

function fakeGate(id: string, order: number, status: GateDecisionStatus): Gate {
  return {
    id,
    order,
    evaluate: async () =>
      decisionFromResult(
        {
          gate: id,
          passed: status !== 'deny',
          message: id,
          timestamp: new Date().toISOString(),
        },
        status
      ),
  };
}

const ctx: GateContext = { projectId: 'p', projectPath: '/tmp/project' };

describe('runGates', () => {
  it('deny 单调：先 deny 后 abstain，终态 deny（下游不得改回 allow）', async () => {
    const result = await runGates(
      [fakeGate('a', 0, 'deny'), fakeGate('b', 1, 'abstain')],
      ctx
    );
    expect(result.status).toBe('deny');
    expect(result.denied.map(d => d.result.gate)).toEqual(['a']);
    expect(result.decisions.map(d => d.result.gate)).toEqual(['a', 'b']);
  });

  it('deny 单调：先 abstain 后 deny，终态 deny', async () => {
    const result = await runGates(
      [fakeGate('a', 0, 'abstain'), fakeGate('b', 1, 'deny')],
      ctx
    );
    expect(result.status).toBe('deny');
    expect(result.denied).toHaveLength(1);
  });

  it('全部 abstain → 终态 abstain', async () => {
    const result = await runGates(
      [fakeGate('a', 0, 'abstain'), fakeGate('b', 1, 'abstain')],
      ctx
    );
    expect(result.status).toBe('abstain');
    expect(result.denied).toHaveLength(0);
    expect(result.asked).toHaveLength(0);
  });

  it('ask 枚举预留：无实现时 fail-closed = deny', async () => {
    const result = await runGates([fakeGate('asker', 0, 'ask')], ctx);
    expect(result.status).toBe('deny');
    expect(result.asked).toHaveLength(1);
    expect(result.asked[0].status).toBe('ask');
    expect(result.denied).toHaveLength(0);
  });

  it('按声明式 order 升序执行（入参顺序无关）', async () => {
    const result = await runGates(
      [fakeGate('c', 3, 'abstain'), fakeGate('a', 1, 'abstain'), fakeGate('b', 2, 'abstain')],
      ctx
    );
    expect(result.decisions.map(d => d.result.gate)).toEqual(['a', 'b', 'c']);
  });

  it('决策浅冻结：调用方/下游改写决策抛错（单调语义接口契约）', async () => {
    const result = await runGates([fakeGate('a', 0, 'deny')], ctx);
    expect(Object.isFrozen(result.decisions[0])).toBe(true);
    expect(() => {
      (result.decisions[0] as { status: GateDecisionStatus }).status = 'abstain';
    }).toThrow(TypeError);
  });
});
